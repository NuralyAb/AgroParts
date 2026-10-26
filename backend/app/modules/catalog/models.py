"""Единый технический каталог платформы: техника, запчасти, номера, совместимость, аналоги."""

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow

MACHINE_KINDS = ("combine", "tractor", "seeder", "other")


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)

    models: Mapped[list["MachineModel"]] = relationship(back_populates="brand", order_by="MachineModel.name")


class MachineModel(Base):
    __tablename__ = "machine_models"
    __table_args__ = (UniqueConstraint("brand_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(16), default="other")
    image_url: Mapped[str | None] = mapped_column(String(500))
    image_credit: Mapped[dict | None] = mapped_column(JSON)

    brand: Mapped[Brand] = relationship(back_populates="models")
    modifications: Mapped[list["Modification"]] = relationship(back_populates="model", order_by="Modification.id")


class Modification(Base):
    __tablename__ = "modifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("machine_models.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    year_from: Mapped[int | None]
    year_to: Mapped[int | None]

    model: Mapped[MachineModel] = relationship(back_populates="modifications")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))


class Part(Base):
    """Единая техническая карточка запчасти — общая для всех магазинов."""

    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), index=True)
    # Размеры и технические параметры: {"Длина, мм": 2240, "Профиль": "C(B)"}
    specs: Mapped[dict] = mapped_column(JSON, default=dict)
    image_url: Mapped[str | None] = mapped_column(String(500))
    # Авторство фото для лицензий CC: {"title", "author", "license", "license_url", "source_url"}
    image_credit: Mapped[dict | None] = mapped_column(JSON)
    # Параметры процедурной 3D-модели детали для витрины: {"type": "vbelt", "ribs": 4, ...}
    render: Mapped[dict | None] = mapped_column(JSON)
    # Денормализованный текст для поиска (lowercase, с нормализованными номерами).
    # В PostgreSQL на него вешается GIN-индекс pg_trgm.
    search_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    category: Mapped[Category | None] = relationship()
    numbers: Mapped[list["PartNumber"]] = relationship(
        back_populates="part", cascade="all, delete-orphan", order_by="PartNumber.id"
    )
    compatibility: Mapped[list["Compatibility"]] = relationship(
        back_populates="part", cascade="all, delete-orphan", order_by="Compatibility.id"
    )


class PartNumber(Base):
    """OEM-номер или артикул производителя аналога."""

    __tablename__ = "part_numbers"
    __table_args__ = (UniqueConstraint("part_id", "normalized"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="oem")  # oem | manufacturer
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    number: Mapped[str] = mapped_column(String(100))
    normalized: Mapped[str] = mapped_column(String(100), index=True)

    part: Mapped[Part] = relationship(back_populates="numbers")


class Compatibility(Base):
    """Совместимость запчасти с техникой. Показывается покупателям только после проверки (verified)."""

    __tablename__ = "compatibility"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("machine_models.id"), index=True)
    modification_id: Mapped[int | None] = mapped_column(ForeignKey("modifications.id"))
    year_from: Mapped[int | None]
    year_to: Mapped[int | None]
    # Источник: каталог производителя, страница, документ — обязателен по ТЗ 5.6.
    source: Mapped[str] = mapped_column(String(300))
    verified: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    part: Mapped[Part] = relationship(back_populates="compatibility")
    model: Mapped[MachineModel] = relationship()
    modification: Mapped[Modification | None] = relationship()


class PartAnalog(Base):
    """Взаимозаменяемость. Не выводится автоматически по названию или фото — только проверенная запись."""

    __tablename__ = "part_analogs"
    __table_args__ = (
        UniqueConstraint("part_id", "analog_id"),
        CheckConstraint("part_id <> analog_id", name="ck_analog_not_self"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    analog_id: Mapped[int] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(300))
    verified: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    part: Mapped[Part] = relationship(foreign_keys=[part_id])
    analog: Mapped[Part] = relationship(foreign_keys=[analog_id])
