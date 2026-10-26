from datetime import timedelta

from app.core.db import utcnow
from app.modules.inventory.models import StockItem
from app.modules.orders import service
from app.modules.orders.models import Order
from tests.conftest import auth


def checkout(client, world, qty=2, payment_mode="on_pickup"):
    r = client.post("/api/orders/checkout", json={"items": [{"offer_id": world.offer, "qty": qty}], "payment_mode": payment_mode},
                    headers=auth(world.buyer))
    assert r.status_code == 201, r.text
    return r.json()[0]


def status(client, world, order_id, to, user=None):
    return client.post(f"/api/shops/{world.shop}/orders/{order_id}/status", json={"to": to}, headers=auth(user or world.seller))


def stock(db, world):
    db.expire_all()
    s = db.get(StockItem, world.stock)
    values = s.on_hand, s.reserved
    db.rollback()  # не держим write-lock SQLite между запросами
    return values


def test_full_pickup_flow(client, db, world):
    order = checkout(client, world, qty=2)
    assert order["status"] == "pending" and order["total"] == 17000 and order["pickup_code"]
    assert stock(db, world) == (5, 2)

    # CRM видит бронь и клиента
    shop_orders = client.get(f"/api/shops/{world.shop}/orders?status=pending", headers=auth(world.seller)).json()
    assert [o["id"] for o in shop_orders] == [order["id"]]
    assert shop_orders[0]["customer"]["name"] == "u3"

    for to in ("confirmed", "ready"):
        assert status(client, world, order["id"], to).status_code == 200
    found = client.get(f"/api/shops/{world.shop}/orders/by-code/{order['pickup_code']}", headers=auth(world.seller))
    assert found.json()["id"] == order["id"]

    r = status(client, world, order["id"], "issued")
    assert r.json()["status"] == "issued" and r.json()["payment_status"] == "paid"
    assert stock(db, world) == (3, 0)
    assert [e["to"] for e in r.json()["events"]] == ["pending", "confirmed", "ready", "issued"]


def test_cancel_returns_stock(client, db, world):
    order = checkout(client, world, qty=3)
    r = client.post(f"/api/orders/{order['id']}/cancel", headers=auth(world.buyer))
    assert r.json()["status"] == "cancelled"
    assert stock(db, world) == (5, 0)
    # повторная отмена — ошибка, остаток не «удваивается»
    assert client.post(f"/api/orders/{order['id']}/cancel", headers=auth(world.buyer)).status_code == 409
    assert stock(db, world) == (5, 0)


def test_invalid_transition_rejected(client, world):
    order = checkout(client, world)
    assert status(client, world, order["id"], "issued").status_code == 409  # сначала подтвердить


def test_expired_reservations_are_released(client, db, world):
    order = checkout(client, world, qty=4)
    db.get(Order, order["id"]).expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert service.expire_stale(db) == 1
    db.expire_all()
    o = db.get(Order, order["id"])
    assert o.status == "cancelled" and o.cancel_reason == "Срок брони истёк"
    assert stock(db, world) == (5, 0)


def test_online_payment_required_before_issue(client, world):
    order = checkout(client, world, payment_mode="online")
    status(client, world, order["id"], "confirmed")
    assert status(client, world, order["id"], "issued").status_code == 409
    r = client.post(f"/api/orders/{order['id']}/pay", headers=auth(world.buyer))
    assert r.json()["payment_status"] == "paid"
    assert status(client, world, order["id"], "issued").status_code == 200


def test_seller_cannot_touch_other_shop(client, world):
    order = checkout(client, world)
    assert status(client, world, order["id"], "confirmed", user=world.other_seller).status_code == 403
    r = client.get(f"/api/shops/{world.shop}/offers", headers=auth(world.other_seller))
    assert r.status_code == 403


def test_unverified_shop_cannot_sell_online(client, db, world):
    from app.modules.shops.models import Shop

    db.get(Shop, world.shop).status = "pending"
    db.commit()
    r = client.post("/api/orders/checkout", json={"items": [{"offer_id": world.offer, "qty": 1}]}, headers=auth(world.buyer))
    assert r.status_code == 409
    assert client.get(f"/api/catalog/parts/{world.part}").json()["offers"] == []
