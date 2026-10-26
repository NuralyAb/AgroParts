import re
import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user, shop_access
from app.core.errors import Conflict, Forbidden, NotFound
from app.modules.auth.models import User
from app.modules.auth.router import normalize_phone
from app.modules.shops.models import Shop, ShopMember, Warehouse

router = APIRouter(tags=["shops"])


def shop_public(s: Shop) -> dict:
    return {
        "id": s.id, "name": s.name, "city": s.city, "address": s.address, "phone": s.phone,
        "description": s.description, "delivery_available": s.delivery_available, "status": s.status,
    }


def shop_private(s: Shop) -> dict:
    return {
        **shop_public(s),
        "code": s.code,
        "bin": s.bin,
        "has_api_key": bool(s.api_key),
        "warehouses": [
            {"id": w.id, "name": w.name, "address": w.address, "is_pickup_point": w.is_pickup_point} for w in s.warehouses
        ],
    }


@router.get("/shops")
def list_shops(db: Session = Depends(get_db)):
    return [shop_public(s) for s in db.scalars(select(Shop).where(Shop.status == "verified").order_by(Shop.name))]


@router.get("/shops/{shop_id}/public")
def get_shop_public(shop_id: int, db: Session = Depends(get_db)):
    s = db.get(Shop, shop_id)
    if s is None or s.status != "verified":
        raise NotFound("Магазин не найден")
    return shop_public(s)


class ShopIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    bin: str | None = Field(None, pattern=r"^\d{12}$", description="БИН — 12 цифр")
    city: str = "Костанай"
    address: str = ""
    phone: str = ""
    description: str = ""
    delivery_available: bool = False


def _make_code(db: Session, name: str) -> str:
    base = re.sub(r"[^A-Z]", "", name.upper())[:4] or "SHOP"
    n = (db.scalar(select(func.count()).select_from(Shop)) or 0) + 1
    while True:
        code = f"{base}{n}"
        if not db.scalar(select(Shop.id).where(Shop.code == code)):
            return code
        n += 1


@router.post("/shops", status_code=201)
def register_shop(data: ShopIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Регистрация магазина. До проверки администратором (status=pending) магазин не виден покупателям."""
    shop = Shop(**data.model_dump(), code=_make_code(db, data.name), status="pending")
    db.add(shop)
    db.flush()
    db.add(ShopMember(shop_id=shop.id, user_id=user.id, role="owner"))
    db.add(Warehouse(shop_id=shop.id, name="Основной склад", address=data.address))
    db.commit()
    db.refresh(shop)
    return shop_private(shop)


@router.get("/shops/{shop_id}")
def get_shop(shop: Shop = Depends(shop_access)):
    return shop_private(shop)


class ShopPatch(BaseModel):
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    description: str | None = None
    delivery_available: bool | None = None


@router.patch("/shops/{shop_id}")
def patch_shop(data: ShopPatch, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(shop, k, v)
    db.commit()
    return shop_private(shop)


class WarehouseIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = ""
    is_pickup_point: bool = True


@router.post("/shops/{shop_id}/warehouses", status_code=201)
def add_warehouse(data: WarehouseIn, shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    db.add(Warehouse(shop_id=shop.id, **data.model_dump()))
    db.commit()
    db.refresh(shop)
    return shop_private(shop)


@router.get("/shops/{shop_id}/members")
def members(shop: Shop = Depends(shop_access), db: Session = Depends(get_db)):
    rows = db.execute(
        select(ShopMember, User).join(User, User.id == ShopMember.user_id).where(ShopMember.shop_id == shop.id)
    ).all()
    return [{"user_id": u.id, "name": u.name, "phone": u.phone, "role": m.role} for m, u in rows]


class MemberIn(BaseModel):
    phone: str
    role: str = Field("staff", pattern="^(owner|staff)$")


def _require_owner(db: Session, shop: Shop, user: User) -> None:
    if user.role == "admin":
        return
    m = db.scalar(select(ShopMember).where(ShopMember.shop_id == shop.id, ShopMember.user_id == user.id))
    if m is None or m.role != "owner":
        raise Forbidden("Только владелец магазина может управлять сотрудниками")


@router.post("/shops/{shop_id}/members", status_code=201)
def add_member(
    data: MemberIn, shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    _require_owner(db, shop, user)
    target = db.scalar(select(User).where(User.phone == normalize_phone(data.phone)))
    if target is None:
        raise NotFound("Пользователь с таким телефоном не зарегистрирован")
    if db.scalar(select(ShopMember).where(ShopMember.shop_id == shop.id, ShopMember.user_id == target.id)):
        raise Conflict("Сотрудник уже добавлен")
    db.add(ShopMember(shop_id=shop.id, user_id=target.id, role=data.role))
    db.commit()
    return members(shop, db)


@router.post("/shops/{shop_id}/api-key")
def rotate_api_key(shop: Shop = Depends(shop_access), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Ключ для синхронизации с 1С / внешней учётной системой. Показывается один раз."""
    _require_owner(db, shop, user)
    shop.api_key = secrets.token_urlsafe(32)
    db.commit()
    return {"api_key": shop.api_key}
