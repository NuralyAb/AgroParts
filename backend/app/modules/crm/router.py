from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import shop_access
from app.core.errors import Conflict, NotFound
from app.modules.auth.router import normalize_phone
from app.modules.crm.models import Customer
from app.modules.inventory.models import Offer, StockItem
from app.modules.orders.models import Order, OrderItem
from app.modules.shops.models import Shop

router = APIRouter(prefix="/shops/{shop_id}", tags=["crm"])


def customer_out(c: Customer, stats: dict | None = None) -> dict:
    return {
        "id": c.id, "name": c.name, "phone": c.phone, "farm": c.farm, "note": c.note,
        "from_marketplace": c.user_id is not None, "created_at": c.created_at,
        **(stats or {"orders": 0, "spent": 0, "last_order_at": None}),
    }


def _stats(db: Session, ids: list[int]) -> dict[int, dict]:
    if not ids:
        return {}
    rows = db.execute(
        select(Order.customer_id, func.count(Order.id), func.coalesce(func.sum(Order.total), 0), func.max(Order.created_at))
        .where(Order.customer_id.in_(ids), Order.status == "issued")
        .group_by(Order.customer_id)
    )
    return {cid: {"orders": n, "spent": s, "last_order_at": last} for cid, n, s, last in rows}


@router.get("/customers")
def customers(q: str | None = None, limit: int = Query(100, le=500), shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    stmt = select(Customer).where(Customer.shop_id == shop.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Customer.name.ilike(like), Customer.phone.ilike(like), Customer.farm.ilike(like)))
    rows = db.scalars(stmt.order_by(Customer.name).limit(limit)).all()
    stats = _stats(db, [c.id for c in rows])
    return [customer_out(c, stats.get(c.id)) for c in rows]


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    farm: str | None = None
    note: str = ""


@router.post("/customers", status_code=201)
def create_customer(data: CustomerIn, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    phone = normalize_phone(data.phone) if data.phone else None
    if phone and db.scalar(select(Customer).where(Customer.shop_id == shop.id, Customer.phone == phone)):
        raise Conflict("Клиент с таким телефоном уже есть")
    c = Customer(shop_id=shop.id, name=data.name, phone=phone, farm=data.farm, note=data.note)
    db.add(c)
    db.commit()
    return customer_out(c)


class CustomerPatch(BaseModel):
    name: str | None = None
    farm: str | None = None
    note: str | None = None


@router.patch("/customers/{customer_id}")
def patch_customer(customer_id: int, data: CustomerPatch, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if c is None or c.shop_id != shop.id:
        raise NotFound("Клиент не найден")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return customer_out(c, _stats(db, [c.id]).get(c.id))


@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=365), shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=days)
    issued = (Order.shop_id == shop.id, Order.status == "issued", Order.created_at >= since)
    by_channel = {
        ch: {"orders": n, "revenue": r}
        for ch, n, r in db.execute(
            select(Order.channel, func.count(Order.id), func.coalesce(func.sum(Order.total), 0)).where(*issued).group_by(Order.channel)
        )
    }
    top = db.execute(
        select(OrderItem.title, OrderItem.sku, func.sum(OrderItem.qty).label("qty"), func.sum(OrderItem.qty * OrderItem.price))
        .join(Order, Order.id == OrderItem.order_id)
        .where(*issued)
        .group_by(OrderItem.title, OrderItem.sku)
        .order_by(func.sum(OrderItem.qty).desc())
        .limit(10)
    ).all()
    status_counts = dict(
        db.execute(select(Order.status, func.count(Order.id)).where(Order.shop_id == shop.id).group_by(Order.status)).all()
    )
    stock = db.execute(
        select(
            func.count(func.distinct(Offer.id)),
            func.coalesce(func.sum(StockItem.on_hand), 0),
            func.coalesce(func.sum(StockItem.reserved), 0),
            func.coalesce(func.sum(StockItem.on_hand * Offer.price), 0),
        )
        .select_from(Offer)
        .outerjoin(StockItem, StockItem.offer_id == Offer.id)
        .where(Offer.shop_id == shop.id)
    ).one()
    review = db.scalar(select(func.count()).select_from(Offer).where(Offer.shop_id == shop.id, Offer.match_status != "matched"))
    return {
        "period_days": days,
        "by_channel": by_channel,
        "revenue": sum(v["revenue"] for v in by_channel.values()),
        "orders_by_status": status_counts,
        "top_products": [{"title": t, "sku": s, "qty": q, "revenue": r} for t, s, q, r in top],
        "stock": {"offers": stock[0], "on_hand": stock[1], "reserved": stock[2], "value": stock[3]},
        "offers_need_review": review,
    }
