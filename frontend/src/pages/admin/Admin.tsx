import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorText, qs, useFetch } from "../../api";
import { useAuth } from "../../auth";
import MachinePicker, { emptyMachine } from "../../components/MachinePicker";
import { dateTime, money } from "../../format";
import { useI18n, type TKey } from "../../i18n";
import { Empty, ErrorBox, Notice, Spinner, Tabs } from "../../components/ui";
import type { Brand, Category, CompatRow, PartBrief, PartDetail, Role, ShopStatus } from "../../types";

// ---------------------------------------------------------------- обзор

interface AdminStats {
  shops: { total: number; verified: number; pending: number };
  users: number;
  parts: number;
  offers: { total: number; review: number };
  compat_pending: number;
  orders_by_status: Record<string, number>;
  issued_by_channel: Record<string, { orders: number; revenue: number }>;
}

function Overview() {
  const { t } = useI18n();
  const s = useFetch<AdminStats>("/admin/stats");
  if (!s.data) return s.loading ? <Spinner /> : <ErrorBox error={s.error} />;
  const d = s.data;
  const revenue = Object.values(d.issued_by_channel).reduce((a, c) => a + c.revenue, 0);
  const kpis: [string, string | number][] = [
    ["Магазины (проверено)", `${d.shops.verified} / ${d.shops.total}`],
    ["Ждут проверки", d.shops.pending],
    ["Пользователи", d.users],
    ["Карточек в каталоге", d.parts],
    ["Предложений магазинов", d.offers.total],
    ["На сопоставлении", d.offers.review],
    ["Совместимость на проверке", d.compat_pending],
    ["Оборот (выданные)", money(revenue)],
  ];
  return (
    <>
      <div className="grid grid-4">
        {kpis.map(([label, value]) => (
          <div key={label} className="kpi">
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Заказы по статусам</h3>
        <div className="chips">
          {Object.entries(d.orders_by_status).map(([st, n]) => (
            <span key={st} className="badge">
              {t(`status.${st}` as TKey)}: {n}
            </span>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Критерии готовности MVP (ТЗ, п. 12)</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{d.shops.verified >= 5 ? "✓" : "○"} Подключено минимум 5 магазинов — сейчас {d.shops.verified}</li>
          <li>✓ Поиск по артикулу и названию, сравнение предложений на одной странице</li>
          <li>✓ Магазин сам меняет цену и остаток; бронь, подтверждение и выдача</li>
          <li>✓ История заказов и журнал изменений остатков</li>
        </ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- магазины

interface AdminShop {
  id: number;
  name: string;
  code: string;
  bin: string | null;
  city: string;
  address: string;
  phone: string;
  status: ShopStatus;
  offers: number;
  created_at: string;
}

function Shops() {
  const shops = useFetch<AdminShop[]>("/admin/shops");
  const setStatus = async (id: number, status: ShopStatus) => {
    await api(`/admin/shops/${id}/status`, { body: { status } });
    void shops.reload();
  };
  if (!shops.data) return shops.loading ? <Spinner /> : <ErrorBox error={shops.error} />;
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Магазин</th>
            <th>БИН</th>
            <th className="num">Товаров</th>
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shops.data.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                <div className="small muted">
                  {s.city}, {s.address} · {s.phone} · с {dateTime(s.created_at)}
                </div>
              </td>
              <td className="mono small">{s.bin ?? "—"}</td>
              <td className="num">{s.offers}</td>
              <td>
                <span className={`badge ${s.status === "verified" ? "badge-green" : s.status === "pending" ? "badge-yellow" : "badge-red"}`}>
                  {{ verified: "проверен", pending: "ждёт проверки", blocked: "заблокирован" }[s.status]}
                </span>
              </td>
              <td className="num">
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {s.status !== "verified" && (
                    <button className="btn btn-sm btn-primary" onClick={() => setStatus(s.id, "verified")}>
                      Подтвердить
                    </button>
                  )}
                  {s.status !== "blocked" && (
                    <button className="btn btn-sm btn-danger" onClick={() => confirm(`Заблокировать «${s.name}»?`) && setStatus(s.id, "blocked")}>
                      Блок
                    </button>
                  )}
                  <Link className="btn btn-sm" to={`/shop/${s.id}/orders`}>
                    Кабинет
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- сопоставление

interface ReviewItem {
  id: number;
  shop: string;
  sku: string;
  title: string;
  article: string | null;
  manufacturer: string | null;
  price: number;
  suggestions: { part_id: number; name: string; numbers: string[]; score: number }[];
}

function PartFinder({ onPick, placeholder = "Найти карточку в каталоге" }: { onPick: (p: PartBrief) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const res = useFetch<{ items: PartBrief[] }>(q.trim().length >= 2 ? `/catalog/search${qs({ q, limit: 6 })}` : null);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {res.data?.items.map((p) => (
        <button type="button" key={p.id} className="btn btn-sm" style={{ justifyContent: "space-between" }} onClick={() => onPick(p)}>
          <span>{p.name}</span>
          <span className="mono muted">{p.numbers.join(", ")}</span>
        </button>
      ))}
    </div>
  );
}

function ReviewRow({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const match = async (body: object) => {
    setError(null);
    try {
      await api(`/admin/offers/${item.id}/match`, { body });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const createPart = () =>
    match({
      create_part: {
        name: item.title,
        numbers: item.article ? [{ number: item.article, kind: "manufacturer", manufacturer: item.manufacturer }] : [],
      },
    });

  return (
    <div className="card">
      <div className="row-between">
        <div>
          <strong>{item.title}</strong>
          <div className="small muted">
            {item.shop} · <span className="mono">{item.sku}</span>
            {item.article && (
              <>
                {" "}
                · артикул <span className="mono">{item.article}</span>
              </>
            )}
            {item.manufacturer && ` · ${item.manufacturer}`} · {money(item.price)}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={createPart} title="Создать новую карточку каталога из этого товара">
            Новая карточка
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => match({ reject: true })}>
            Не запчасть / отклонить
          </button>
        </div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 10 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Похожие карточки (подтвердите по номеру и характеристикам):</span>
          {item.suggestions.length === 0 && <span className="small muted">нет кандидатов</span>}
          {item.suggestions.map((s) => (
            <div key={s.part_id} className="row-between small">
              <span>
                <Link to={`/parts/${s.part_id}`} target="_blank">
                  {s.name}
                </Link>{" "}
                <span className="mono muted">{s.numbers.join(", ")}</span>
              </span>
              <span className="row">
                <span className="badge">{Math.round(s.score * 100)}%</span>
                <button className="btn btn-sm btn-primary" onClick={() => match({ part_id: s.part_id })}>
                  Привязать
                </button>
              </span>
            </div>
          ))}
        </div>
        <PartFinder onPick={(p) => match({ part_id: p.id })} placeholder="…или найти вручную" />
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Review() {
  const queue = useFetch<ReviewItem[]>("/admin/offers/review");
  if (!queue.data) return queue.loading ? <Spinner /> : <ErrorBox error={queue.error} />;
  return (
    <>
      <Notice kind="info">
        Автоматически привязываются только товары с однозначным совпадением номера. Здесь — всё остальное: названия «как в
        магазине», опечатки, неизвестные артикулы.
      </Notice>
      <div style={{ marginTop: 12 }}>
        {queue.data.length === 0 ? <Empty>Очередь пуста</Empty> : queue.data.map((i) => <ReviewRow key={i.id} item={i} onDone={queue.reload} />)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- модерация

function Moderation() {
  const compat = useFetch<(CompatRow & { part: { id: number; name: string } })[]>("/admin/compatibility/pending");
  const analogs = useFetch<{ id: number; part: { id: number; name: string }; analog: { id: number; name: string }; source: string; note: string }[]>(
    "/admin/analogs/pending",
  );
  const verify = async (kind: "compatibility" | "analogs", id: number, approve: boolean) => {
    await api(`/admin/${kind}/${id}/verify`, { body: { approve } });
    void (kind === "compatibility" ? compat.reload() : analogs.reload());
  };
  return (
    <div className="grid grid-2">
      <section className="card" style={{ margin: 0 }}>
        <h3>Совместимость на проверке</h3>
        <p className="small muted">Покупатели видят только подтверждённые записи. Проверяйте по источнику.</p>
        {compat.data?.length === 0 && <Empty>Нет записей</Empty>}
        {compat.data?.map((c) => (
          <div key={c.id} className="part-row">
            <div className="info small">
              <Link to={`/parts/${c.part.id}`}>{c.part.name}</Link> → <strong>{c.model}</strong>
              {c.modification && `, ${c.modification}`}
              <div className="muted">Источник: {c.source}</div>
            </div>
            <div className="row">
              <button className="btn btn-sm btn-primary" onClick={() => verify("compatibility", c.id, true)}>
                Подтвердить
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => verify("compatibility", c.id, false)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="card" style={{ margin: 0 }}>
        <h3>Аналоги на проверке</h3>
        <p className="small muted">Аналог не считается совместимым по похожему названию или фото.</p>
        {analogs.data?.length === 0 && <Empty>Нет записей</Empty>}
        {analogs.data?.map((a) => (
          <div key={a.id} className="part-row">
            <div className="info small">
              <Link to={`/parts/${a.part.id}`}>{a.part.name}</Link> ⇄ <Link to={`/parts/${a.analog.id}`}>{a.analog.name}</Link>
              <div className="muted">Источник: {a.source}</div>
            </div>
            <div className="row">
              <button className="btn btn-sm btn-primary" onClick={() => verify("analogs", a.id, true)}>
                Подтвердить
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => verify("analogs", a.id, false)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- каталог

function NewPartForm({ onCreated }: { onCreated: (p: PartDetail) => void }) {
  const categories = useFetch<Category[]>("/catalog/categories");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [numbers, setNumbers] = useState([{ number: "", kind: "oem", manufacturer: "" }]);
  const [specs, setSpecs] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const specsObj = Object.fromEntries(
        specs.split("\n").map((l) => l.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(":").trim()]),
      );
      const p = await api<PartDetail>("/catalog/parts", {
        body: {
          name,
          category_id: categoryId ? Number(categoryId) : null,
          specs: specsObj,
          numbers: numbers.filter((n) => n.number.trim()).map((n) => ({ ...n, manufacturer: n.manufacturer || null })),
        },
      });
      setName("");
      setSpecs("");
      setNumbers([{ number: "", kind: "oem", manufacturer: "" }]);
      onCreated(p);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <form className="card stack" onSubmit={submit} style={{ margin: 0 }}>
      <h3>Новая карточка запчасти</h3>
      <label className="field">
        <span>Название</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </label>
      <label className="field">
        <span>Категория</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <span className="small muted" style={{ fontWeight: 600 }}>
        Номера
      </span>
      {numbers.map((n, i) => (
        <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
          <select value={n.kind} onChange={(e) => setNumbers(numbers.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))} style={{ width: 130 }}>
            <option value="oem">OEM</option>
            <option value="manufacturer">Производитель</option>
          </select>
          <input value={n.number} placeholder="Номер" onChange={(e) => setNumbers(numbers.map((x, k) => (k === i ? { ...x, number: e.target.value } : x)))} />
          <input value={n.manufacturer} placeholder="Бренд" onChange={(e) => setNumbers(numbers.map((x, k) => (k === i ? { ...x, manufacturer: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setNumbers([...numbers, { number: "", kind: "manufacturer", manufacturer: "" }])}>
        + номер
      </button>
      <label className="field">
        <span>Характеристики (по строке «Параметр: значение»)</span>
        <textarea rows={3} value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder={"Длина, мм: 4330\nПрофиль: HB"} />
      </label>
      <ErrorBox error={error} />
      <button className="btn btn-primary">Создать</button>
    </form>
  );
}

function PartLinks({ part, onChange }: { part: PartDetail; onChange: () => void }) {
  const brands = useFetch<Brand[]>("/catalog/brands");
  const [machine, setMachine] = useState(emptyMachine);
  const [years, setYears] = useState({ from: "", to: "" });
  const [source, setSource] = useState("");
  const [analogSource, setAnalogSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="card stack" style={{ margin: 0 }}>
      <div className="row-between">
        <h3 style={{ margin: 0 }}>{part.name}</h3>
        <Link to={`/parts/${part.id}`}>Карточка →</Link>
      </div>
      <div className="small">
        {part.compatibility.map((c) => (
          <div key={c.id}>
            {c.verified ? "✓" : "⏳"} {c.model}
            {c.modification && `, ${c.modification}`} <span className="muted">— {c.source}</span>
          </div>
        ))}
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api(`/catalog/parts/${part.id}/compatibility`, {
              body: {
                model_id: machine.modelId,
                modification_id: machine.modificationId,
                year_from: years.from ? Number(years.from) : null,
                year_to: years.to ? Number(years.to) : null,
                source,
              },
            }),
          );
        }}
      >
        <strong className="small">Добавить совместимость</strong>
        {brands.data && <MachinePicker brands={brands.data} value={machine} onChange={setMachine} />}
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input placeholder="Год с" value={years.from} onChange={(e) => setYears({ ...years, from: e.target.value })} />
          <input placeholder="Год по" value={years.to} onChange={(e) => setYears({ ...years, to: e.target.value })} />
        </div>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Источник: каталог, страница, документ" required minLength={3} />
        <button className="btn btn-sm" disabled={!machine.modelId}>
          Добавить (уйдёт на проверку)
        </button>
      </form>
      <hr style={{ margin: "4px 0" }} />
      <strong className="small">Добавить аналог</strong>
      <input value={analogSource} onChange={(e) => setAnalogSource(e.target.value)} placeholder="Источник взаимозаменяемости" />
      <PartFinder
        placeholder="Найти деталь-аналог"
        onPick={(p) =>
          void run(() => {
            if (analogSource.trim().length < 3) throw new Error("Укажите источник взаимозаменяемости");
            return api(`/catalog/parts/${part.id}/analogs`, { body: { analog_id: p.id, source: analogSource } });
          })
        }
      />
      <ErrorBox error={error} />
    </section>
  );
}

function CatalogEditor() {
  const [partId, setPartId] = useState<number | null>(null);
  const part = useFetch<PartDetail>(partId ? `/catalog/parts/${partId}/full` : null);
  return (
    <div className="grid grid-2">
      <div className="stack">
        <section className="card" style={{ margin: 0 }}>
          <h3>Найти карточку</h3>
          <PartFinder onPick={(p) => setPartId(p.id)} />
        </section>
        <NewPartForm onCreated={(p) => setPartId(p.id)} />
      </div>
      {part.data ? <PartLinks part={part.data} onChange={part.reload} /> : <Empty>Выберите или создайте карточку, чтобы добавить совместимость и аналоги</Empty>}
    </div>
  );
}

// ---------------------------------------------------------------- пользователи

function Users() {
  const [q, setQ] = useState("");
  const users = useFetch<{ id: number; name: string; phone: string; role: Role; is_active: boolean; created_at: string }[]>(`/admin/users${qs({ q })}`);
  const [error, setError] = useState<string | null>(null);
  const patch = async (id: number, body: object) => {
    setError(null);
    try {
      await api(`/admin/users/${id}`, { method: "PATCH", body });
      void users.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или телефон" style={{ maxWidth: 320, marginBottom: 12 }} />
      <ErrorBox error={error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                <td>
                  {u.name}
                  <div className="small muted">{u.phone}</div>
                </td>
                <td>
                  <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} style={{ width: "auto" }}>
                    <option value="buyer">Покупатель / продавец</option>
                    <option value="content_manager">Контент-менеджер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </td>
                <td className="num">
                  <button className="btn btn-sm" onClick={() => patch(u.id, { is_active: !u.is_active })}>
                    {u.is_active ? "Заблокировать" : "Разблокировать"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- оболочка

const ALL_TABS = [
  { id: "overview", label: "Обзор", admin: true, C: Overview },
  { id: "shops", label: "Магазины", admin: true, C: Shops },
  { id: "review", label: "Сопоставление", admin: false, C: Review },
  { id: "moderation", label: "Модерация", admin: false, C: Moderation },
  { id: "catalog", label: "Каталог", admin: false, C: CatalogEditor },
  { id: "users", label: "Пользователи", admin: true, C: Users },
] as const;

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { "*": rest } = useParams();
  const tabs = ALL_TABS.filter((t) => !t.admin || user?.role === "admin");
  const current = tabs.find((t) => t.id === rest) ?? tabs[0];
  return (
    <>
      <h1>{user?.role === "admin" ? "Администрирование" : "Контент каталога"}</h1>
      <Tabs tabs={tabs.map((t) => ({ id: t.id as string, label: t.label }))} value={current.id} onChange={(id) => navigate(`/admin/${id}`)} />
      <current.C />
    </>
  );
}
