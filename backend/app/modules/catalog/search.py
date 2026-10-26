"""Поиск по каталогу запчастей.

Что умеет:
  * номера: точное совпадение OEM/артикула, начало номера, часть номера, опечатка в номере
    ('4нв-4330', '4HB4330', '4330' — одно и то же);
  * слова: падежи и окончания ('ремня', 'подшипники'), опечатки ('подшыпник', 'филтр'),
    префиксы при наборе ('подш');
  * неверная раскладка ('htvtym' → 'ремень');
  * ранжирование по релевантности, фасеты по категориям, сортировка.

Индекс строится в памяти из БД и перестраивается при изменении каталога или предложений.
Для пилота (тысячи позиций) поиск занимает миллисекунды. При росте каталога этот модуль
заменяется внешним движком (Meilisearch / OpenSearch) с тем же интерфейсом search()/suggest().
"""

import re
import threading
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.catalog.models import Brand, Category, MachineModel, Part, PartNumber
from app.modules.catalog.normalize import normalize_number
from app.modules.inventory.models import Offer

_WORD = re.compile(r"[0-9a-zа-я]+")
_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
_RU = "йцукенгшщзхъфывапролджэячсмитьбюё"
_LAYOUT = str.maketrans(_EN, _RU)
# Окончания русских слов, от длинных к коротким. Это не морфология, а грубое отсечение —
# дальше разницу добирает нечёткое сравнение.
_ENDINGS = sorted(
    "ами ями ого его ому ему ыми ими ых их ой ей ий ый ая яя ое ее ую юю ов ев ам ям ах ях ом ем ы и а я у ю е о ь й".split(),
    key=len, reverse=True,
)
_STOP = {"для", "на", "в", "с", "и", "к", "по", "от", "из"}


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace("ё", "е"))


def stem(word: str) -> str:
    if len(word) <= 4 or not re.search("[а-я]", word):
        return word
    for end in _ENDINGS:
        if word.endswith(end) and len(word) - len(end) >= 4:
            return word[: -len(end)]
    return word


def fix_layout(q: str) -> str:
    return q.lower().translate(_LAYOUT)


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


@dataclass
class Doc:
    id: int
    name: str
    category_id: int | None
    numbers: list[str]  # нормализованные OEM / артикулы, в т.ч. артикулы магазинов
    name_stems: list[str]
    extra_stems: list[str]  # категория, производители, названия у магазинов
    first_stem: str = ""


@dataclass
class Index:
    signature: tuple
    docs: dict[int, Doc] = field(default_factory=dict)
    categories: dict[int, str] = field(default_factory=dict)
    models: list[tuple[int, str, str]] = field(default_factory=list)  # (id, brand+model, kind)


_lock = threading.Lock()
_index: Index | None = None


def _signature(db: Session) -> tuple:
    return (
        db.scalar(select(func.count(Part.id))),
        db.scalar(select(func.max(Part.updated_at))),
        db.scalar(select(func.count(PartNumber.id))),
        db.scalar(select(func.count(Offer.id))),
        db.scalar(select(func.max(Offer.updated_at))),
        db.scalar(select(func.count(MachineModel.id))),
        db.scalar(select(func.count(Category.id))),
    )


def _build(db: Session, signature: tuple) -> Index:
    idx = Index(signature=signature)
    idx.categories = dict(db.execute(select(Category.id, Category.name)).all())
    numbers: dict[int, set[str]] = {}
    extra: dict[int, list[str]] = {}
    for part_id, norm, manufacturer in db.execute(select(PartNumber.part_id, PartNumber.normalized, PartNumber.manufacturer)):
        numbers.setdefault(part_id, set()).add(norm)
        if manufacturer:
            extra.setdefault(part_id, []).append(manufacturer)
    for part_id, title, article_norm, manufacturer in db.execute(
        select(Offer.part_id, Offer.title, Offer.article_normalized, Offer.manufacturer).where(Offer.part_id.is_not(None))
    ):
        if article_norm:
            numbers.setdefault(part_id, set()).add(article_norm)
        extra.setdefault(part_id, []).extend(x for x in (title, manufacturer) if x)
    for pid, name, cat_id in db.execute(select(Part.id, Part.name, Part.category_id)):
        name_stems = [stem(w) for w in words(name) if w not in _STOP]
        extra_text = " ".join(extra.get(pid, []) + [idx.categories.get(cat_id, "")])
        idx.docs[pid] = Doc(
            id=pid, name=name, category_id=cat_id, numbers=sorted(numbers.get(pid, set())),
            name_stems=name_stems, extra_stems=sorted({stem(w) for w in words(extra_text)} - set(name_stems)),
            first_stem=name_stems[0] if name_stems else "",
        )
    for mid, brand, name, kind in db.execute(
        select(MachineModel.id, Brand.name, MachineModel.name, MachineModel.kind).join(Brand, Brand.id == MachineModel.brand_id)
    ):
        idx.models.append((mid, f"{brand} {name}", kind))
    return idx


