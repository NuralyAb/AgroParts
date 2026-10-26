"""Заказы всех каналов поверх одного склада.

  marketplace — онлайн-бронь/покупка фермера: товар резервируется сразу, магазин подтверждает;
  phone       — продавец оформляет бронь в CRM по звонку: сразу подтверждена;
  pos         — продажа на кассе: остаток списывается сразу, без резерва.
"""

import secrets
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.db import utcnow
from app.core.errors import Conflict, DomainError, Forbidden, NotFound
from app.modules.auth.models import User
from app.modules.crm.models import Customer
from app.modules.inventory import service as inv
from app.modules.inventory.models import Offer, Reservation, StockItem
from app.modules.orders import notifications
from app.modules.orders.models import ACTIVE_STATUSES, Order, OrderEvent, OrderItem
from app.modules.orders.payments import provider
from app.modules.shops.models import Shop

TRANSITIONS: dict[str, set[str]] = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"ready", "issued", "cancelled"},
    "ready": {"issued", "cancelled"},
}

Line = tuple[int, int]  # (offer_id, qty)


def _merge_lines(lines: list[Line]) -> dict[int, int]:
    merged: dict[int, int] = defaultdict(int)
    for offer_id, qty in lines:
        if qty <= 0:
            raise DomainError("Количество должно быть больше нуля")
        merged[offer_id] += qty
    if not merged:
        raise DomainError("Заказ пуст")
    return merged


def _load_offers(db: Session, ids: list[int]) -> dict[int, Offer]:
    offers = db.scalars(select(Offer).where(Offer.id.in_(ids)).options(selectinload(Offer.shop))).all()
    found = {o.id: o for o in offers}
    missing = set(ids) - set(found)
    if missing:
        raise NotFound(f"Предложения не найдены: {sorted(missing)}")
    return found


def _log_event(db: Session, order: Order, from_status: str | None, user_id: int | None, note: str = "") -> None:
    db.add(OrderEvent(order_id=order.id, from_status=from_status, to_status=order.status, user_id=user_id, note=note))


def customer_for_user(db: Session, shop: Shop, user: User) -> Customer:
    c = db.scalar(select(Customer).where(Customer.shop_id == shop.id, Customer.user_id == user.id))
    if c is None:
        c = Customer(shop_id=shop.id, user_id=user.id, name=user.name, phone=user.phone)
        db.add(c)
        db.flush()
    return c


def _create_order(
    db: Session,
    *,
    shop: Shop,
    offers: dict[int, Offer],
    lines: dict[int, int],
    channel: str,
    status: str,
    buyer_id: int | None,
    customer_id: int | None,
    payment_mode: str,
    comment: str,
    user_id: int | None,
    expires_at: datetime | None,
) -> Order:
    stock_by_offer = inv.lock_offer_stock(db, lines.keys())
    order = Order(
        shop_id=shop.id,
        buyer_id=buyer_id,
        customer_id=customer_id,
        channel=channel,
        status=status,
        payment_mode=payment_mode,
        comment=comment,
        expires_at=expires_at,
        pickup_code=f"{secrets.randbelow(10**6):06d}" if channel != "pos" else None,
    )
    db.add(order)
    db.flush()
    order.number = f"AP-{order.id:06d}"

    total = 0
    for offer_id, qty in lines.items():
        offer = offers[offer_id]
        item = OrderItem(
            order_id=order.id, offer_id=offer.id, part_id=offer.part_id, title=offer.title, sku=offer.sku,
            price=offer.price, qty=qty,
        )
        db.add(item)
        db.flush()
        total += offer.price * qty
        plan = inv.allocate(stock_by_offer.get(offer_id, []), qty, offer.title)
        for stock, q in plan:
            if channel == "pos":
                inv.sell(db, stock, q, user_id=user_id, order_id=order.id)
            else:
                inv.reserve(db, stock, q, order_item_id=item.id, order_id=order.id, expires_at=expires_at, user_id=user_id)
    order.total = total
    if channel == "pos":
        order.payment_status = "paid"
    _log_event(db, order, None, user_id)
    return order


def checkout(db: Session, buyer: User, lines: list[Line], payment_mode: str, comment: str = "") -> list[Order]:
    """Корзина фермера → по одному заказу на магазин. Всё или ничего: одна транзакция."""
    merged = _merge_lines(lines)
    offers = _load_offers(db, list(merged))
    by_shop: dict[int, dict[int, int]] = defaultdict(dict)
    for offer_id, qty in merged.items():
        o = offers[offer_id]
        if not o.is_active or o.part_id is None or o.match_status != "matched":
            raise Conflict(f"Предложение «{o.title}» сейчас недоступно для заказа")
        if o.shop.status != "verified":
            raise Conflict(f"Магазин «{o.shop.name}» не принимает онлайн-заказы")
        by_shop[o.shop_id][offer_id] = qty

    expires = utcnow() + timedelta(minutes=settings.pending_order_ttl_minutes)
    orders = []
    for shop_id, shop_lines in sorted(by_shop.items()):
        shop = offers[next(iter(shop_lines))].shop
        customer = customer_for_user(db, shop, buyer)
        orders.append(
            _create_order(
                db, shop=shop, offers=offers, lines=shop_lines, channel="marketplace", status="pending",
                buyer_id=buyer.id, customer_id=customer.id, payment_mode=payment_mode, comment=comment,
                user_id=buyer.id, expires_at=expires,
            )
        )
    db.commit()
    for o in orders:
        notifications.order_status_changed(o)
    return orders


def _shop_offers(db: Session, shop: Shop, lines: list[Line]) -> tuple[dict[int, Offer], dict[int, int]]:
    merged = _merge_lines(lines)
    offers = _load_offers(db, list(merged))
    for o in offers.values():
        if o.shop_id != shop.id:
            raise Forbidden("Товар принадлежит другому магазину")
    return offers, merged


