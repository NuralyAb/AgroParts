from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.core.deps import require_catalog_editor
from app.core.errors import Conflict, NotFound
from app.modules.auth.models import User
from app.modules.catalog import search as engine
from app.modules.catalog import service
from app.modules.catalog.models import (
    Brand, Category, Compatibility, MachineModel, Modification, Part, PartAnalog, PartNumber,
)
from app.modules.catalog.normalize import normalize_number

router = APIRouter(prefix="/catalog", tags=["catalog"])


# --- публичная часть ---------------------------------------------------------------------------


@router.get("/brands")
def brands(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Brand).order_by(Brand.name).options(selectinload(Brand.models).selectinload(MachineModel.modifications))
    ).all()
    return [
        {
            "id": b.id,
            "name": b.name,
            "models": [
                {
                    "id": m.id, "name": m.name, "kind": m.kind, "image_url": m.image_url, "image_credit": m.image_credit,
                    "modifications": [
                        {"id": x.id, "name": x.name, "year_from": x.year_from, "year_to": x.year_to}
                        for x in m.modifications
                    ],
                }
                for m in b.models
            ],
        }
        for b in rows
    ]


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Part.category_id, func.count(Part.id)).group_by(Part.category_id)).all())
    covers: dict[int, str] = {}
    for cat_id, url in db.execute(select(Part.category_id, Part.image_url).where(Part.image_url.is_not(None)).order_by(Part.id)):
        covers.setdefault(cat_id, url)
    return [
        {"id": c.id, "name": c.name, "parent_id": c.parent_id, "count": counts.get(c.id, 0), "image_url": covers.get(c.id)}
        for c in db.scalars(select(Category).order_by(Category.name))
    ]


