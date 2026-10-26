import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, errorText, useFetch } from "../api";
import { useCart } from "../cart";
import { dateTime, money, until } from "../format";
import { Empty, ErrorBox, Notice, Spinner, StatusBadge } from "../components/ui";
import type { Order } from "../types";

function OrderCard({ order, onChange }: { order: Order; onChange: () => void }) {
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [events, setEvents] = useState<Order["events"]>();
  const active = ["pending", "confirmed", "ready"].includes(order.status);
  const showCode = order.pickup_code && ["confirmed", "ready"].includes(order.status);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reorder = () => {
    for (const i of order.items) {
      cart.add({ offer_id: i.offer_id, part_id: i.part_id, title: i.title, price: i.price, shop_id: order.shop.id, shop_name: order.shop.name, available: null }, i.qty);
    }
  };

  const toggleEvents = async () => {
    if (!events) setEvents((await api<Order>(`/orders/${order.id}`)).events);
    setShowEvents((v) => !v);
  };

  return (
    <div className="card order-card">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <strong>{order.number}</strong>
          <StatusBadge status={order.status} />
          {order.payment_mode === "online" && (
            <span className={`badge ${order.payment_status === "paid" ? "badge-green" : "badge-yellow"}`}>
              {order.payment_status === "paid" ? "Оплачен" : order.payment_status === "refund_pending" ? "Возврат" : "Не оплачен"}
            </span>
          )}
          <span className="muted small">{dateTime(order.created_at)}</span>
        </div>
        <div>
          <strong>{order.shop.name}</strong>
          <div className="small muted">
            {order.shop.address} · {order.shop.phone}
          </div>
        </div>
        <table>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>{i.part_id ? <Link to={`/parts/${i.part_id}`}>{i.title}</Link> : i.title}</td>
                <td className="num">{i.qty} шт.</td>
                <td className="num">{money(i.price * i.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-between">
          <span className="muted small">
            {active && order.expires_at && `Бронь действует ещё ${until(order.expires_at)}`}
            {order.cancel_reason && `Причина: ${order.cancel_reason}`}
          </span>
          <strong>{money(order.total)}</strong>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          {order.payment_mode === "online" && order.payment_status === "unpaid" && active && (
            <button className="btn btn-accent" disabled={busy} onClick={() => act(() => api(`/orders/${order.id}/pay`, { method: "POST" }))}>
              Оплатить {money(order.total)}
            </button>
          )}
          {["pending", "confirmed"].includes(order.status) && (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => confirm("Отменить заказ? Товар вернётся в продажу.") && act(() => api(`/orders/${order.id}/cancel`, { method: "POST" }))}
            >
              Отменить
            </button>
          )}
          {!active && (
            <button className="btn" onClick={reorder}>
              Заказать снова
            </button>
          )}
          <button className="link small" onClick={toggleEvents}>
            {showEvents ? "Скрыть историю" : "История"}
          </button>
        </div>
        {showEvents && events && (
          <ul className="timeline">
            {events.map((e, n) => (
              <li key={n}>
                {dateTime(e.created_at)} — <StatusBadge status={e.to} /> {e.note}
              </li>
            ))}
          </ul>
        )}
      </div>
      {showCode ? (
        <div className="qr-box">
          <QRCodeSVG value={`agroparts:order:${order.number}:${order.pickup_code}`} size={132} />
          <div className="small">Код получения</div>
          <div className="code">{order.pickup_code}</div>
        </div>
      ) : order.status === "pending" ? (
        <div className="qr-box small" style={{ maxWidth: 160 }}>
          Код получения появится после подтверждения магазином
        </div>
      ) : null}
    </div>
  );
}

export default function Orders() {
  const [params] = useSearchParams();
  const created = params.get("created");
  const orders = useFetch<Order[]>("/orders/my");
  const [filter, setFilter] = useState<"active" | "all">("active");
  const list = (orders.data ?? []).filter((o) => filter === "all" || ["pending", "confirmed", "ready"].includes(o.status));

  return (
    <>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h1>Мои заказы</h1>
        <div className="chips">
          <button className={`chip ${filter === "active" ? "on" : ""}`} onClick={() => setFilter("active")}>
            Активные
          </button>
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
            Вся история
          </button>
        </div>
      </div>
      {created && <Notice kind="ok">Заказ {created} оформлен. Магазин получил уведомление и подтвердит бронь.</Notice>}
      <ErrorBox error={orders.error} onRetry={orders.reload} />
      <div style={{ marginTop: 12 }}>
        {orders.loading && !orders.data ? (
          <Spinner />
        ) : list.length === 0 ? (
          <Empty>Заказов нет</Empty>
        ) : (
          list.map((o) => <OrderCard key={o.id} order={o} onChange={orders.reload} />)
        )}
      </div>
    </>
  );
}
