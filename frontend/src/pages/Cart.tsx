import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { useCart, type CartItem } from "../cart";
import { money } from "../format";
import { useI18n } from "../i18n";
import { Empty, ErrorBox, Notice } from "../components/ui";
import type { Order } from "../types";

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [paymentMode, setPaymentMode] = useState<"on_pickup" | "online">("on_pickup");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cart.items.length === 0) {
    return (
      <section className="card">
        <h1>{t("nav.cart")}</h1>
        <Empty>
          Корзина пуста. <Link to="/search">Перейти в каталог</Link>
        </Empty>
      </section>
    );
  }

  const byShop = new Map<number, CartItem[]>();
  for (const i of cart.items) byShop.set(i.shop_id, [...(byShop.get(i.shop_id) ?? []), i]);
  const total = cart.items.reduce((s, i) => s + i.price * i.qty, 0);

  const checkout = async () => {
    if (!user) {
      navigate("/login?next=/cart");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const orders = await api<Order[]>("/orders/checkout", {
        body: { items: cart.items.map((i) => ({ offer_id: i.offer_id, qty: i.qty })), payment_mode: paymentMode, comment },
      });
      cart.removeMany(cart.items.map((i) => i.offer_id));
      navigate(`/orders?created=${orders.map((o) => o.number).join(",")}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos">
      <section className="stack">
        <h1>{t("nav.cart")}</h1>
        {[...byShop.entries()].map(([shopId, items]) => (
          <div key={shopId} className="card">
            <div className="card-title">
              <h3>{items[0].shop_name}</h3>
              <span className="muted small">отдельный заказ</span>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.offer_id}>
                      <td>
                        {i.part_id ? <Link to={`/parts/${i.part_id}`}>{i.title}</Link> : i.title}
                        {i.available !== null && i.qty > i.available && (
                          <div className="small" style={{ color: "var(--danger)" }}>Доступно только {i.available} шт.</div>
                        )}
                      </td>
                      <td className="num">{money(i.price)}</td>
                      <td className="num">
                        <input
                          className="qty"
                          type="number"
                          min={1}
                          value={i.qty}
                          onChange={(e) => cart.setQty(i.offer_id, Number(e.target.value) || 1)}
                          aria-label="Количество"
                        />
                      </td>
                      <td className="num">
                        <strong>{money(i.price * i.qty)}</strong>
                      </td>
                      <td className="num">
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => cart.remove(i.offer_id)} aria-label="Удалить">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <aside className="card stack" style={{ position: "sticky", top: 80 }}>
        <h2>Оформление</h2>
        <label className="check">
          <input type="radio" checked={paymentMode === "on_pickup"} onChange={() => setPaymentMode("on_pickup")} />
          Бронь, оплата при получении
        </label>
        <label className="check">
          <input type="radio" checked={paymentMode === "online"} onChange={() => setPaymentMode("online")} />
          Онлайн-оплата (тестовый режим)
        </label>
        <label className="field">
          <span>Комментарий магазину</span>
          <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Когда удобно забрать" />
        </label>
        <Notice kind="info">
          Товар резервируется сразу. Магазин подтверждает бронь и держит товар до получения; неподтверждённая бронь снимается
          автоматически.
        </Notice>
        <div className="row-between">
          <span className="muted">Итого ({byShop.size} заказ.)</span>
          <span className="receipt-total">{money(total)}</span>
        </div>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={checkout}>
          {user ? t("cart.checkout") : "Войти и оформить"}
        </button>
      </aside>
    </div>
  );
}
