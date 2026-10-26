from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.security import decode_token
from app.modules.auth.models import User
from app.modules.shops.models import Shop, ShopMember

_bearer = HTTPBearer(auto_error=False)


def current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User | None:
    if not creds:
        return None
    user_id = decode_token(creds.credentials)
    if user_id is None:
        return None
    user = db.get(User, user_id)
    return user if user and user.is_active else None


def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if user is None:
        raise Unauthorized("Требуется вход в систему")
    return user


def require_roles(*roles: str):
    def _dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise Forbidden("Недостаточно прав")
        return user

    return _dep


require_admin = require_roles("admin")
require_catalog_editor = require_roles("admin", "content_manager")


def shop_access(shop_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Shop:
    """Доступ сотрудника к своему магазину. Администратор платформы видит все магазины."""
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise NotFound("Магазин не найден")
    if user.role == "admin":
        return shop
    member = db.scalar(select(ShopMember).where(ShopMember.shop_id == shop_id, ShopMember.user_id == user.id))
    if member is None:
        raise Forbidden("Нет доступа к этому магазину")
    return shop


def ensure_shop_can_trade(shop: Shop) -> None:
    if shop.status == "blocked":
        raise Forbidden("Магазин заблокирован администратором")
