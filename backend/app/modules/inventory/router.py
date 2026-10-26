"""Склад магазина: товарные предложения, поступления, инвентаризация, ячейки, журнал движений."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import current_user, shop_access
from app.core.errors import DomainError, NotFound
from app.modules.auth.models import User
from app.modules.catalog.models import Part
from app.modules.integrations.matching import auto_match
from app.modules.inventory import service as inv
from app.modules.inventory.models import Offer, StockItem, StockMovement
from app.modules.shops.models import Shop, Warehouse

router = APIRouter(prefix="/shops/{shop_id}", tags=["inventory"])


def stock_row(s: StockItem) -> dict:
    return {
        "id": s.id, "warehouse_id": s.warehouse_id, "warehouse": s.warehouse.name, "on_hand": s.on_hand,
        "reserved": s.reserved, "available": s.available, "bin_location": s.bin_location, "updated_at": s.updated_at,
    }


def offer_row(o: Offer) -> dict:
    stocks = [stock_row(s) for s in o.stock_items]
    return {
        "id": o.id, "sku": o.sku, "title": o.title, "article": o.article, "manufacturer": o.manufacturer,
        "price": o.price, "condition": o.condition, "is_active": o.is_active, "stock_mode": o.stock_mode,
        "match_status": o.match_status,
        "part": {"id": o.part.id, "name": o.part.name} if o.part else None,
        "on_hand": sum(s["on_hand"] for s in stocks),
        "reserved": sum(s["reserved"] for s in stocks),
        "available": sum(s["available"] for s in stocks),
        "updated_at": max((s["updated_at"] for s in stocks), default=o.updated_at),
        "stocks": stocks,
    }


def _offer_query():
    return select(Offer).options(
        selectinload(Offer.stock_items).selectinload(StockItem.warehouse), selectinload(Offer.part)
    )


def load_offer(db: Session, shop: Shop, offer_id: int) -> Offer:
    o = db.scalar(_offer_query().where(Offer.id == offer_id, Offer.shop_id == shop.id))
    if o is None:
        raise NotFound("Товар не найден")
    return o


def _warehouse_id(db: Session, shop: Shop, warehouse_id: int | None) -> int:
    if warehouse_id is None:
        return inv.default_warehouse_id(db, shop)
    w = db.get(Warehouse, warehouse_id)
    if w is None or w.shop_id != shop.id:
        raise NotFound("Склад не найден")
    return w.id


@router.get("/offers")
def list_offers(
    q: str | None = None,
    match_status: str | None = None,
    only_available: bool = False,
    limit: int = Query(100, le=500),
    offset: int = 0,
    shop: Shop = Depends(shop_access),
    db: Session = Depends(get_db),
):
    stmt = _offer_query().where(Offer.shop_id == shop.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Offer.title.ilike(like), Offer.sku.ilike(like), Offer.article.ilike(like)))
    if match_status:
        stmt = stmt.where(Offer.match_status == match_status)
    rows = [offer_row(o) for o in db.scalars(stmt.order_by(Offer.title).limit(limit).offset(offset))]
    if only_available:
        rows = [r for r in rows if r["available"] > 0]
    return rows


class OfferIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    price: int = Field(ge=0)
    part_id: int | None = None
    article: str | None = None
    manufacturer: str | None = None
    sku: str | None = Field(None, max_length=40, description="Пусто — сгенерировать внутренний SKU")
    condition: str = Field("new", pattern="^(new|used|restored)$")
    stock_mode: str = Field("tracked", pattern="^(tracked|manual)$")
    initial_qty: int = Field(0, ge=0)
    warehouse_id: int | None = None
    bin_location: str | None = None


@router.post("/offers", status_code=201)
def create_offer(data: OfferIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    offer = Offer(
        shop_id=shop.id, title=data.title.strip(), price=data.price, article=data.article,
        manufacturer=data.manufacturer, condition=data.condition, stock_mode=data.stock_mode,
        sku=(data.sku or "").strip() or inv.next_sku(db, shop),
    )
    if data.part_id is not None:
        if db.get(Part, data.part_id) is None:
            raise NotFound("Запчасть каталога не найдена")
        offer.part_id, offer.match_status = data.part_id, "matched"  # продавец сам выбрал карточку каталога
    db.add(offer)
    auto_match(db, offer)
    db.flush()
    stock = inv.get_or_create_stock(db, offer, _warehouse_id(db, shop, data.warehouse_id))
    stock.bin_location = data.bin_location
    if data.initial_qty:
        inv.receive(db, stock, data.initial_qty, user_id=user.id, note="Начальный остаток")
    db.commit()
    return offer_row(load_offer(db, shop, offer.id))


class OfferPatch(BaseModel):
    title: str | None = None
    price: int | None = Field(None, ge=0)
    article: str | None = None
    manufacturer: str | None = None
    is_active: bool | None = None
    stock_mode: str | None = Field(None, pattern="^(tracked|manual)$")
    part_id: int | None = None


@router.patch("/offers/{offer_id}")
def patch_offer(offer_id: int, data: OfferPatch, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    offer = load_offer(db, shop, offer_id)
    values = data.model_dump(exclude_unset=True)
    part_id = values.pop("part_id", None)
    for k, v in values.items():
        setattr(offer, k, v)
    if part_id is not None:
        if db.get(Part, part_id) is None:
            raise NotFound("Запчасть каталога не найдена")
        offer.part_id, offer.match_status = part_id, "matched"
    elif "article" in values:
        auto_match(db, offer)  # уже сопоставленный товар сохраняет привязку, обновится только нормализованный номер
    db.commit()
    return offer_row(load_offer(db, shop, offer.id))


class ReceiveIn(BaseModel):
    offer_id: int
    qty: int = Field(gt=0)
    warehouse_id: int | None = None
    note: str = ""


@router.post("/stock/receive")
def receive(data: ReceiveIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    offer = load_offer(db, shop, data.offer_id)
    stock = inv.get_or_create_stock(db, offer, _warehouse_id(db, shop, data.warehouse_id))
    inv.receive(db, stock, data.qty, user_id=user.id, note=data.note or "Поступление")
    db.commit()
    return offer_row(load_offer(db, shop, offer.id))


class CountIn(BaseModel):
    offer_id: int
    counted: int = Field(ge=0)
    warehouse_id: int | None = None
    note: str = ""


@router.post("/stock/count")
def count(data: CountIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Инвентаризация: фиксирует фактический остаток. Нельзя опустить ниже активных резервов."""
    offer = load_offer(db, shop, data.offer_id)
    stock = inv.get_or_create_stock(db, offer, _warehouse_id(db, shop, data.warehouse_id))
    inv.set_count(db, stock, data.counted, user_id=user.id, note=data.note or "Инвентаризация")
    db.commit()
    return offer_row(load_offer(db, shop, offer.id))


