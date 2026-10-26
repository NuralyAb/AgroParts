"""Уведомления. Пока пишет в лог; позже — SMS / WhatsApp / Telegram через очередь (Redis)."""

import logging

from app.modules.orders.models import Order

log = logging.getLogger("agroparts.notify")

STATUS_TEXT = {
    "pending": "ожидает подтверждения",
    "confirmed": "подтверждён магазином",
    "ready": "готов к выдаче",
    "issued": "выдан",
    "cancelled": "отменён",
}


def order_status_changed(order: Order) -> None:
    log.info("order %s (shop %s): %s", order.number, order.shop_id, STATUS_TEXT.get(order.status, order.status))
