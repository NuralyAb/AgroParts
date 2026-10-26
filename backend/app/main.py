import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app import models  # noqa: F401  — регистрирует все таблицы
from app.core.config import settings
from app.core.db import Base, SessionLocal, engine
from app.core.errors import install_error_handlers
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.catalog.router import router as catalog_router
from app.modules.crm.router import router as crm_router
from app.modules.garage.router import router as garage_router
from app.modules.integrations.router import router as integrations_router
from app.modules.inventory.router import router as inventory_router
from app.modules.orders import service as orders_service
from app.modules.orders.router import router as orders_router
from app.modules.shops.router import router as shops_router
from app.modules.viewer3d.router import router as viewer3d_router

log = logging.getLogger("agroparts")
MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"


def _expire_once() -> int:
    with SessionLocal() as db:
        return orders_service.expire_stale(db)


async def _expire_loop() -> None:
    while True:
        try:
            n = await run_in_threadpool(_expire_once)
            if n:
                log.info("expired %s reservations", n)
        except Exception:  # фоновая задача не должна падать навсегда
            log.exception("expire loop failed")
        await asyncio.sleep(settings.expire_interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Для dev/SQLite. В production схему ведут миграции Alembic.
    Base.metadata.create_all(engine)
    task = asyncio.create_task(_expire_loop()) if settings.run_background_jobs else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="AgroParts API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)
install_error_handlers(app)

for r in (
    auth_router, catalog_router, shops_router, inventory_router, orders_router, crm_router, garage_router,
    viewer3d_router, integrations_router, admin_router,
):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Фото товаров и 3D-файлы. В production — объектное хранилище (S3 / MinIO) за CDN.
MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/api/media", StaticFiles(directory=MEDIA_DIR), name="media")
