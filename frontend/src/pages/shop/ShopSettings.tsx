import { useState, type FormEvent } from "react";
import { api, errorText, useFetch } from "../../api";
import { ErrorBox, Notice } from "../../components/ui";
import type { ShopTabProps } from "./ShopCabinet";

interface Member {
  user_id: number;
  name: string;
  phone: string;
  role: "owner" | "staff";
}

export default function ShopSettings({ shop, reloadShop }: ShopTabProps) {
  const [profile, setProfile] = useState({
    name: shop.name,
    address: shop.address,
    phone: shop.phone,
    description: shop.description,
    delivery_available: shop.delivery_available,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wh, setWh] = useState({ name: "", address: "" });
  const members = useFetch<Member[]>(`/shops/${shop.id}/members`);
  const [memberPhone, setMemberPhone] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, onError = setError) => {
    onError(null);
    try {
      await fn();
    } catch (e) {
      onError(errorText(e));
    }
  };

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(`/shops/${shop.id}`, { method: "PATCH", body: profile });
      setSaved(true);
      reloadShop();
    });
  };

  return (
    <div className="grid grid-2">
      <form className="card stack" onSubmit={saveProfile} style={{ margin: 0 }}>
        <h3>Профиль магазина</h3>
        <label className="field">
          <span>Название</span>
          <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Адрес</span>
          <input value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
        </label>
        <label className="field">
          <span>Телефон</span>
          <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
        </label>
        <label className="field">
          <span>Описание</span>
          <textarea rows={2} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={profile.delivery_available} onChange={(e) => setProfile({ ...profile, delivery_available: e.target.checked })} />
          Доставка в районы
        </label>
        <div className="small muted">
          Код магазина: <span className="mono">{shop.code}</span> · БИН: {shop.bin ?? "не указан"}
        </div>
        <ErrorBox error={error} />
        {saved && <Notice kind="ok">Сохранено</Notice>}
        <button className="btn btn-primary">Сохранить</button>
      </form>

      <div className="stack">
        <section className="card" style={{ margin: 0 }}>
          <h3>Склады и точки выдачи</h3>
          <ul style={{ paddingLeft: 18, margin: "0 0 10px" }}>
            {shop.warehouses.map((w) => (
              <li key={w.id}>
                {w.name} <span className="muted small">{w.address}</span>
              </li>
            ))}
          </ul>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`/shops/${shop.id}/warehouses`, { body: wh });
                setWh({ name: "", address: "" });
                reloadShop();
              });
            }}
          >
            <input value={wh.name} onChange={(e) => setWh({ ...wh, name: e.target.value })} placeholder="Название" required style={{ flex: 1 }} />
            <input value={wh.address} onChange={(e) => setWh({ ...wh, address: e.target.value })} placeholder="Адрес" style={{ flex: 1 }} />
            <button className="btn">Добавить</button>
          </form>
        </section>

        <section className="card" style={{ margin: 0 }}>
          <h3>Сотрудники</h3>
          {members.data?.map((m) => (
            <div key={m.user_id} className="row-between small">
              <span>
                {m.name} <span className="muted">{m.phone}</span>
              </span>
              <span className="badge">{m.role === "owner" ? "владелец" : "продавец"}</span>
            </div>
          ))}
          <form
            className="row"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                members.setData(await api<Member[]>(`/shops/${shop.id}/members`, { body: { phone: memberPhone, role: "staff" } }));
                setMemberPhone("");
              }, setMemberError);
            }}
          >
            <input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} placeholder="Телефон сотрудника" required style={{ flex: 1 }} />
            <button className="btn">Пригласить</button>
          </form>
          <p className="small muted">Сотрудник должен быть зарегистрирован в AgroParts.</p>
          <ErrorBox error={memberError} />
        </section>

        <section className="card" style={{ margin: 0 }}>
          <h3>Интеграция с 1С</h3>
          <p className="small muted">
            Учётная система отправляет остатки и цены пакетами. Товары из неё получают статус «наличие гарантировано».
          </p>
          {apiKey ? (
            <>
              <Notice kind="warn">Сохраните ключ — он показывается один раз.</Notice>
              <pre className="mono small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--surface-2)", padding: 10, borderRadius: 8 }}>
                {`POST /api/integrations/1c/stock
X-Api-Key: ${apiKey}

{"items": [{"sku": "${shop.code}-000001", "price": 8500, "qty": 12}]}`}
              </pre>
            </>
          ) : (
            <button
              className="btn"
              onClick={() =>
                (!shop.has_api_key || confirm("Старый ключ перестанет работать. Продолжить?")) &&
                void run(async () => setApiKey((await api<{ api_key: string }>(`/shops/${shop.id}/api-key`, { method: "POST" })).api_key))
              }
            >
              {shop.has_api_key ? "Выпустить новый ключ" : "Получить API-ключ"}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
