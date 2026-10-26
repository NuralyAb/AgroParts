import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, qs, useFetch } from "../../api";
import { dateTime, money, until } from "../../format";
import { CHANNEL_LABEL, Empty, ErrorBox, Modal, Notice, Spinner, StatusBadge } from "../../components/ui";
import type { Customer, Order, ShopOffer } from "../../types";
import OfferPicker from "./OfferPicker";
import type { ShopTabProps } from "./ShopCabinet";

const FILTERS = [
  { id: "pending,confirmed,ready", label: "Активные" },
  { id: "pending", label: "Новые" },
  { id: "ready", label: "Готовы к выдаче" },
  { id: "issued", label: "Выданы" },
  { id: "cancelled", label: "Отменены" },
  { id: "", label: "Все" },
];

const NEXT: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  pending: [{ to: "confirmed", label: "Подтвердить", primary: true }],
  confirmed: [
    { to: "ready", label: "Собран, готов к выдаче", primary: true },
    { to: "issued", label: "Выдать" },
  ],
  ready: [{ to: "issued", label: "Выдать покупателю", primary: true }],
};

function OrderRow({ order, shopId, onChange }: { order: Order; shopId: number; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = ["pending", "confirmed", "ready"].includes(order.status);

  const move = async (to: string) => {
    let note = "";
    if (to === "cancelled") {
      const reason = prompt("Причина отмены (увидит покупатель):", "Нет в наличии");
      if (reason === null) return;
      note = reason;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shopId}/orders/${order.id}/status`, { body: { to, note } });
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row-between">
        <div className="row">
          <strong>{order.number}</strong>
          <StatusBadge status={order.status} />
          <span className="badge">{CHANNEL_LABEL[order.channel]}</span>
          {order.payment_mode === "online" && (
            <span className={`badge ${order.payment_status === "paid" ? "badge-green" : "badge-yellow"}`}>
              {order.payment_status === "paid" ? "Оплачен онлайн" : "Ждёт онлайн-оплату"}
            </span>
          )}
        </div>
        <span className="small muted">
          {dateTime(order.created_at)}
          {active && order.expires_at && ` · бронь ещё ${until(order.expires_at)}`}
        </span>
      </div>
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <div>
          {order.items.map((i) => (
            <div key={i.id} className="small">
              <span className="mono muted">{i.sku}</span> {i.title} × {i.qty} = {money(i.price * i.qty)}
            </div>
          ))}
          <div style={{ marginTop: 4 }}>
            <strong>{money(order.total)}</strong>
          </div>
        </div>
        <div className="small">
          {order.customer ? (
            <>
              <strong>{order.customer.name}</strong> {order.customer.phone && <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>}
            </>
          ) : (
            <span className="muted">Без клиента</span>
          )}
          {order.comment && <div className="muted">«{order.comment}»</div>}
          {order.cancel_reason && <div className="muted">Отмена: {order.cancel_reason}</div>}
        </div>
      </div>
      <ErrorBox error={error} />
      {active && (
        <div className="row" style={{ marginTop: 10 }}>
          {NEXT[order.status]?.map((a) => (
            <button key={a.to} className={`btn btn-sm ${a.primary ? "btn-primary" : ""}`} disabled={busy} onClick={() => move(a.to)}>
              {a.label}
            </button>
          ))}
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => move("cancelled")}>
            Отменить и вернуть в остаток
          </button>
        </div>
      )}
    </div>
  );
}

function PhoneOrderModal({ shopId, onClose, onDone }: { shopId: number; onClose: () => void; onDone: () => void }) {
  const customers = useFetch<Customer[]>(`/shops/${shopId}/customers`);
  const [lines, setLines] = useState<{ offer: ShopOffer; qty: number }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/shops/${shopId}/orders/phone`, {
        body: { items: lines.map((l) => ({ offer_id: l.offer.id, qty: l.qty })), customer_id: customerId ? Number(customerId) : null, comment },
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title="Бронь по телефону" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <OfferPicker shopId={shopId} onlyAvailable onPick={(o) => !lines.some((l) => l.offer.id === o.id) && setLines([...lines, { offer: o, qty: 1 }])} />
        {lines.map((l, n) => (
          <div key={l.offer.id} className="row-between">
            <span>{l.offer.title}</span>
            <div className="row">
              <input
                className="qty"
                type="number"
                min={1}
                max={l.offer.available}
                value={l.qty}
                onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, qty: Number(e.target.value) || 1 } : x)))}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((_, k) => k !== n))}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <label className="field">
          <span>Клиент</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— без клиента —</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Комментарий</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <Notice kind="info">Товар сразу зарезервируется: на маркетплейсе он станет недоступен для других покупателей.</Notice>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={lines.length === 0}>
          Создать бронь
        </button>
      </form>
    </Modal>
  );
}

export default function ShopOrders({ shop }: ShopTabProps) {
  const [filter, setFilter] = useState(FILTERS[0].id);
  const orders = useFetch<Order[]>(`/shops/${shop.id}/orders${qs({ status: filter })}`);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Order | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [phoneOrder, setPhoneOrder] = useState(false);

  useEffect(() => {
    const t = setInterval(() => void orders.reload(), 30_000); // новые заказы с маркетплейса
    return () => clearInterval(t);
  }, [orders.reload]);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setFound(null);
    try {
      setFound(await api<Order>(`/shops/${shop.id}/orders/by-code/${encodeURIComponent(code.trim())}`));
    } catch (err) {
      setCodeError(errorText(err));
    }
  };

  const refreshAll = () => {
    void orders.reload();
    if (found) api<Order>(`/orders/${found.id}`).then(setFound).catch(() => setFound(null));
  };

  return (
    <>
      <div className="grid grid-2">
        <form className="card row" onSubmit={lookup} style={{ margin: 0 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код получения покупателя" inputMode="numeric" style={{ flex: 1 }} />
          <button className="btn btn-primary">Найти заказ</button>
        </form>
        <div className="card row" style={{ margin: 0 }}>
          <span className="muted small" style={{ flex: 1 }}>
            Клиент звонит и просит отложить деталь?
          </span>
          <button className="btn btn-accent" onClick={() => setPhoneOrder(true)}>
            + Бронь по телефону
          </button>
        </div>
      </div>
      <ErrorBox error={codeError} />
      {found && (
        <div style={{ marginTop: 12 }}>
          <OrderRow order={found} shopId={shop.id} onChange={refreshAll} />
        </div>
      )}

      <div className="chips" style={{ margin: "16px 0" }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorBox error={orders.error} onRetry={orders.reload} />
      {orders.loading && !orders.data ? (
        <Spinner />
      ) : orders.data?.length === 0 ? (
        <Empty>Заказов нет</Empty>
      ) : (
        orders.data?.map((o) => <OrderRow key={o.id} order={o} shopId={shop.id} onChange={refreshAll} />)
      )}
      {phoneOrder && (
        <PhoneOrderModal
          shopId={shop.id}
          onClose={() => setPhoneOrder(false)}
          onDone={() => {
            setPhoneOrder(false);
            void orders.reload();
          }}
        />
      )}
    </>
  );
}
