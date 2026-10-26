import { useState, type FormEvent } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, errorText, useFetch } from "../../api";
import { useAuth } from "../../auth";
import { ErrorBox, Notice, Spinner, Tabs } from "../../components/ui";
import type { ShopPrivate } from "../../types";
import ShopCustomers from "./ShopCustomers";
import ShopImport from "./ShopImport";
import ShopLabels from "./ShopLabels";
import ShopOrders from "./ShopOrders";
import ShopPOS from "./ShopPOS";
import ShopSettings from "./ShopSettings";
import ShopStats from "./ShopStats";
import ShopStock from "./ShopStock";

export interface ShopTabProps {
  shop: ShopPrivate;
  reloadShop: () => void;
}

const TABS = [
  { id: "orders", label: "Заказы", C: ShopOrders },
  { id: "pos", label: "Касса", C: ShopPOS },
  { id: "stock", label: "Склад", C: ShopStock },
  { id: "customers", label: "Клиенты", C: ShopCustomers },
  { id: "import", label: "Импорт", C: ShopImport },
  { id: "labels", label: "Этикетки", C: ShopLabels },
  { id: "stats", label: "Статистика", C: ShopStats },
  { id: "settings", label: "Настройки", C: ShopSettings },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS = { pending: ["badge-yellow", "На проверке"], verified: ["badge-green", "Проверен"], blocked: ["badge-red", "Заблокирован"] } as const;

function Workspace() {
  const { shopId, tab = "orders" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const shop = useFetch<ShopPrivate>(`/shops/${shopId}`);
  if (shop.loading && !shop.data) return <Spinner />;
  if (!shop.data) return <ErrorBox error={shop.error} onRetry={shop.reload} />;
  const s = shop.data;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const [badgeClass, badgeText] = STATUS[s.status];

  return (
    <>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>{s.name}</h1>
          <span className={`badge ${badgeClass}`}>{badgeText}</span>
        </div>
        <div className="row">
          {user && user.shops.length > 1 && (
            <select value={s.id} onChange={(e) => navigate(`/shop/${e.target.value}/${tab}`)} style={{ width: "auto" }}>
              {user.shops.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-sm" onClick={() => navigate("/shop/new")}>
            + Магазин
          </button>
        </div>
      </div>
      {s.status === "pending" && (
        <Notice kind="warn">
          Магазин на проверке у администратора. Учёт, касса и CRM уже работают, но покупатели маркетплейса пока не видят ваши
          товары.
        </Notice>
      )}
      {s.status === "blocked" && <Notice kind="error">Магазин заблокирован администратором платформы.</Notice>}
      <div style={{ marginTop: 12 }}>
        <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={current.id as TabId} onChange={(id) => navigate(`/shop/${s.id}/${id}`)} />
        <current.C shop={s} reloadShop={shop.reload} />
      </div>
    </>
  );
}

function RegisterShop() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", bin: "", address: "", phone: "", description: "", delivery_available: false });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const shop = await api<ShopPrivate>("/shops", { body: { ...form, bin: form.bin || null } });
      await refresh();
      navigate(`/shop/${shop.id}/stock`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <section className="card">
        <h1>Подключить магазин</h1>
        <p className="muted">
          После регистрации вы сразу получите склад, кассу и CRM. На маркетплейсе товары появятся после проверки администратором.
        </p>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Название магазина</span>
            <input value={form.name} onChange={set("name")} required minLength={2} />
          </label>
          <label className="field">
            <span>БИН (12 цифр)</span>
            <input value={form.bin} onChange={set("bin")} pattern="\d{12}" inputMode="numeric" />
          </label>
          <label className="field">
            <span>Адрес точки выдачи</span>
            <input value={form.address} onChange={set("address")} />
          </label>
          <label className="field">
            <span>Телефон</span>
            <input value={form.phone} onChange={set("phone")} inputMode="tel" />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.delivery_available} onChange={(e) => setForm({ ...form, delivery_available: e.target.checked })} />
            Есть доставка в районы
          </label>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg">Зарегистрировать</button>
        </form>
      </section>
    </div>
  );
}

function Index() {
  const { user } = useAuth();
  if (user && user.shops.length > 0) return <Navigate to={`/shop/${user.shops[0].id}/orders`} replace />;
  return <RegisterShop />;
}

export default function ShopCabinet() {
  return (
    <Routes>
      <Route index element={<Index />} />
      <Route path="new" element={<RegisterShop />} />
      <Route path=":shopId" element={<Workspace />} />
      <Route path=":shopId/:tab" element={<Workspace />} />
    </Routes>
  );
}
