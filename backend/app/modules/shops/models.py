from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow

SHOP_STATUSES = ("pending", "verified", "blocked")


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Префикс внутренних SKU магазина: KST1-000042
    code: Mapped[str] = mapped_column(String(12), unique=True)
    bin: Mapped[str | None] = mapped_column(String(12))  # БИН компании
    city: Mapped[str] = mapped_column(String(100), default="Костанай")
    address: Mapped[str] = mapped_column(String(300), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    delivery_available: Mapped[bool] = mapped_column(default=False)
    # Ключ для внешних учётных систем (1С и т.п.)
    api_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    sku_seq: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    warehouses: Mapped[list["Warehouse"]] = relationship(back_populates="shop", order_by="Warehouse.id")


class ShopMember(Base):
    __tablename__ = "shop_members"
    __table_args__ = (UniqueConstraint("shop_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="staff")  # owner | staff

    shop: Mapped[Shop] = relationship()


class Warehouse(Base):
    """Склад / торговая точка магазина. Остатки ведутся по складам."""

    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(String(300), default="")
    is_pickup_point: Mapped[bool] = mapped_column(default=True)

    shop: Mapped[Shop] = relationship(back_populates="warehouses")
