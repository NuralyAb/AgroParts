"""Сопоставление предложений магазинов с единым каталогом.

Автоматически принимается только однозначное совпадение по номеру (OEM / артикул производителя).
Всё остальное уходит на ручную проверку — с подсказками по похожим номерам и названиям.
Модель ML/LLM-сопоставления можно подключить в suggestions(), не меняя правило подтверждения.
"""

from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.models import Part, PartNumber
from app.modules.catalog.normalize import normalize_number
from app.modules.inventory.models import Offer


def auto_match(db: Session, offer: Offer) -> None:
    offer.article_normalized = normalize_number(offer.article) or None
    if offer.part_id is not None and offer.match_status == "matched":
        return
    candidates: list[int] = []
    if offer.article_normalized:
        candidates = list(
            db.scalars(select(PartNumber.part_id).where(PartNumber.normalized == offer.article_normalized).distinct())
        )
    if len(candidates) == 1:
        offer.part_id = candidates[0]
        offer.match_status = "matched"
    else:
        offer.part_id = None
        offer.match_status = "review"


def suggestions(db: Session, offer: Offer, limit: int = 5) -> list[dict]:
    scored: dict[int, float] = {}
    norm = offer.article_normalized or ""
    if len(norm) >= 3:
        for part_id, number in db.execute(
            select(PartNumber.part_id, PartNumber.normalized).where(PartNumber.normalized.contains(norm[:6], autoescape=True))
        ):
            scored[part_id] = max(scored.get(part_id, 0), 0.6 + 0.4 * SequenceMatcher(None, norm, number).ratio())

    title = (offer.title or "").lower()
    words = [w for w in title.split() if len(w) >= 4][:3]
    if words:
        q = select(Part.id, Part.name)
        for w in words[:1]:
            q = q.where(Part.search_text.contains(w[:5], autoescape=True))
        for part_id, name in db.execute(q.limit(200)):
            s = SequenceMatcher(None, title, name.lower()).ratio() * 0.8
            scored[part_id] = max(scored.get(part_id, 0), s)

    top = sorted(scored.items(), key=lambda kv: -kv[1])[:limit]
    parts = {p.id: p for p in db.scalars(select(Part).where(Part.id.in_([k for k, _ in top])).options(selectinload(Part.numbers)))}
    return [
        {"part_id": pid, "name": parts[pid].name, "numbers": [n.number for n in parts[pid].numbers], "score": round(score, 2)}
        for pid, score in top
        if pid in parts
    ]
