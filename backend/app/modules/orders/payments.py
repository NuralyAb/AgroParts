"""Платёжный провайдер. MockProvider — заглушка до подключения реального эквайринга (этап 3)."""

import logging
import secrets
from typing import Protocol

log = logging.getLogger("agroparts.payments")


class PaymentProvider(Protocol):
    def charge(self, order_number: str, amount: int) -> str:
        """Возвращает идентификатор транзакции или бросает исключение."""
        ...


class MockProvider:
    def charge(self, order_number: str, amount: int) -> str:
        tx = f"mock-{secrets.token_hex(6)}"
        log.info("mock payment %s: %s KZT -> %s", order_number, amount, tx)
        return tx


provider: PaymentProvider = MockProvider()
