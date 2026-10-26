"""Складская логика: единственное место, где меняются on_hand и reserved.

Все операции:
  * блокируют строки остатков (SELECT ... FOR UPDATE в PostgreSQL, BEGIN IMMEDIATE в SQLite)
    в порядке возрастания id — чтобы параллельные заказы не взаимоблокировались;
  * проверяют инвариант 0 <= reserved <= on_hand;
  * пишут запись в журнал StockMovement.
Коммит делает вызывающий код — так заказ и все его резервы фиксируются одной транзакцией.
"""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import Conflict, DomainError, NotFound
from app.modules.inventory.models import Offer, Reservation, StockItem, StockMovement
from app.modules.shops.models import Shop


class InsufficientStock(Conflict):
    code = "insufficient_stock"


def lock_stock(db: Session, ids: Iterable[int]) -> dict[int, StockItem]:
    ids = sorted(set(ids))
    if not ids:
        return {}
    rows = db.scalars(
        select(StockItem)
        .where(StockItem.id.in_(ids))
        .order_by(StockItem.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {r.id: r for r in rows}


def lock_offer_stock(db: Session, offer_ids: Iterable[int]) -> dict[int, list[StockItem]]:
    """Блокирует все складские строки указанных предложений; возвращает {offer_id: [StockItem]}."""
    ids = db.scalars(select(StockItem.id).where(StockItem.offer_id.in_(set(offer_ids)))).all()
    locked = lock_stock(db, ids)
    result: dict[int, list[StockItem]] = {oid: [] for oid in offer_ids}
    for s in locked.values():
        result.setdefault(s.offer_id, []).append(s)
    return result


def _move(
    db: Session,
    stock: StockItem,
    kind: str,
    *,
    on_hand_delta: int = 0,
    reserved_delta: int = 0,
    user_id: int | None = None,
    order_id: int | None = None,
    note: str = "",
) -> None:
    new_on_hand = stock.on_hand + on_hand_delta
    new_reserved = stock.reserved + reserved_delta
    if new_on_hand < 0 or new_reserved < 0 or new_reserved > new_on_hand:
        raise InsufficientStock(
            f"Операция «{kind}» нарушает остаток: физически {stock.on_hand}, в резерве {stock.reserved}"
        )
    stock.on_hand = new_on_hand
    stock.reserved = new_reserved
    stock.updated_at = utcnow()
    db.add(
        StockMovement(
            stock_item_id=stock.id,
            kind=kind,
            on_hand_delta=on_hand_delta,
            reserved_delta=reserved_delta,
            on_hand_after=new_on_hand,
            reserved_after=new_reserved,
            order_id=order_id,
            user_id=user_id,
            note=note,
        )
    )


# --- операции с физическим остатком -------------------------------------------------------


def receive(db: Session, stock: StockItem, qty: int, *, user_id: int | None, note: str = "") -> None:
    if qty <= 0:
        raise DomainError("Количество поступления должно быть больше нуля")
    _move(db, stock, "receipt", on_hand_delta=qty, user_id=user_id, note=note)


def set_count(db: Session, stock: StockItem, counted: int, *, user_id: int | None, kind: str = "count", note: str = "") -> None:
    """Инвентаризация / импорт / синхронизация: устанавливает фактический остаток."""
    if counted < 0:
        raise DomainError("Остаток не может быть отрицательным")
    if counted < stock.reserved:
        raise InsufficientStock(
            f"Фактический остаток {counted} меньше зарезервированного ({stock.reserved}). "
            "Сначала отмените или выдайте брони."
        )
    delta = counted - stock.on_hand
    _move(db, stock, kind, on_hand_delta=delta, user_id=user_id, note=note)


def sell(db: Session, stock: StockItem, qty: int, *, user_id: int | None, order_id: int | None, note: str = "") -> None:
    """Продажа без брони (касса). Нельзя продать то, что уже отложено под чужой заказ."""
    if stock.available < qty:
        raise InsufficientStock(f"Доступно только {stock.available} шт. (ещё {stock.reserved} шт. в резерве)")
    _move(db, stock, "sale", on_hand_delta=-qty, user_id=user_id, order_id=order_id, note=note)


# --- резервы --------------------------------------------------------------------------------


def allocate(stocks: list[StockItem], qty: int, title: str) -> list[tuple[StockItem, int]]:
    """Распределяет количество по складам магазина: сначала склад с наибольшим доступным остатком."""
    if qty <= 0:
        raise DomainError("Количество должно быть больше нуля")
    total = sum(max(s.available, 0) for s in stocks)
    if total < qty:
        raise InsufficientStock(f"Недостаточно товара «{title}»: доступно {total} шт., запрошено {qty} шт.")
    plan: list[tuple[StockItem, int]] = []
    left = qty
    for s in sorted(stocks, key=lambda s: (-s.available, s.id)):
        if left == 0:
            break
        take = min(s.available, left)
        if take > 0:
            plan.append((s, take))
            left -= take
    return plan


def reserve(
    db: Session,
    stock: StockItem,
    qty: int,
    *,
    order_item_id: int | None,
    order_id: int | None,
    expires_at: datetime | None,
    user_id: int | None,
) -> Reservation:
    if stock.available < qty:
        raise InsufficientStock(f"Доступно только {stock.available} шт.")
    _move(db, stock, "reserve", reserved_delta=qty, user_id=user_id, order_id=order_id)
    r = Reservation(
        stock_item_id=stock.id, order_item_id=order_item_id, qty=qty, expires_at=expires_at, created_by=user_id
    )
    db.add(r)
    return r


def release(db: Session, r: Reservation, stock: StockItem, *, user_id: int | None, order_id: int | None, note: str = "") -> None:
    if r.status != "active":
        return
    _move(db, stock, "release", reserved_delta=-r.qty, user_id=user_id, order_id=order_id, note=note)
    r.status = "released"
    r.closed_at = utcnow()


def fulfill(db: Session, r: Reservation, stock: StockItem, *, user_id: int | None, order_id: int | None) -> None:
    """Выдача забронированного товара: уменьшаются и резерв, и физический остаток."""
    if r.status != "active":
        raise Conflict("Резерв уже закрыт")
    _move(db, stock, "issue", on_hand_delta=-r.qty, reserved_delta=-r.qty, user_id=user_id, order_id=order_id)
    r.status = "fulfilled"
    r.closed_at = utcnow()


# --- справочные операции --------------------------------------------------------------------


def get_or_create_stock(db: Session, offer: Offer, warehouse_id: int) -> StockItem:
    stock = db.scalar(select(StockItem).where(StockItem.offer_id == offer.id, StockItem.warehouse_id == warehouse_id))
    if stock is None:
        stock = StockItem(offer_id=offer.id, warehouse_id=warehouse_id)
        db.add(stock)
        db.flush()
    return lock_stock(db, [stock.id])[stock.id]


def default_warehouse_id(db: Session, shop: Shop) -> int:
    if not shop.warehouses:
        raise NotFound("У магазина нет ни одного склада")
    return shop.warehouses[0].id


def next_sku(db: Session, shop: Shop) -> str:
    # Блокируем строку магазина, чтобы параллельные импорты не выдали одинаковый номер.
    db.execute(select(Shop).where(Shop.id == shop.id).with_for_update().execution_options(populate_existing=True))
    while True:  # пропускаем номера, уже занятые кодами, введёнными вручную
        shop.sku_seq += 1
        sku = f"{shop.code}-{shop.sku_seq:06d}"
        if db.scalar(select(Offer.id).where(Offer.shop_id == shop.id, Offer.sku == sku)) is None:
            return sku
