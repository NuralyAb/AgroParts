from collections import Counter

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFound
from app.modules.catalog import search as engine
from app.modules.catalog.models import Compatibility, MachineModel, Part, PartAnalog
from app.modules.inventory.models import Offer, StockItem
from app.modules.shops.models import Shop
from app.modules.viewer3d.models import Model3D, ModelComponent


def reindex_part(part: Part) -> None:
    chunks = [part.name, (part.description or "")[:300]]
    for n in part.numbers:
        chunks += [n.number, n.normalized, n.manufacturer or ""]
    part.search_text = " ".join(c for c in chunks if c).lower()


def visible_offer_clause():
    """Предложение видно покупателям: активно, сопоставлено с каталогом, магазин проверен."""
    return and_(Offer.is_active.is_(True), Offer.match_status == "matched", Shop.status == "verified")


def compat_clause(model_id: int, modification_id: int | None = None, year: int | None = None):
    conds = [Compatibility.part_id == Part.id, Compatibility.model_id == model_id, Compatibility.verified.is_(True)]
    if modification_id is not None:
        conds.append(or_(Compatibility.modification_id.is_(None), Compatibility.modification_id == modification_id))
    if year is not None:
        conds.append(or_(Compatibility.year_from.is_(None), Compatibility.year_from <= year))
        conds.append(or_(Compatibility.year_to.is_(None), Compatibility.year_to >= year))
    return exists().where(*conds)


SORTS = ("relevance", "price_asc", "price_desc", "available")


