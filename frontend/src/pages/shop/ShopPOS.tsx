import { useState } from "react";
import { api, errorText, useFetch } from "../../api";
import { dateTime, money } from "../../format";
import { ErrorBox, Notice } from "../../components/ui";
import type { Customer, Order, ShopOffer } from "../../types";
import OfferPicker from "./OfferPicker";
import type { ShopTabProps } from "./ShopCabinet";

interface Line {
  offer: ShopOffer;
  qty: number;
}

export default function ShopPOS({ shop }: ShopTabProps) {
  const customers = useFetch<Customer[]>(`/shops/${shop.id}/customers`);
  const [lines, setLines] = useState<Line[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const add = (o: ShopOffer) => {
    setReceipt(null);
    setLines((prev) => {
      const ex = prev.find((l) => l.offer.id === o.id);
      if (ex) return prev.map((l) => (l.offer.id === o.id ? { ...l, qty: Math.min(o.available, l.qty + 1) } : l));
      return [...prev, { offer: o, qty: 1 }];
    });
  };

  const total = lines.reduce((s, l) => s + l.offer.price * l.qty, 0);

  const sell = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>(`/shops/${shop.id}/pos/sale`, {
        body: { items: lines.map((l) => ({ offer_id: l.offer.id, qty: l.qty })), customer_id: customerId ? Number(customerId) : null },
      });
      setReceipt(order);
      setLines([]);
      setCustomerId("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos">
      <section className="card" style={{ margin: 0 }}>
        <h3>Товары в наличии</h3>
        <p className="small muted">Продаётся только свободный остаток: отложенное под брони кассе недоступно.</p>
        <OfferPicker shopId={shop.id} onlyAvailable onPick={add} reloadKey={reloadKey} />
      </section>

      <aside className="card stack" style={{ margin: 0 }}>
        <h3>Чек</h3>
        {lines.length === 0 && !receipt && <p className="muted small">Выберите товары слева</p>}
        {lines.map((l) => (
          <div key={l.offer.id} className="row-between">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small">{l.offer.title}</div>
              <div className="small muted">
                {money(l.offer.price)} · доступно {l.offer.available}
              </div>
            </div>
            <input
              className="qty"
              type="number"
              min={1}
              max={l.offer.available}
              value={l.qty}
              onChange={(e) =>
                setLines(lines.map((x) => (x.offer.id === l.offer.id ? { ...x, qty: Math.max(1, Math.min(l.offer.available, Number(e.target.value) || 1)) } : x)))
              }
            />
            <button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((x) => x.offer.id !== l.offer.id))}>
              ✕
            </button>
          </div>
        ))}
        {lines.length > 0 && (
          <>
            <label className="field">
              <span>Клиент (для истории покупок)</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— розничный покупатель —</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ?? ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="row-between">
              <span className="muted">Итого</span>
              <span className="receipt-total">{money(total)}</span>
            </div>
            <ErrorBox error={error} />
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={sell}>
              Провести продажу
            </button>
          </>
        )}
        {receipt && (
          <Notice kind="ok">
            Продажа {receipt.number} проведена · {dateTime(receipt.created_at)} · {money(receipt.total)}. Остаток списан — маркетплейс
            уже видит новое количество.
          </Notice>
        )}
      </aside>
    </div>
  );
}
