from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Model3D(Base):
    """3D-модель единицы техники. glb_url — файл GLB/glTF в объектном хранилище.
    Пока GLB нет, фронтенд строит упрощённую модель из геометрии компонентов."""

    __tablename__ = "models_3d"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_model_id: Mapped[int] = mapped_column(ForeignKey("machine_models.id"), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    glb_url: Mapped[str | None] = mapped_column(String(500))

    machine_model = relationship("MachineModel")
    components: Mapped[list["ModelComponent"]] = relationship(order_by="ModelComponent.id", cascade="all, delete-orphan")


class ModelComponent(Base):
    """Кликабельный элемент 3D-модели. Каждая кликабельная деталь обязана ссылаться на запись каталога (part_id)."""

    __tablename__ = "model_components"
    __table_args__ = (UniqueConstraint("model3d_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    model3d_id: Mapped[int] = mapped_column(ForeignKey("models_3d.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(64))  # имя меша в GLB
    name: Mapped[str] = mapped_column(String(200))
    assembly: Mapped[str] = mapped_column(String(32))  # body | engine | transmission | hydraulics | chassis | header ...
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"))
    # Упрощённая геометрия: {"shape": "box|cylinder|torus", "size": [...], "position": [...], "rotation": [...], "color": "#..."}
    geometry: Mapped[dict] = mapped_column(JSON, default=dict)
    explode: Mapped[list] = mapped_column(JSON, default=list)  # вектор смещения для exploded view
    is_shell: Mapped[bool] = mapped_column(default=False)  # элементы корпуса, которые можно скрыть