class BinIn(BaseModel):
    bin_location: str | None = Field(None, max_length=40)


@router.patch("/stock/{stock_id}")
def set_bin(stock_id: int, data: BinIn, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    stock = db.get(StockItem, stock_id)
    if stock is None or stock.offer.shop_id != shop.id:
        raise NotFound("Складская позиция не найдена")
    stock.bin_location = data.bin_location
    db.commit()
    return stock_row(stock)


@router.get("/movements")
def movements(
    offer_id: int | None = None,
    limit: int = Query(100, le=500),
    shop: Shop = Depends(shop_access),
    db: Session = Depends(get_db),
):
    stmt = (
        select(StockMovement, Offer.sku, Offer.title, User.name)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(Offer, Offer.id == StockItem.offer_id)
        .outerjoin(User, User.id == StockMovement.user_id)
        .where(Offer.shop_id == shop.id)
    )
    if offer_id:
        stmt = stmt.where(Offer.id == offer_id)
    rows = db.execute(stmt.order_by(StockMovement.id.desc()).limit(limit)).all()
    return [
        {
            "id": m.id, "kind": m.kind, "sku": sku, "title": title, "on_hand_delta": m.on_hand_delta,
            "reserved_delta": m.reserved_delta, "on_hand_after": m.on_hand_after, "reserved_after": m.reserved_after,
            "order_id": m.order_id, "user": user_name, "note": m.note, "created_at": m.created_at,
        }
        for m, sku, title, user_name in rows
    ]


@router.get("/labels")
def labels(ids: str, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    """Данные для печати QR-этикеток (для магазинов без штрихкодов)."""
    try:
        offer_ids = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as exc:
        raise DomainError("ids — список чисел через запятую") from exc
    offers = db.scalars(_offer_query().where(Offer.shop_id == shop.id, Offer.id.in_(offer_ids))).all()
    return [
        {
            "offer_id": o.id, "sku": o.sku, "title": o.title, "article": o.article, "price": o.price,
            "bins": [s.bin_location for s in o.stock_items if s.bin_location],
            "qr": f"agroparts:{shop.code}:{o.sku}",
        }
        for o in offers
    ]