def _check_customer(db: Session, shop: Shop, customer_id: int | None) -> None:
    if customer_id is not None:
        c = db.get(Customer, customer_id)
        if c is None or c.shop_id != shop.id:
            raise NotFound("Клиент не найден")


def phone_order(db: Session, seller: User, shop: Shop, lines: list[Line], customer_id: int | None, comment: str) -> Order:
    offers, merged = _shop_offers(db, shop, lines)
    _check_customer(db, shop, customer_id)
    order = _create_order(
        db, shop=shop, offers=offers, lines=merged, channel="phone", status="confirmed", buyer_id=None,
        customer_id=customer_id, payment_mode="on_pickup", comment=comment, user_id=seller.id,
        expires_at=utcnow() + timedelta(hours=settings.confirmed_hold_hours),
    )
    db.commit()
    return order


def pos_sale(db: Session, seller: User, shop: Shop, lines: list[Line], customer_id: int | None, comment: str) -> Order:
    offers, merged = _shop_offers(db, shop, lines)
    _check_customer(db, shop, customer_id)
    order = _create_order(
        db, shop=shop, offers=offers, lines=merged, channel="pos", status="issued", buyer_id=None,
        customer_id=customer_id, payment_mode="on_pickup", comment=comment, user_id=seller.id, expires_at=None,
    )
    db.commit()
    return order


def _active_reservations(db: Session, order: Order) -> list[Reservation]:
    item_ids = [i.id for i in order.items]
    if not item_ids:
        return []
    return list(
        db.scalars(
            select(Reservation)
            .where(Reservation.order_item_id.in_(item_ids), Reservation.status == "active")
            .order_by(Reservation.id)
        ).all()
    )


def transition(db: Session, order: Order, to: str, *, user_id: int | None, note: str = "", commit: bool = True) -> Order:
    # Блокируем заказ: покупатель может отменять, пока продавец его выдаёт.
    db.execute(select(Order).where(Order.id == order.id).with_for_update().execution_options(populate_existing=True))
    allowed = TRANSITIONS.get(order.status, set())
    if to not in allowed:
        raise Conflict(f"Нельзя перевести заказ из статуса «{order.status}» в «{to}»")
    if to == "issued" and order.payment_mode == "online" and order.payment_status != "paid":
        raise Conflict("Заказ с онлайн-оплатой ещё не оплачен")

    reservations = _active_reservations(db, order)
    stocks = inv.lock_stock(db, [r.stock_item_id for r in reservations])
    now = utcnow()

    if to == "confirmed":
        hold = now + timedelta(hours=settings.confirmed_hold_hours)
        order.expires_at = hold
        for r in reservations:
            r.expires_at = hold
    elif to == "issued":
        for r in reservations:
            inv.fulfill(db, r, stocks[r.stock_item_id], user_id=user_id, order_id=order.id)
        if order.payment_mode == "on_pickup":
            order.payment_status = "paid"
        order.expires_at = None
    elif to == "cancelled":
        for r in reservations:
            inv.release(db, r, stocks[r.stock_item_id], user_id=user_id, order_id=order.id, note=note)
        order.cancel_reason = note or None
        order.expires_at = None
        if order.payment_status == "paid":
            order.payment_status = "refund_pending"

    prev = order.status
    order.status = to
    _log_event(db, order, prev, user_id, note)
    if commit:
        db.commit()
        notifications.order_status_changed(order)
    return order


def pay(db: Session, order: Order, buyer: User) -> Order:
    if order.buyer_id != buyer.id:
        raise Forbidden("Это не ваш заказ")
    if order.payment_mode != "online":
        raise Conflict("Заказ оплачивается при получении")
    if order.status == "cancelled":
        raise Conflict("Заказ отменён")
    if order.payment_status == "paid":
        return order
    provider.charge(order.number, order.total)
    order.payment_status = "paid"
    _log_event(db, order, order.status, buyer.id, "Оплачен онлайн")
    db.commit()
    return order


def expire_stale(db: Session, now: datetime | None = None) -> int:
    """Отменяет брони, срок которых истёк, и возвращает товар в доступный остаток."""
    now = now or utcnow()
    ids = db.scalars(
        select(Order.id).where(Order.status.in_(ACTIVE_STATUSES), Order.expires_at.is_not(None), Order.expires_at < now)
    ).all()
    for order_id in ids:
        order = db.get(Order, order_id)
        if order and order.status in ACTIVE_STATUSES:
            transition(db, order, "cancelled", user_id=None, note="Срок брони истёк", commit=False)
    db.commit()
    return len(ids)


def find_by_pickup_code(db: Session, shop: Shop, code: str) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.shop_id == shop.id, Order.pickup_code == code.strip(), Order.status.in_(ACTIVE_STATUSES))
        .order_by(Order.id.desc())
    )
    if order is None:
        raise NotFound("Активный заказ с таким кодом не найден")
    return order


def stock_snapshot(db: Session, offer_ids: list[int]) -> dict[int, dict]:
    """Сводка остатков по предложениям: физически / в резерве / доступно / когда обновлено."""
    rows = db.scalars(select(StockItem).where(StockItem.offer_id.in_(offer_ids))).all()
    out: dict[int, dict] = {}
    for s in rows:
        agg = out.setdefault(s.offer_id, {"on_hand": 0, "reserved": 0, "available": 0, "updated_at": None})
        agg["on_hand"] += s.on_hand
        agg["reserved"] += s.reserved
        agg["available"] += s.available
        if agg["updated_at"] is None or s.updated_at > agg["updated_at"]:
            agg["updated_at"] = s.updated_at
    return out
