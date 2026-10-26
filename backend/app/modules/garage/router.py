from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import current_user
from app.core.errors import Conflict, DomainError, NotFound
from app.modules.auth.models import User
from app.modules.catalog import service as catalog
from app.modules.catalog.models import MachineModel, Modification, Part
from app.modules.garage.models import Favorite, Vehicle
from app.modules.shops.models import Shop

router = APIRouter(tags=["garage"])


def vehicle_out(v: Vehicle) -> dict:
    return {
        "id": v.id, "title": v.title, "model_id": v.model_id,
        "model": f"{v.model.brand.name} {v.model.name}", "kind": v.model.kind,
        "modification_id": v.modification_id, "modification": v.modification.name if v.modification else None,
        "year": v.year, "serial_number": v.serial_number,
    }


def _vehicles(db: Session, user: User):
    return db.scalars(
        select(Vehicle).where(Vehicle.user_id == user.id).order_by(Vehicle.id)
        .options(selectinload(Vehicle.model).selectinload(MachineModel.brand), selectinload(Vehicle.modification))
    ).all()


def _own_vehicle(db: Session, user: User, vehicle_id: int) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None or v.user_id != user.id:
        raise NotFound("Техника не найдена")
    return v


@router.get("/garage")
def garage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [vehicle_out(v) for v in _vehicles(db, user)]


class VehicleIn(BaseModel):
    model_id: int
    modification_id: int | None = None
    year: int | None = Field(None, ge=1950, le=2100)
    serial_number: str | None = Field(None, max_length=64)
    title: str = Field("", max_length=100)


@router.post("/garage", status_code=201)
def add_vehicle(data: VehicleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(MachineModel, data.model_id) is None:
        raise NotFound("Модель техники не найдена")
    if data.modification_id is not None:
        mod = db.get(Modification, data.modification_id)
        if mod is None or mod.model_id != data.model_id:
            raise DomainError("Модификация не относится к выбранной модели")
    db.add(Vehicle(user_id=user.id, **data.model_dump()))
    db.commit()
    return [vehicle_out(v) for v in _vehicles(db, user)]


@router.delete("/garage/{vehicle_id}")
def delete_vehicle(vehicle_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own_vehicle(db, user, vehicle_id))
    db.commit()
    return [vehicle_out(v) for v in _vehicles(db, user)]


@router.get("/garage/{vehicle_id}/parts")
def vehicle_parts(vehicle_id: int, q: str | None = None, in_stock: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Запчасти с проверенной совместимостью для конкретной техники из гаража."""
    v = _own_vehicle(db, user, vehicle_id)
    items, total = catalog.search(
        db, q=q, model_id=v.model_id, modification_id=v.modification_id, year=v.year, in_stock=in_stock, limit=100
    )
    return {"items": items, "total": total}


# --- избранное ----------------------------------------------------------------------------------


@router.get("/favorites")
def favorites(user: User = Depends(current_user), db: Session = Depends(get_db)):
    favs = db.scalars(select(Favorite).where(Favorite.user_id == user.id)).all()
    part_ids = [f.target_id for f in favs if f.kind == "part"]
    shop_ids = [f.target_id for f in favs if f.kind == "shop"]
    parts = db.scalars(select(Part).where(Part.id.in_(part_ids)).options(selectinload(Part.numbers))).all()
    summary = catalog.offers_summary(db, part_ids)
    shops = db.scalars(select(Shop).where(Shop.id.in_(shop_ids))).all()
    return {
        "parts": [catalog.part_brief(p, summary.get(p.id)) for p in parts],
        "shops": [{"id": s.id, "name": s.name, "address": s.address, "phone": s.phone} for s in shops],
    }


class FavoriteIn(BaseModel):
    kind: str = Field(pattern="^(part|shop)$")
    target_id: int


@router.post("/favorites", status_code=201)
def add_favorite(data: FavoriteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    model = Part if data.kind == "part" else Shop
    if db.get(model, data.target_id) is None:
        raise NotFound("Объект не найден")
    if db.scalar(select(Favorite).where(Favorite.user_id == user.id, Favorite.kind == data.kind, Favorite.target_id == data.target_id)):
        raise Conflict("Уже в избранном")
    db.add(Favorite(user_id=user.id, **data.model_dump()))
    db.commit()
    return {"ok": True}


@router.delete("/favorites/{kind}/{target_id}")
def remove_favorite(kind: str, target_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.scalar(select(Favorite).where(Favorite.user_id == user.id, Favorite.kind == kind, Favorite.target_id == target_id))
    if f:
        db.delete(f)
        db.commit()
    return {"ok": True}
