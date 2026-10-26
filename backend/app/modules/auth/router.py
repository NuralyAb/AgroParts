import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user
from app.core.errors import Conflict, Unauthorized
from app.core.security import create_token, hash_password, verify_password
from app.modules.auth.models import User
from app.modules.shops.models import ShopMember

router = APIRouter(prefix="/auth", tags=["auth"])


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    if len(digits) == 10:
        digits = "7" + digits
    if len(digits) != 11:
        raise ValueError("Телефон в формате +7 XXX XXX XX XX")
    return "+" + digits


class RegisterIn(BaseModel):
    phone: str
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=2, max_length=200)
    email: str | None = None

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)


class LoginIn(BaseModel):
    phone: str
    password: str

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        return normalize_phone(v)


def me_payload(db: Session, user: User) -> dict:
    memberships = db.scalars(select(ShopMember).where(ShopMember.user_id == user.id)).all()
    return {
        "id": user.id,
        "phone": user.phone,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "locale": user.locale,
        "shops": [
            {"id": m.shop.id, "name": m.shop.name, "role": m.role, "status": m.shop.status} for m in memberships
        ],
    }


@router.post("/register", status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.phone == data.phone)):
        raise Conflict("Пользователь с таким телефоном уже зарегистрирован")
    user = User(phone=data.phone, name=data.name.strip(), email=data.email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    return {"token": create_token(user.id), "user": me_payload(db, user)}


@router.post("/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.phone == data.phone))
    if not user or not user.is_active or not verify_password(data.password, user.password_hash):
        raise Unauthorized("Неверный телефон или пароль")
    return {"token": create_token(user.id), "user": me_payload(db, user)}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_payload(db, user)


class MePatch(BaseModel):
    name: str | None = None
    email: str | None = None
    locale: str | None = Field(None, pattern="^(ru|kk)$")


@router.patch("/me")
def patch_me(data: MePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    return me_payload(db, user)
