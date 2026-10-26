"""Предложения магазинов, остатки, резервы и журнал движений.

Ключевой инвариант: доступно = on_hand - reserved >= 0. Он защищён и в коде
сервиса (inventory.service), и CHECK-ограничением в БД.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.db import Base, utcnow
from app.modules.catalog.normalize import normalize_number

# tracked — остатки ведутся в CRM/POS AgroParts или синхронизируются из 1С: наличие гарантируется.
# manual  — магазин обновляет остатки Excel-файлом: наличие подтверждает продавец.
STOCK_MODES = ("tracked", "manual")
MATCH_STATUSES = ("matched", "review", "unmatched")


class Offer(Base):
    """Коммерческое предложение магазина по запчасти из единого каталога."""

    __tablename__ = "offers"
    __table_args__ = (UniqueConstraint("shop_id", "sku"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"), index=True)
    sku: Mapped[str] = mapped_column(String(40))  # внутренний SKU магазина
    title: Mapped[str] = mapped_column(String(300))  # название так, как его пишет магазин
    article: Mapped[str | None] = mapped_column(String(100))  # номер, указанный магазином
    article_normalized: Mapped[str | None] = mapped_column(String(100), index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    price: Mapped[int] = mapped_column()  # тенге
    condition: Mapped[str] = mapped_column(String(16), default="new")
    is_active: Mapped[bool] = mapped_column(default=True)
    stock_mode: Mapped[str] = mapped_column(String(16), default="tracked")
    match_status: Mapped[str] = mapped_column(String(16), default="unmatched")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    stock_items: Mapped[list["StockItem"]] = relationship(back_populates="offer", order_by="StockItem.id")
    shop = relationship("Shop")
    part = relationship("Part")

    @validates("article")
    def _sync_article_normalized(self, _key: str, value: str | None) -> str | None:
        self.article_normalized = normalize_number(value) or None
        return value


class StockItem(Base):
    __tablename__ = "stock_items"
    __table_args__ = (
        UniqueConstraint("offer_id", "warehouse_id"),
        CheckConstraint("on_hand >= 0", name="ck_stock_on_hand_nonneg"),
        CheckConstraint("reserved >= 0", name="ck_stock_reserved_nonneg"),
        CheckConstraint("reserved <= on_hand", name="ck_stock_reserved_le_on_hand"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), index=True)
    on_hand: Mapped[int] = mapped_column(default=0)  # физический остаток
    reserved: Mapped[int] = mapped_column(default=0)  # сумма активных резервов
    bin_location: Mapped[str | None] = mapped_column(String(40))  # складская ячейка
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)

    offer: Mapped[Offer] = relationship(back_populates="stock_items")
    warehouse = relationship("Warehouse")

    @property
    def available(self) -> int:
        return self.on_hand - self.reserved


RESERVATION_STATUSES = ("active", "released", "fulfilled")


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_reservation_qty_pos"),
        Index("ix_reservations_active", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("stock_items.id"), index=True)
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id"), index=True)
    qty: Mapped[int]
    status: Mapped[str] = mapped_column(String(16), default="active")
    expires_at: Mapped[datetime | None]
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    closed_at: Mapped[datetime | None]


MOVEMENT_KINDS = ("receipt", "sale", "count", "import", "sync", "reserve", "release", "issue")


class StockMovement(Base):
    """Журнал всех изменений остатков — ни одно изменение не проходит мимо него."""

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("stock_items.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    on_hand_delta: Mapped[int] = mapped_column(default=0)
    reserved_delta: Mapped[int] = mapped_column(default=0)
    on_hand_after: Mapped[int]
    reserved_after: Mapped[int]
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
