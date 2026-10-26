import os
import tempfile
from dataclasses import dataclass

_tmp = tempfile.mkdtemp(prefix="agroparts-test-")
os.environ["AGRO_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["AGRO_RUN_BACKGROUND_JOBS"] = "false"
os.environ["AGRO_PASSWORD_ITERATIONS"] = "1000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.core.security import create_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.auth.models import User  # noqa: E402
from app.modules.catalog import search as search_index  # noqa: E402
from app.modules.catalog.models import Brand, Compatibility, MachineModel  # noqa: E402
from app.modules.catalog.router import NumberIn, PartIn, create_part  # noqa: E402
from app.modules.inventory import service as inv  # noqa: E402
from app.modules.inventory.models import Offer  # noqa: E402
from app.modules.shops.models import Shop, ShopMember, Warehouse  # noqa: E402


@dataclass
class World:
    admin: int
    seller: int
    buyer: int
    other_seller: int
    shop: int
    other_shop: int
    part: int
    model: int
    offer: int
    stock: int


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    search_index.invalidate()
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def world(db) -> World:
    pw = hash_password("secret123")
    users = [User(phone=f"+7700000000{i}", name=f"u{i}", password_hash=pw, role=r) for i, r in
             enumerate(["admin", "buyer", "buyer", "buyer"], start=1)]
    db.add_all(users)
    db.flush()
    admin, seller, buyer, other_seller = users

    shop = Shop(name="Магазин А", code="AAA", status="verified")
    other = Shop(name="Магазин Б", code="BBB", status="verified")
    db.add_all([shop, other])
    db.flush()
    db.add_all([
        Warehouse(shop_id=shop.id, name="Склад"), Warehouse(shop_id=other.id, name="Склад"),
        ShopMember(shop_id=shop.id, user_id=seller.id, role="owner"),
        ShopMember(shop_id=other.id, user_id=other_seller.id, role="owner"),
    ])
    brand = Brand(name="Ростсельмаш")
    db.add(brand)
    db.flush()
    model = MachineModel(brand_id=brand.id, name="Дон-1500Б", kind="combine")
    db.add(model)
    db.flush()
    part = create_part(db, PartIn(name="Ремень привода жатки", numbers=[NumberIn(number="4HB-4330", kind="manufacturer")]))
    db.add(Compatibility(part_id=part.id, model_id=model.id, source="тест", verified=True))
    db.flush()
    db.refresh(shop)

    offer = Offer(shop_id=shop.id, sku="AAA-000001", title="Ремень жатки", article="4HB-4330", price=8500,
                  part_id=part.id, match_status="matched")
    db.add(offer)
    db.flush()
    stock = inv.get_or_create_stock(db, offer, shop.warehouses[0].id)
    inv.receive(db, stock, 5, user_id=seller.id)
    db.commit()
    return World(admin.id, seller.id, buyer.id, other_seller.id, shop.id, other.id, part.id, model.id, offer.id, stock.id)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def auth(user_id: int) -> dict:
    return {"Authorization": f"Bearer {create_token(user_id)}"}
