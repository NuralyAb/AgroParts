import csv
import io
from dataclasses import asdict

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user, shop_access
from app.core.errors import DomainError, Unauthorized
from app.modules.auth.models import User
from app.modules.integrations import importer
from app.modules.shops.models import Shop

router = APIRouter(tags=["integrations"])

MAX_FILE = 10 * 1024 * 1024


@router.get("/integrations/import-template.csv")
def template():
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(importer.TEMPLATE_HEADER)
    w.writerow(["4HB-4330", "Ремень привода жатки", "Harvest Belts", "8500", "12", "A-03-2", ""])
    return Response(
        content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=agroparts-import.csv"},
    )


@router.post("/shops/{shop_id}/import")
async def import_file(
    file: UploadFile = File(...),
    stock_mode: str = Form("manual"),
    dry_run: bool = Form(False),
    shop: Shop = Depends(shop_access),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Загрузка Excel/CSV. По умолчанию stock_mode=manual: без учётной системы наличие подтверждает продавец."""
    if stock_mode not in ("manual", "tracked"):
        raise DomainError("stock_mode: manual или tracked")
    content = await file.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise DomainError("Файл больше 10 МБ — разбейте его на части")
    rows = importer.read_table(file.filename or "", content)
    report = importer.apply_rows(db, shop, rows, stock_mode=stock_mode, movement_kind="import", user_id=user.id)
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return {**asdict(report), "dry_run": dry_run}


class SyncItem(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    article: str | None = None
    title: str | None = None
    manufacturer: str | None = None
    price: int = Field(ge=0)
    qty: int = Field(ge=0)
    warehouse: str | None = None


class SyncIn(BaseModel):
    items: list[SyncItem] = Field(min_length=1, max_length=5000)


@router.post("/integrations/1c/stock")
def sync_1c(data: SyncIn, x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """Адаптер учётной системы (1С и др.): пакет остатков и цен по ключу магазина.
    Товары из учётной системы получают stock_mode=tracked — наличие гарантируется."""
    shop = db.scalar(select(Shop).where(Shop.api_key == x_api_key))
    if shop is None:
        raise Unauthorized("Неверный API-ключ")
    rows = [i.model_dump() for i in data.items]
    report = importer.apply_rows(db, shop, rows, stock_mode="tracked", movement_kind="sync", user_id=None)
    db.commit()
    return asdict(report)
