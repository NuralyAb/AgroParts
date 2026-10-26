from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow


class Vehicle(Base):
    """Техника в «Моём гараже» фермера."""

    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("machine_models.id"))
    modification_id: Mapped[int | None] = mapped_column(ForeignKey("modifications.id"))
    year: Mapped[int | None]
    serial_number: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    model = relationship("MachineModel")
    modification = relationship("Modification")


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "kind", "target_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(8))  # part | shop
    target_id: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