def search_full(
    db: Session,
    *,
    q: str | None = None,
    model_id: int | None = None,
    modification_id: int | None = None,
    year: int | None = None,
    category_id: int | None = None,
    in_stock: bool = False,
    sort: str = "relevance",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Поиск с релевантностью, фасетами по категориям и сортировкой. Фасеты считаются без учёта
    выбранной категории — чтобы было видно, сколько найдётся в соседних."""
    conds = []
    if model_id:
        conds.append(compat_clause(model_id, modification_id, year))
    if in_stock:
        conds.append(
            Part.id.in_(
                select(Offer.part_id)
                .join(Shop, Shop.id == Offer.shop_id)
                .join(StockItem, StockItem.offer_id == Offer.id)
                .where(visible_offer_clause(), StockItem.on_hand - StockItem.reserved > 0)
            )
        )
    allowed = set(db.scalars(select(Part.id).where(*conds))) if conds else None
    idx = engine.get_index(db)

    corrected = None
    scores: dict[int, float] = {}
    if q and q.strip():
        res = engine.rank(db, q.strip(), allowed)
        ids, scores, corrected = res.ids, res.scores, res.corrected_query
    else:
        ids = [i for i in idx.docs if allowed is None or i in allowed]

    facet_counts = Counter(idx.docs[i].category_id for i in ids if i in idx.docs)
    facets = [
        {"id": cid, "name": idx.categories.get(cid, "Без категории"), "count": n}
        for cid, n in facet_counts.most_common()
        if cid is not None
    ]
    if category_id:
        ids = [i for i in ids if idx.docs[i].category_id == category_id]

    summary = offers_summary(db, ids)
    empty = {"offers": 0, "in_stock_offers": 0, "min_price": None, "available": 0}
    s = lambda i: summary.get(i, empty)  # noqa: E731
    if sort == "price_asc":
        ids.sort(key=lambda i: (s(i)["min_price"] is None, s(i)["min_price"] or 0))
    elif sort == "price_desc":
        ids.sort(key=lambda i: (s(i)["min_price"] is None, -(s(i)["min_price"] or 0)))
    elif sort == "available":
        ids.sort(key=lambda i: (-s(i)["in_stock_offers"], -s(i)["available"]))
    elif scores:
        # Релевантность важнее всего; при близкой — выше то, что есть в наличии.
        ids.sort(key=lambda i: (-(scores[i] + (5 if s(i)["available"] > 0 else 0)), idx.docs[i].name))
    else:
        ids.sort(key=lambda i: (s(i)["available"] <= 0, idx.docs[i].name))

    page = ids[offset : offset + limit]
    parts = {
        p.id: p
        for p in db.scalars(
            select(Part).where(Part.id.in_(page)).options(selectinload(Part.numbers), selectinload(Part.category))
        )
    }
    items = []
    for i in page:
        brief = part_brief(parts[i], summary.get(i))
        if scores:
            brief["score"] = round(scores[i], 1)
        items.append(brief)
    return {"items": items, "total": len(ids), "corrected_query": corrected, "facets": {"categories": facets}, "sort": sort}


def search(db: Session, **kwargs) -> tuple[list[dict], int]:
    r = search_full(db, **kwargs)
    return r["items"], r["total"]


def offers_summary(db: Session, part_ids: list[int]) -> dict[int, dict]:
    if not part_ids:
        return {}
    avail = func.coalesce(func.sum(StockItem.on_hand - StockItem.reserved), 0)
    per_offer = (
        select(Offer.part_id, Offer.id, Offer.price, avail.label("available"))
        .join(Shop, Shop.id == Offer.shop_id)
        .outerjoin(StockItem, StockItem.offer_id == Offer.id)
        .where(Offer.part_id.in_(part_ids), visible_offer_clause())
        .group_by(Offer.part_id, Offer.id, Offer.price)
    )
    out: dict[int, dict] = {}
    for part_id, _offer_id, price, available in db.execute(per_offer):
        s = out.setdefault(part_id, {"offers": 0, "in_stock_offers": 0, "min_price": None, "available": 0})
        s["offers"] += 1
        s["available"] += available
        if available > 0:
            s["in_stock_offers"] += 1
            s["min_price"] = price if s["min_price"] is None else min(s["min_price"], price)
    return out


def part_brief(p: Part, summary: dict | None = None) -> dict:
    oem = next((n.number for n in p.numbers if n.kind == "oem"), None)
    return {
        "id": p.id,
        "name": p.name,
        "oem": oem,
        "numbers": [n.number for n in p.numbers],
        "image_url": p.image_url,
        "category_id": p.category_id,
        "category": p.category.name if p.category_id and p.category else None,
        "summary": summary or {"offers": 0, "in_stock_offers": 0, "min_price": None, "available": 0},
    }


def part_offers(db: Session, part_id: int) -> list[dict]:
    offers = db.scalars(
        select(Offer)
        .join(Shop, Shop.id == Offer.shop_id)
        .where(Offer.part_id == part_id, visible_offer_clause())
        .options(selectinload(Offer.stock_items).selectinload(StockItem.warehouse), selectinload(Offer.shop))
    ).all()
    result = []
    for o in offers:
        available = sum(s.available for s in o.stock_items)
        updated = max((s.updated_at for s in o.stock_items), default=o.updated_at)
        result.append(
            {
                "offer_id": o.id,
                "shop": {
                    "id": o.shop.id, "name": o.shop.name, "city": o.shop.city, "address": o.shop.address,
                    "phone": o.shop.phone, "delivery_available": o.shop.delivery_available,
                },
                "title": o.title,
                "manufacturer": o.manufacturer,
                "condition": o.condition,
                "price": o.price,
                "available": available,
                "stock_mode": o.stock_mode,
                "stock_updated_at": updated,
                "warehouses": [
                    {"name": s.warehouse.name, "address": s.warehouse.address, "available": s.available}
                    for s in o.stock_items
                    if s.available > 0
                ],
            }
        )
    result.sort(key=lambda r: (r["available"] <= 0, r["price"]))
    return result


def compat_row(c: Compatibility) -> dict:
    return {
        "id": c.id,
        "model_id": c.model_id,
        "model": f"{c.model.brand.name} {c.model.name}",
        "modification_id": c.modification_id,
        "modification": c.modification.name if c.modification else None,
        "year_from": c.year_from,
        "year_to": c.year_to,
        "source": c.source,
        "verified": c.verified,
        "note": c.note,
    }


def analogs(db: Session, part_id: int, verified_only: bool = True) -> list[dict]:
    q = select(PartAnalog).where(or_(PartAnalog.part_id == part_id, PartAnalog.analog_id == part_id))
    if verified_only:
        q = q.where(PartAnalog.verified.is_(True))
    rows = db.scalars(q).all()
    other_ids = [a.analog_id if a.part_id == part_id else a.part_id for a in rows]
    parts = {p.id: p for p in db.scalars(select(Part).where(Part.id.in_(other_ids)).options(selectinload(Part.numbers)))}
    summary = offers_summary(db, other_ids)
    out = []
    for a, oid in zip(rows, other_ids, strict=True):
        brief = part_brief(parts[oid], summary.get(oid))
        brief.update({"analog_link_id": a.id, "source": a.source, "verified": a.verified, "note": a.note})
        out.append(brief)
    return out


def part_detail(db: Session, part_id: int, *, include_unverified: bool = False) -> dict:
    p = db.scalar(
        select(Part)
        .where(Part.id == part_id)
        .options(
            selectinload(Part.numbers),
            selectinload(Part.category),
            selectinload(Part.compatibility).selectinload(Compatibility.model).selectinload(MachineModel.brand),
            selectinload(Part.compatibility).selectinload(Compatibility.modification),
        )
    )
    if p is None:
        raise NotFound("Запчасть не найдена")
    on_models = db.execute(
        select(ModelComponent.model3d_id, ModelComponent.key, Model3D.title)
        .join(Model3D, Model3D.id == ModelComponent.model3d_id)
        .where(ModelComponent.part_id == p.id)
    ).all()
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "category": p.category.name if p.category else None,
        "category_id": p.category_id,
        "specs": p.specs,
        "image_url": p.image_url,
        "image_credit": p.image_credit,
        "render": p.render,
        "numbers": [
            {"id": n.id, "kind": n.kind, "manufacturer": n.manufacturer, "number": n.number} for n in p.numbers
        ],
        "compatibility": [compat_row(c) for c in p.compatibility if include_unverified or c.verified],
        "analogs": analogs(db, p.id, verified_only=not include_unverified),
        "offers": part_offers(db, p.id),
        "on_3d_models": [{"model3d_id": m, "component_key": k, "title": t} for m, k, t in on_models],
    }
