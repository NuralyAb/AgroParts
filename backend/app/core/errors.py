from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class DomainError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFound(DomainError):
    status = 404
    code = "not_found"


class Forbidden(DomainError):
    status = 403
    code = "forbidden"


class Unauthorized(DomainError):
    status = 401
    code = "unauthorized"


class Conflict(DomainError):
    status = 409
    code = "conflict"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_req: Request, exc: DomainError):
        return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status)

    @app.exception_handler(IntegrityError)
    async def _integrity(_req: Request, exc: IntegrityError):
        # Последний рубеж: CHECK/UNIQUE-ограничения БД (например, reserved <= on_hand).
        return JSONResponse(
            {"detail": "Операция нарушает ограничения данных", "code": "integrity", "db": str(exc.orig)[:300]},
            status_code=409,
        )