@router.get("/search")
def search(
    q: str | None = None,
    model_id: int | None = None,
    modification_id: int | None = None,
    year: int | None = None,
    category_id: int | None = None,
    in_stock: bool = False,
    sort: str = Query("relevance", pattern="^(relevance|price_asc|price_desc|available)$"),
    limit: int = Query(20, ge=1, le=240),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    return service.search_full(
        db, q=q, model_id=model_id, modification_id=modification_id, year=year, category_id=category_id,
        in_stock=in_stock, sort=sort, limit=limit, offset=offset,
    )


@router.get("/suggest")
def suggest(q: str = "", db: Session = Depends(get_db)):
    """Подсказки при вводе: детали, модели техники и категории."""
    q = q.strip()
    if len(q) < 2:
        return {"query": q, "corrected_query": None, "parts": [], "total": 0, "models": [], "categories": []}
    r = service.search_full(db, q=q, limit=6)
    effective = r["corrected_query"] or q
    return {
        "query": q,
        "corrected_query": r["corrected_query"],
        "parts": r["items"],
        "total": r["total"],
        "models": engine.match_models(db, effective),
        "categories": engine.match_categories(db, effective),
    }


@router.get("/parts/{part_id}")
def part(part_id: int, db: Session = Depends(get_db)):
    return service.part_detail(db, part_id)


# --- редактирование каталога (администратор, контент-менеджер) ----------------------------------


class NumberIn(BaseModel):
    number: str = Field(min_length=1, max_length=100)
    kind: str = Field("oem", pattern="^(oem|manufacturer)$")
    manufacturer: str | None = None


class PartIn(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    description: str = ""
    category_id: int | None = None
    specs: dict = {}
    image_url: str | None = None
    numbers: list[NumberIn] = []


class PartPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    category_id: int | None = None
    specs: dict | None = None
    image_url: str | None = None
    image_credit: dict | None = None
    render: dict | None = None


def _add_number(db: Session, part: Part, data: NumberIn) -> PartNumber:
    norm = normalize_number(data.number)
    if not norm:
        raise Conflict("Пустой номер после нормализации")
    if any(n.normalized == norm for n in part.numbers):
        raise Conflict(f"Номер {data.number} уже есть у этой запчасти")
    n = PartNumber(kind=data.kind, manufacturer=data.manufacturer, number=data.number.strip(), normalized=norm)
    part.numbers.append(n)
    return n


def create_part(db: Session, data: PartIn) -> Part:
    p = Part(
        name=data.name.strip(), description=data.description, category_id=data.category_id, specs=data.specs,
        image_url=data.image_url,
    )
    db.add(p)
    for n in data.numbers:
        _add_number(db, p, n)
    service.reindex_part(p)
    db.flush()
    return p


@router.post("/parts", status_code=201)
def create_part_endpoint(data: PartIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    p = create_part(db, data)
    db.commit()
    return service.part_detail(db, p.id, include_unverified=True)


@router.get("/parts/{part_id}/full")
def part_full(part_id: int, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    return service.part_detail(db, part_id, include_unverified=True)


@router.patch("/parts/{part_id}")
def patch_part(part_id: int, data: PartPatch, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    p = db.get(Part, part_id) or _nf()
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    service.reindex_part(p)
    db.commit()
    return service.part_detail(db, p.id, include_unverified=True)


@router.post("/parts/{part_id}/numbers", status_code=201)
def add_number(part_id: int, data: NumberIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    p = db.get(Part, part_id) or _nf()
    _add_number(db, p, data)
    service.reindex_part(p)
    db.commit()
    return service.part_detail(db, p.id, include_unverified=True)


@router.delete("/numbers/{number_id}")
def delete_number(number_id: int, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    n = db.get(PartNumber, number_id) or _nf()
    p = n.part
    p.numbers.remove(n)
    service.reindex_part(p)
    db.commit()
    return {"ok": True}


class CompatIn(BaseModel):
    model_id: int
    modification_id: int | None = None
    year_from: int | None = None
    year_to: int | None = None
    source: str = Field(min_length=3, max_length=300, description="Каталог производителя, страница, документ")
    note: str = ""


@router.post("/parts/{part_id}/compatibility", status_code=201)
def add_compat(part_id: int, data: CompatIn, db: Session = Depends(get_db), user: User = Depends(require_catalog_editor)):
    db.get(Part, part_id) or _nf()
    db.get(MachineModel, data.model_id) or _nf("Модель техники не найдена")
    c = Compatibility(part_id=part_id, created_by=user.id, **data.model_dump())
    db.add(c)
    db.commit()
    return {"id": c.id, "verified": c.verified}


class AnalogIn(BaseModel):
    analog_id: int
    source: str = Field(min_length=3, max_length=300)
    note: str = ""


@router.post("/parts/{part_id}/analogs", status_code=201)
def add_analog(part_id: int, data: AnalogIn, db: Session = Depends(get_db), user: User = Depends(require_catalog_editor)):
    if part_id == data.analog_id:
        raise Conflict("Деталь не может быть аналогом самой себя")
    db.get(Part, part_id) or _nf()
    db.get(Part, data.analog_id) or _nf("Аналог не найден")
    a = PartAnalog(part_id=part_id, created_by=user.id, **data.model_dump())
    db.add(a)
    db.commit()
    return {"id": a.id, "verified": a.verified}


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ModelIn(NameIn):
    brand_id: int
    kind: str = Field("other", pattern="^(combine|tractor|seeder|other)$")


class ModificationIn(NameIn):
    model_id: int
    year_from: int | None = None
    year_to: int | None = None


class CategoryIn(NameIn):
    parent_id: int | None = None


@router.post("/brands", status_code=201)
def create_brand(data: NameIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    b = Brand(name=data.name.strip())
    db.add(b)
    db.commit()
    return {"id": b.id, "name": b.name}


@router.post("/models", status_code=201)
def create_model(data: ModelIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    m = MachineModel(**data.model_dump())
    db.add(m)
    db.commit()
    return {"id": m.id, "name": m.name}


@router.post("/modifications", status_code=201)
def create_modification(data: ModificationIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    m = Modification(**data.model_dump())
    db.add(m)
    db.commit()
    return {"id": m.id, "name": m.name}


@router.post("/categories", status_code=201)
def create_category(data: CategoryIn, db: Session = Depends(get_db), _u: User = Depends(require_catalog_editor)):
    c = Category(**data.model_dump())
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name}


def _nf(msg: str = "Запчасть не найдена"):
    raise NotFound(msg)
