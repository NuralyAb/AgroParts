"""Главный инвариант платформы: Доступно = Физический остаток − Активные резервы."""

import threading

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.db import SessionLocal
from app.modules.inventory import service as inv
from app.modules.inventory.models import StockItem, StockMovement
from tests.conftest import auth


def stock_of(db, world) -> tuple[int, int, int]:
    """(физически, в резерве, доступно). Закрывает транзакцию, чтобы не держать write-lock SQLite."""
    db.expire_all()
    s = db.get(StockItem, world.stock)
    values = (s.on_hand, s.reserved, s.available)
    db.rollback()
    return values


def test_architecture_example_crm_and_marketplace_share_one_stock(client, db, world):
    """Пример из ТЗ: 5 шт. на складе, 1 в брони → онлайн доступно 4; продажа последней — товар недоступен."""
    # бронь по телефону из CRM
    r = client.post(f"/api/shops/{world.shop}/orders/phone", json={"items": [{"offer_id": world.offer, "qty": 1}]},
                    headers=auth(world.seller))
    assert r.status_code == 201, r.text

    part = client.get(f"/api/catalog/parts/{world.part}").json()
    assert part["offers"][0]["available"] == 4

    # офлайн-продажи на кассе выкупают всё свободное
    r = client.post(f"/api/shops/{world.shop}/pos/sale", json={"items": [{"offer_id": world.offer, "qty": 4}]},
                    headers=auth(world.seller))
    assert r.status_code == 201, r.text
    assert stock_of(db, world) == (1, 1, 0)

    # маркетплейс больше не даёт забронировать
    r = client.post("/api/orders/checkout", json={"items": [{"offer_id": world.offer, "qty": 1}]}, headers=auth(world.buyer))
    assert r.status_code == 409
    assert r.json()["code"] == "insufficient_stock"

    # и касса не может продать то, что отложено под бронь
    r = client.post(f"/api/shops/{world.shop}/pos/sale", json={"items": [{"offer_id": world.offer, "qty": 1}]},
                    headers=auth(world.seller))
    assert r.status_code == 409


def test_failed_order_leaves_no_partial_reservations(client, db, world):
    """Заказ из двух позиций, где второй не хватает, не должен зарезервировать и первую."""
    r = client.post(f"/api/shops/{world.shop}/offers", json={"title": "Подшипник", "price": 1000, "initial_qty": 1},
                    headers=auth(world.seller))
    second = r.json()["id"]
    client.post(f"/api/admin/offers/{second}/match", json={"part_id": world.part}, headers=auth(world.admin))
    r = client.post(f"/api/shops/{world.shop}/orders/phone",
                    json={"items": [{"offer_id": world.offer, "qty": 2}, {"offer_id": second, "qty": 3}]},
                    headers=auth(world.seller))
    assert r.status_code == 409
    assert stock_of(db, world)[1] == 0


def test_count_cannot_go_below_reserved(db, world):
    s = inv.lock_stock(db, [world.stock])[world.stock]
    inv.reserve(db, s, 3, order_item_id=None, order_id=None, expires_at=None, user_id=None)
    with pytest.raises(inv.InsufficientStock):
        inv.set_count(db, s, 2, user_id=None)
    inv.set_count(db, s, 3, user_id=None)
    assert (s.on_hand, s.reserved, s.available) == (3, 3, 0)


def test_database_check_constraint_is_last_line_of_defence(db, world):
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE stock_items SET reserved = on_hand + 1 WHERE id = :id"), {"id": world.stock})
        db.commit()
    db.rollback()


def test_every_change_is_journaled(db, world):
    s = inv.lock_stock(db, [world.stock])[world.stock]
    inv.receive(db, s, 2, user_id=world.seller)
    inv.sell(db, s, 1, user_id=world.seller, order_id=None)
    db.commit()
    kinds = [m.kind for m in db.query(StockMovement).filter_by(stock_item_id=world.stock).order_by(StockMovement.id)]
    assert kinds == ["receipt", "receipt", "sale"]
    last = db.query(StockMovement).order_by(StockMovement.id.desc()).first()
    assert (last.on_hand_after, last.on_hand_delta) == (6, -1)


def test_parallel_reservations_never_oversell(world):
    """20 одновременных броней по 1 шт. на остаток 5: успешных ровно 5."""
    ok, failed = [], []
    barrier = threading.Barrier(20)

    def worker():
        db = SessionLocal()
        barrier.wait()
        try:
            stocks = inv.lock_offer_stock(db, [world.offer])[world.offer]
            plan = inv.allocate(stocks, 1, "Ремень")
            for s, q in plan:
                inv.reserve(db, s, q, order_item_id=None, order_id=None, expires_at=None, user_id=None)
            db.commit()
            ok.append(1)
        except inv.InsufficientStock:
            db.rollback()
            failed.append(1)
        finally:
            db.close()

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    db = SessionLocal()
    s = db.get(StockItem, world.stock)
    assert len(ok) == 5 and len(failed) == 15
    assert (s.on_hand, s.reserved) == (5, 5)
    db.close()
