"""Единая таблица заказов для всех каналов: маркетплейс, телефонная бронь в CRM, продажа на кассе."""

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow

CHANNELS = ("marketplace", "phone", "pos")
STATUSES = ("pending", "confirmed", "ready", "issued", "cancelled")
ACTIVE_STATUSES = ("pending", "confirmed", "ready")
PAYMENT_MODES = ("on_pickup", "online")
PAYMENT_STATUSES = ("unpaid", "paid", "refund_pending")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_shop_status", "shop_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), default="", index=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id"), index=True)
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    payment_mode: Mapped[str] = mapped_column(String(16), default="on_pickup")
    payment_status: Mapped[str] = mapped_column(String(16), default="unpaid")
    total: Mapped[int] = mapped_column(default=0)
    pickup_code: Mapped[str | None] = mapped_column(String(8))
    comment: Mapped[str] = mapped_column(Text, default="")
    cancel_reason: Mapped[str | None] = mapped_column(String(300))
    expires_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", order_by="OrderItem.id")
    events: Mapped[list["OrderEvent"]] = relationship(order_by="OrderEvent.id")
    shop = relationship("Shop")
    customer = relationship("Customer")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id"), index=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    # Снимок на момент заказа: изменение цены после заказа не меняет сумму.
    title: Mapped[str] = mapped_column(String(300))
    sku: Mapped[str] = mapped_column(String(40))
    price: Mapped[int]
    qty: Mapped[int]

    order: Mapped[Order] = relationship(back_populates="items")


class OrderEvent(Base):
    """Журнал смены статусов заказа."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