def get_index(db: Session) -> Index:
    global _index
    sig = _signature(db)
    with _lock:
        if _index is None or _index.signature != sig:
            _index = _build(db, sig)
        return _index


def invalidate() -> None:
    global _index
    with _lock:
        _index = None


# --- ранжирование ------------------------------------------------------------------------------


def _number_score(qnorm: str, doc: Doc) -> float:
    if len(qnorm) < 3 or not doc.numbers:
        return 0.0
    best = 0.0
    for n in doc.numbers:
        if n == qnorm:
            return 100.0
        if n.startswith(qnorm):
            best = max(best, 85.0)
        elif qnorm in n:
            best = max(best, 70.0)
        elif len(qnorm) >= 5 and abs(len(n) - len(qnorm)) <= 2 and _ratio(qnorm, n) >= 0.8:
            best = max(best, 55.0)  # опечатка в номере
    return best


def _token_score(tok: str, doc: Doc) -> float:
    """Насколько одно слово запроса совпадает с документом: 0..1."""
    if any(ch.isdigit() for ch in tok):
        norm = normalize_number(tok)
        for n in doc.numbers:
            if n == norm:
                return 1.0
            if len(norm) >= 3 and norm in n:
                return 0.85
    best = 0.0
    for weight, pool in ((1.0, doc.name_stems), (0.75, doc.extra_stems)):
        for w in pool:
            if w == tok:
                s = 1.0
            elif len(tok) >= 3 and w.startswith(tok):
                s = 0.9  # пользователь ещё набирает слово
            elif len(tok) >= 4 and len(w) >= 4 and abs(len(w) - len(tok)) <= 3:
                r = _ratio(tok, w)
                s = r * 0.85 if r >= 0.72 else 0.0
            else:
                s = 0.0
            best = max(best, s * weight)
            if best >= 1.0:
                return best
    return best


def score(query: str, doc: Doc) -> float:
    qnorm = normalize_number(query)
    num = _number_score(qnorm, doc) if any(ch.isdigit() for ch in qnorm) else 0.0
    toks = [stem(w) for w in words(query) if w not in _STOP]
    if not toks:
        return num
    per = [_token_score(t, doc) for t in toks]
    matched = sum(1 for s in per if s > 0)
    if matched == 0:
        return num
    coverage = matched / len(toks)
    if coverage < 0.5 or (len(toks) >= 2 and coverage < 0.66):
        return num
    text = 60.0 * (sum(per) / len(toks)) * coverage
    if doc.first_stem and toks[0] == doc.first_stem:
        text += 10.0  # «ремень …» выше, чем «… к ремню»
    return max(num, text)


@dataclass
class SearchResult:
    ids: list[int]
    scores: dict[int, float]
    corrected_query: str | None = None


def rank(db: Session, query: str, allowed: set[int] | None = None, threshold: float = 30.0) -> SearchResult:
    idx = get_index(db)
    docs = [d for d in idx.docs.values() if allowed is None or d.id in allowed]

    def run(q: str) -> dict[int, float]:
        out = {}
        for d in docs:
            s = score(q, d)
            if s >= threshold:
                out[d.id] = s
        return out

    scores = run(query)
    corrected = None
    # Набрали латиницей вместо кириллицы: 'htvtym' → 'ремень'.
    if re.search("[a-z]", query.lower()) and not re.search("[а-я]", query.lower()):
        alt = fix_layout(query)
        alt_scores = run(alt)
        if alt_scores and (not scores or max(alt_scores.values()) > max(scores.values()) + 10):
            scores, corrected = alt_scores, alt
    ids = sorted(scores, key=lambda i: (-scores[i], idx.docs[i].name))
    return SearchResult(ids=ids, scores=scores, corrected_query=corrected)


def match_models(db: Session, query: str, limit: int = 3) -> list[dict]:
    idx = get_index(db)
    toks = [w for w in words(query)]
    if not toks:
        return []
    out = []
    for mid, title, kind in idx.models:
        tw = words(title)
        hit = all(any(w.startswith(t) or (len(t) >= 4 and _ratio(t, w) >= 0.8) for w in tw) for t in toks)
        if hit:
            out.append({"id": mid, "title": title, "kind": kind})
    return out[:limit]


def match_categories(db: Session, query: str, limit: int = 3) -> list[dict]:
    idx = get_index(db)
    toks = [stem(w) for w in words(query) if w not in _STOP]
    out = []
    for cid, name in idx.categories.items():
        cw = [stem(w) for w in words(name)]
        if toks and all(any(w.startswith(t) or (len(t) >= 4 and _ratio(t, w) >= 0.75) for w in cw) for t in toks):
            out.append({"id": cid, "name": name})
    return out[:limit]
