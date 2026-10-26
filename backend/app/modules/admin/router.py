from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import require_admin, require_catalog_editor
from app.core.errors import DomainError, NotFound
from app.modules.auth.models import User
from app.modules.catalog import service as catalog
from app.modules.catalog.models import Compatibility, MachineModel, Part, PartAnalog
from app.modules.catalog.router import PartIn, create_part
from app.modules.integrations.matching import suggestions
from app.modules.inventory.models import Offer
from app.modules.orders.models import Order
from app.modules.shops.models import Shop

router = APIRouter(prefix="/admin", tags=["admin"])


# --- магазины -----------------------------------------------------------------------------------


@router.get("/shops")
def shops(status: str | None = None, db: Session = Depends(get_db), _u: User = Depends(require_admin)):
    stmt = select(Shop).order_by(Shop.id)
    if status:
        stmt = stmt.where(Shop.status == status)
    shops_ = db.scalars(stmt).all()
    offers = dict(db.execute(select(Offer.shop_id, func.count(Offer.id)).group_by(Offer.shop_id)).all())
    return [
        {
            "id": s.id, "name": s.name, "code": s.code, "bin": s.bin, "city": s.city, "address": s.address,
            "phone": s.phone, "status": s.status, "offers": offers.get(s.id, 0), "created_at": s.created_at,
        }
        for s in shops_
    ]


class ShopStatusIn(BaseModel):
    status: str = Field(pattern="^(pending|verified|blocked)$")


@router.post("/shops/{shop_id}/status")
def set_shop_status(shop_id: int, data: ShopStatusIn, db: Session = Depends(get_db), _u: User = Depends(require_admin)):
    s = db.get(Shop, shop_id)
    if s is None:
        raise NotFound("Магазин не найден")
    s.status = data.status
    db.commit()
    return {"id": s.id, "status": s.status}


# --- пользователи -------------------------------------------------------------------------------


@router.get("/users")
def users(q: str | None = None, db: Session = Depends(get_db), _u: User = Depends(require_admin)):
    stmt = select(User).order_by(User.id).limit(500)
    if q:
        stmt = stmt.where(or_(User.name.ilike(f"%{q}%"), User.phone.ilike(f"%{q}%")))
    return [
        {"id": u.id, "name": u.name, "phone": u.phone, "role": u.role, "is_active": u.is_active, "created_at": u.created_at}
        for u in db.scalars(stmt)
    ]


class UserPatch(BaseModel):
    role: str | None = Field(None, pattern="^(buyer|admin|content_manager)$")
    is_active: bool | None = None


@router.patch("/users/{user_id}")
def patch_user(user_id: int, data: UserPatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, user_id)
    if u is None:
        raise NotFound("Пользователь не найден")
    if u.id == admin.id and (data.role not in (None, "admin") or data.is_active is False):
        raise DomainError("Нельзя лишить прав самого себя")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(u, k, v)
    db.commit()
    return {"id": u.id, "role": u.role, "is_active": u.is_active}


# --- сопоставление предложений с каталогом ------------------------------------------------------


@router.get("/offers/review")
def review_queue(limit: int = Query(50, le=200), db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    rows = db.scalars(
        select(Offer).where(Offer.match_status == "review").order_by(Offer.id).limit(limit).options(selectinload(Offer.shop))
    ).all()
    return [
        {
            "id": o.id, "shop": o.shop.name, "sku": o.sku, "title": o.title, "article": o.article,
            "manufacturer": o.manufacturer, "price": o.price, "suggestions": suggestions(db, o),
        }
        for o in rows
    ]


class MatchIn(BaseModel):
    part_id: int | None = None
    create_part: PartIn | None = None
    reject: bool = False


@router.post("/offers/{offer_id}/match")
def match_offer(offer_id: int, data: MatchIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    o = db.get(Offer, offer_id)
    if o is None:
        raise NotFound("Предложение не найдено")
    if data.reject:
        o.part_id, o.match_status = None, "unmatched"
    else:
        if data.create_part is not None:
            part_id = create_part(db, data.create_part).id
        elif data.part_id is not None:
            if db.get(Part, data.part_id) is None:
                raise NotFound("Запчасть не найдена")
            part_id = data.part_id
        else:
            raise DomainError("Укажите part_id, create_part или reject")
        o.part_id, o.match_status = part_id, "matched"
    db.commit()
    return {"id": o.id, "part_id": o.part_id, "match_status": o.match_status}


# --- модерация совместимости и аналогов ---------------------------------------------------------


@router.get("/compatibility/pending")
def pending_compat(db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    rows = db.scalars(
        select(Compatibility).where(Compatibility.verified.is_(False)).order_by(Compatibility.id)
        .options(selectinload(Compatibility.part), selectinload(Compatibility.model).selectinload(MachineModel.brand),
                 selectinload(Compatibility.modification))
    ).all()
    return [{**catalog.compat_row(c), "part": {"id": c.part.id, "name": c.part.name}} for c in rows]


class VerifyIn(BaseModel):
    approve: bool


@router.post("/compatibility/{compat_id}/verify")
def verify_compat(compat_id: int, data: VerifyIn, db: Session = Depends(get_db), user: User = Depends(require_catalog_editor)):
    c = db.get(Compatibility, compat_id)
    if c is None:
        raise NotFound("Запись не найдена")
    if data.approve:
        c.verified, c.verified_by = True, user.id
    else:
        db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/analogs/pending")
def pending_analogs(db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    rows = db.scalars(
        select(PartAnalog).where(PartAnalog.verified.is_(False))
        .options(selectinload(PartAnalog.part), selectinload(PartAnalog.analog))
    ).all()
    return [
        {"id": a.id, "part": {"id": a.part.id, "name": a.part.name}, "analog": {"id": a.analog.id, "name": a.analog.name},
         "source": a.source, "note": a.note}
        for a in rows
    ]


@router.post("/analogs/{analog_link_id}/verify")
def verify_analog(analog_link_id: int, data: VerifyIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    a = db.get(PartAnalog, analog_link_id)
    if a is None:
        raise NotFound("Запись не найдена")
    if data.approve:
        a.verified = True
    else:
        db.delete(a)
    db.commit()
    return {"ok": True}


# --- статистика и заказы ------------------------------------------------------------------------


@router.get("/stats")
def stats(db: Session = Depends(get_db), _u: User = Depends(require_admin)):
    count = lambda model, *w: db.scalar(select(func.count()).select_from(model).where(*w)) or 0  # noqa: E731
    by_status = dict(db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status)).all())
    by_channel = {
        ch: {"orders": n, "revenue": r}
        for ch, n, r in db.execute(
            select(Order.channel, func.count(Order.id), func.coalesce(func.sum(Order.total), 0))
            .where(Order.status == "issued").group_by(Order.channel)
        )
    }
    return {
        "shops": {"total": count(Shop), "verified": count(Shop, Shop.status == "verified"), "pending": count(Shop, Shop.status == "pending")},
        "users": count(User),
        "parts": count(Part),
        "offers": {"total": count(Offer), "review": count(Offer, Offer.match_status == "review")},
        "compat_pending": count(Compatibility, Compatibility.verified.is_(False)),
        "orders_by_status": by_status,
        "issued_by_channel": by_channel,
    }


@router.get("/orders")
def orders(status: str | None = None, db: Session = Depends(get_db), _u: User = Depends(require_admin)):
    from app.modules.orders.router import _orders_query, order_out

    stmt = _orders_query().order_by(Order.id.desc()).limit(200)
    if status:
        stmt = stmt.where(Order.status == status)
    return [order_out(o) for o in db.scalars(stmt)]
