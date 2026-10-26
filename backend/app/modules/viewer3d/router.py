from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import require_catalog_editor
from app.core.errors import NotFound
from app.modules.auth.models import User
from app.modules.catalog import service as catalog
from app.modules.catalog.models import MachineModel, Part
from app.modules.viewer3d.models import Model3D, ModelComponent

router = APIRouter(prefix="/catalog3d", tags=["3d"])


@router.get("/models")
def models(db: Session = Depends(get_db)):
    rows = db.scalars(select(Model3D).options(selectinload(Model3D.machine_model).selectinload(MachineModel.brand))).all()
    return [
        {
            "id": m.id, "title": m.title, "machine_model_id": m.machine_model_id,
            "brand": m.machine_model.brand.name, "model": m.machine_model.name, "kind": m.machine_model.kind,
            "has_glb": bool(m.glb_url),
        }
        for m in rows
    ]


@router.get("/models/{model3d_id}")
def model(model3d_id: int, db: Session = Depends(get_db)):
    m = db.scalar(
        select(Model3D).where(Model3D.id == model3d_id)
        .options(selectinload(Model3D.components), selectinload(Model3D.machine_model).selectinload(MachineModel.brand))
    )
    if m is None:
        raise NotFound("3D-модель не найдена")
    part_ids = [c.part_id for c in m.components if c.part_id]
    parts = {p.id: p for p in db.scalars(select(Part).where(Part.id.in_(part_ids)).options(selectinload(Part.numbers)))}
    summary = catalog.offers_summary(db, part_ids)
    return {
        "id": m.id, "title": m.title, "glb_url": m.glb_url, "machine_model_id": m.machine_model_id,
        "brand": m.machine_model.brand.name, "model": m.machine_model.name,
        "components": [
            {
                "id": c.id, "key": c.key, "name": c.name, "assembly": c.assembly, "geometry": c.geometry,
                "explode": c.explode, "is_shell": c.is_shell,
                "part": catalog.part_brief(parts[c.part_id], summary.get(c.part_id)) if c.part_id in parts else None,
            }
            for c in m.components
        ],
    }


class LinkIn(BaseModel):
    part_id: int | None


@router.put("/components/{component_id}/part")
def link_part(component_id: int, data: LinkIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    """Контент-менеджер привязывает элемент 3D-модели к записи технического каталога."""
    c = db.get(ModelComponent, component_id)
    if c is None:
        raise NotFound("Компонент не найден")
    if data.part_id is not None and db.get(Part, data.part_id) is None:
        raise NotFound("Запчасть не найдена")
    c.part_id = data.part_id
    db.commit()
    return {"id": c.id, "part_id": c.part_id}
