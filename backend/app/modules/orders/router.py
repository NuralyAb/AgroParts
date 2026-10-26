from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import current_user, ensure_shop_can_trade, shop_access
from app.core.errors import Conflict, Forbidden, NotFound
from app.modules.auth.models import User
from app.modules.orders import service
from app.modules.orders.models import Order, OrderEvent
from app.modules.shops.models import Shop, ShopMember

router = APIRouter(tags=["orders"])


class LineIn(BaseModel):
    offer_id: int
    qty: int = Field(gt=0, le=10_000)


class CheckoutIn(BaseModel):
    items: list[LineIn] = Field(min_length=1)
    payment_mode: str = Field("on_pickup", pattern="^(on_pickup|online)$")
    comment: str = Field("", max_length=1000)


class ShopOrderIn(BaseModel):
    items: list[LineIn] = Field(min_length=1)
    customer_id: int | None = None
    comment: str = Field("", max_length=1000)


class StatusIn(BaseModel):
    to: str = Field(pattern="^(confirmed|ready|issued|cancelled)$")
    note: str = Field("", max_length=300)


def order_out(o: Order, *, with_events: bool = False) -> dict:
    out = {
        "id": o.id, "number": o.number, "channel": o.channel, "status": o.status,
        "payment_mode": o.payment_mode, "payment_status": o.payment_status, "total": o.total,
        "pickup_code": o.pickup_code, "comment": o.comment, "cancel_reason": o.cancel_reason,
        "expires_at": o.expires_at, "created_at": o.created_at, "updated_at": o.updated_at,
        "shop": {"id": o.shop.id, "name": o.shop.name, "address": o.shop.address, "phone": o.shop.phone},
        "customer": {"id": o.customer.id, "name": o.customer.name, "phone": o.customer.phone} if o.customer else None,
        "items": [
            {"id": i.id, "offer_id": i.offer_id, "part_id": i.part_id, "title": i.title, "sku": i.sku, "price": i.price, "qty": i.qty}
            for i in o.items
        ],
    }
    if with_events:
        out["events"] = [
            {"from": e.from_status, "to": e.to_status, "note": e.note, "user_id": e.user_id, "created_at": e.created_at}
            for e in o.events
        ]
    return out


def _orders_query():
    # populate_existing: после смены статуса в той же сессии отдаём свежие события, а не кэш identity map
    return (
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.shop), selectinload(Order.customer), selectinload(Order.events))
        .execution_options(populate_existing=True)
    )


def _get(db: Session, order_id: int) -> Order:
    o = db.scalar(_orders_query().where(Order.id == order_id))
    if o is None:
        raise NotFound("Заказ не найден")
    return o


# --- покупатель ---------------------------------------------------------------------------------


@router.post("/orders/checkout", status_code=201)
def checkout(data: CheckoutIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    orders = service.checkout(db, user, [(i.offer_id, i.qty) for i in data.items], data.payment_mode, data.comment)
    return [order_out(_get(db, o.id)) for o in orders]


@router.get("/orders/my")
def my_orders(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(_orders_query().where(Order.buyer_id == user.id).order_by(Order.id.desc()).limit(200))
    return [order_out(o) for o in rows]


@router.get("/orders/{order_id}")
def get_order(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = _get(db, order_id)
    if o.buyer_id != user.id and user.role != "admin":
        is_member = db.scalar(select(ShopMember).where(ShopMember.shop_id == o.shop_id, ShopMember.user_id == user.id))
        if not is_member:
            raise Forbidden("Нет доступа к заказу")
    return order_out(o, with_events=True)


@router.post("/orders/{order_id}/cancel")
def buyer_cancel(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = _get(db, order_id)
    if o.buyer_id != user.id:
        raise Forbidden("Это не ваш заказ")
    if o.status not in ("pending", "confirmed"):
        raise Conflict("Заказ уже собран — для отмены свяжитесь с магазином")
    service.transition(db, o, "cancelled", user_id=user.id, note="Отменён покупателем")
    return order_out(_get(db, o.id), with_events=True)


@router.post("/orders/{order_id}/pay")
def pay(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = service.pay(db, _get(db, order_id), user)
    return order_out(_get(db, o.id), with_events=True)


# --- магазин ------------------------------------------------------------------------------------


@router.get("/shops/{shop_id}/orders")
def shop_orders(
    status: str | None = None,
    channel: str | None = None,
    customer_id: int | None = None,
    limit: int = Query(100, le=500),
    shop: Shop = Depends(shop_access),
    db: Session = Depends(get_db),
):
    stmt = _orders_query().where(Order.shop_id == shop.id)
    if status:
        stmt = stmt.where(Order.status.in_(status.split(",")))
    if channel:
        stmt = stmt.where(Order.channel == channel)
    if customer_id:
        stmt = stmt.where(Order.customer_id == customer_id)
    return [order_out(o) for o in db.scalars(stmt.order_by(Order.id.desc()).limit(limit))]


@router.get("/shops/{shop_id}/orders/by-code/{code}")
def by_code(code: str, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    o = service.find_by_pickup_code(db, shop, code)
    return order_out(_get(db, o.id), with_events=True)


@router.post("/shops/{shop_id}/orders/{order_id}/status")
def set_status(
    order_id: int, data: StatusIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    o = _get(db, order_id)
    if o.shop_id != shop.id:
        raise NotFound("Заказ не найден")
    service.transition(db, o, data.to, user_id=user.id, note=data.note)
    return order_out(_get(db, o.id), with_events=True)


@router.post("/shops/{shop_id}/orders/phone", status_code=201)
def phone_order(data: ShopOrderIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Бронь по телефону из CRM: резерв сразу виден маркетплейсу как недоступный остаток."""
    ensure_shop_can_trade(shop)
    o = service.phone_order(db, user, shop, [(i.offer_id, i.qty) for i in data.items], data.customer_id, data.comment)
    return order_out(_get(db, o.id), with_events=True)


@router.post("/shops/{shop_id}/pos/sale", status_code=201)
def pos_sale(data: ShopOrderIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Офлайн-продажа на кассе: списывает только свободный (незарезервированный) остаток."""
    ensure_shop_can_trade(shop)
    o = service.pos_sale(db, user, shop, [(i.offer_id, i.qty) for i in data.items], data.customer_id, data.comment)
    return order_out(_get(db, o.id), with_events=True)


@router.get("/shops/{shop_id}/orders/{order_id}/events")
def events(order_id: int, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(OrderEvent).join(Order, Order.id == OrderEvent.order_id)
        .where(Order.id == order_id, Order.shop_id == shop.id).order_by(OrderEvent.id)
    )
    return [{"from": e.from_status, "to": e.to_status, "note": e.note, "created_at": e.created_at} for e in rows]
