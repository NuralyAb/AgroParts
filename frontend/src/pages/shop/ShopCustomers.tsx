import { useState, type FormEvent } from "react";
import { api, errorText, qs, useFetch } from "../../api";
import { dateTime, money } from "../../format";
import { CHANNEL_LABEL, Empty, ErrorBox, Modal, Spinner, StatusBadge } from "../../components/ui";
import type { Customer, Order } from "../../types";
import type { ShopTabProps } from "./ShopCabinet";

function CustomerModal({ shopId, customer, onClose, onSaved }: { shopId: number; customer: Customer; onClose: () => void; onSaved: () => void }) {
  const orders = useFetch<Order[]>(`/shops/${shopId}/orders${qs({ customer_id: customer.id })}`);
  const [note, setNote] = useState(customer.note);
  const [farm, setFarm] = useState(customer.farm ?? "");
  const save = async () => {
    await api(`/shops/${shopId}/customers/${customer.id}`, { method: "PATCH", body: { note, farm: farm || null } });
    onSaved();
  };
  return (
    <Modal title={customer.name} onClose={onClose}>
      <div className="stack">
        <div className="small muted">
          {customer.phone ?? "без телефона"} · {customer.from_marketplace ? "покупатель маркетплейса" : "добавлен вручную"}
        </div>
        <label className="field">
          <span>Хозяйство / компания</span>
          <input value={farm} onChange={(e) => setFarm(e.target.value)} />
        </label>
        <label className="field">
          <span>Заметки (какая техника, договорённости)</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={save}>
          Сохранить
        </button>
        <h3>История заказов</h3>
        {orders.loading && !orders.data ? (
          <Spinner />
        ) : orders.data?.length === 0 ? (
          <Empty>Заказов нет</Empty>
        ) : (
          <table>
            <tbody>
              {orders.data?.map((o) => (
                <tr key={o.id}>
                  <td className="small">
                    {o.number}
                    <div className="muted">{dateTime(o.created_at)}</div>
                  </td>
                  <td className="small">
                    {o.items.map((i) => `${i.title} × ${i.qty}`).join(", ")}
                    <div className="muted">{CHANNEL_LABEL[o.channel]}</div>
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

export default function ShopCustomers({ shop }: ShopTabProps) {
  const [q, setQ] = useState("");
  const customers = useFetch<Customer[]>(`/shops/${shop.id}/customers${qs({ q })}`);
  const [open, setOpen] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", farm: "" });
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/shops/${shop.id}/customers`, { body: { name: form.name, phone: form.phone || null, farm: form.farm || null } });
      setForm({ name: "", phone: "", farm: "" });
      void customers.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="pos">
      <section>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя, телефон или хозяйство" style={{ marginBottom: 12 }} />
        {customers.loading && !customers.data ? (
          <Spinner />
        ) : customers.data?.length === 0 ? (
          <Empty>Клиентов нет. Покупатели маркетплейса появятся здесь автоматически после первого заказа.</Empty>
        ) : (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th className="num">Покупок</th>
                  <th className="num">Сумма</th>
                  <th>Последняя</th>
                </tr>
              </thead>
              <tbody>
                {customers.data?.map((c) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setOpen(c)}>
                    <td>
                      <strong>{c.name}</strong> {c.from_marketplace && <span className="badge badge-blue">маркетплейс</span>}
                      <div className="small muted">
                        {c.phone}
                        {c.farm && ` · ${c.farm}`}
                      </div>
                    </td>
                    <td className="num">{c.orders}</td>
                    <td className="num">{money(c.spent)}</td>
                    <td className="small">{dateTime(c.last_order_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <form className="card stack" onSubmit={add} style={{ margin: 0 }}>
        <h3>Новый клиент</h3>
        <label className="field">
          <span>Имя / ФИО</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </label>
        <label className="field">
          <span>Телефон</span>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </label>
        <label className="field">
          <span>Хозяйство</span>
          <input value={form.farm} onChange={(e) => setForm({ ...form, farm: e.target.value })} />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary">Добавить</button>
      </form>
      {open && (
        <CustomerModal
          shopId={shop.id}
          customer={open}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void customers.reload();
          }}
        />
      )}
    </div>
  );
}
