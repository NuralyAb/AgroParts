"""Регистрирует модели всех модулей в общей metadata (для create_all и миграций)."""

from app.modules.auth.models import User  # noqa: F401
from app.modules.catalog.models import Brand, Category, Compatibility, MachineModel, Modification, Part, PartAnalog, PartNumber  # noqa: F401
from app.modules.crm.models import Customer  # noqa: F401
from app.modules.garage.models import Favorite, Vehicle  # noqa: F401
from app.modules.inventory.models import Offer, Reservation, StockItem, StockMovement  # noqa: F401
from app.modules.orders.models import Order, OrderEvent, OrderItem  # noqa: F401
from app.modules.shops.models import Shop, ShopMember, Warehouse  # noqa: F401
from app.modules.viewer3d.models import Model3D, ModelComponent  # noqa: F401
