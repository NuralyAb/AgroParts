import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorText, qs, useFetch } from "../../api";
import { ago, dateTime, money } from "../../format";
import { Empty, ErrorBox, Modal, Notice, Spinner } from "../../components/ui";
import type { Movement, PartBrief, ShopOffer, ShopPrivate } from "../../types";
import type { ShopTabProps } from "./ShopCabinet";

const MATCH = {
  matched: ["badge-green", "в каталоге"],
  review: ["badge-yellow", "на сопоставлении"],
  unmatched: ["badge-red", "нет в каталоге"],
} as const;

const KIND: Record<string, string> = {
  receipt: "Приход", sale: "Продажа", count: "Инвентаризация", import: "Импорт", sync: "Синхронизация 1С",
  reserve: "Резерв", release: "Снятие резерва", issue: "Выдача брони",
};

function PartSearch({ onPick }: { onPick: (p: PartBrief | null) => void }) {
  const [q, setQ] = useState("");
  const res = useFetch<{ items: PartBrief[] }>(q.trim().length >= 2 ? `/catalog/search${qs({ q, limit: 8 })}` : null);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в едином каталоге: название или номер" />
      {res.data?.items.map((p) => (
        <button type="button" key={p.id} className="btn btn-sm" style={{ justifyContent: "space-between" }} onClick={() => onPick(p)}>
          <span>{p.name}</span>
          <span className="mono muted">{p.numbers[0]}</span>
        </button>
      ))}
    </div>
  );
}

function AddOfferModal({ shop, onClose, onDone }: { shop: ShopPrivate; onClose: () => void; onDone: () => void }) {
  const [part, setPart] = useState<PartBrief | null>(null);
  const [f, setF] = useState({ title: "", article: "", manufacturer: "", price: "", initial_qty: "0", bin_location: "", sku: "", warehouse_id: String(shop.warehouses[0]?.id ?? ""), stock_mode: "tracked" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const pick = (p: PartBrief | null) => {
    setPart(p);
    if (p) setF({ ...f, title: f.title || p.name, article: f.article || (p.oem ?? p.numbers[0] ?? "") });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/shops/${shop.id}/offers`, {
        body: {
          ...f,
          part_id: part?.id ?? null,
          price: Number(f.price),
          initial_qty: Number(f.initial_qty),
          warehouse_id: Number(f.warehouse_id),
          sku: f.sku || null,
          article: f.article || null,
          manufacturer: f.manufacturer || null,
          bin_location: f.bin_location || null,
        },
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title="Новый товар" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {part ? (
          <Notice kind="ok">
            Карточка каталога: <strong>{part.name}</strong>{" "}
            <button type="button" className="link" onClick={() => setPart(null)}>
              изменить
            </button>
          </Notice>
        ) : (
          <>
            <PartSearch onPick={pick} />
            <p className="small muted">
              Не нашли? Заполните поля ниже — товар уйдёт на сопоставление с каталогом (по номеру — автоматически).
            </p>
          </>
        )}
        <label className="field">
          <span>Название, как у вас в магазине</span>
          <input value={f.title} onChange={set("title")} required minLength={2} />
        </label>
        <div className="grid grid-2">
          <label className="field">
            <span>Артикул / OEM</span>
            <input value={f.article} onChange={set("article")} />
          </label>
          <label className="field">
            <span>Производитель</span>
            <input value={f.manufacturer} onChange={set("manufacturer")} />
          </label>
          <label className="field">
            <span>Цена, ₸</span>
            <input type="number" min={0} value={f.price} onChange={set("price")} required />
          </label>
          <label className="field">
            <span>Начальный остаток</span>
            <input type="number" min={0} value={f.initial_qty} onChange={set("initial_qty")} />
          </label>
          <label className="field">
            <span>Склад</span>
            <select value={f.warehouse_id} onChange={set("warehouse_id")}>
              {shop.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ячейка</span>
            <input value={f.bin_location} onChange={set("bin_location")} placeholder="A-03-2" />
          </label>
          <label className="field">
            <span>Внутренний SKU</span>
            <input value={f.sku} onChange={set("sku")} placeholder={`авто: ${shop.code}-000…`} />
          </label>
          <label className="field">
            <span>Учёт остатков</span>
            <select value={f.stock_mode} onChange={set("stock_mode")}>
              <option value="tracked">Веду в AgroParts / 1С</option>
              <option value="manual">Вручную (подтверждаю наличие)</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} />
        <button className="btn btn-primary">Добавить</button>
      </form>
    </Modal>
  );
}

function StockOpModal({
  shop,
  offer,
  op,
  onClose,
  onDone,
}: {
  shop: ShopPrivate;
  offer: ShopOffer;
  op: "receive" | "count";
  onClose: () => void;
  onDone: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(String(offer.stocks[0]?.warehouse_id ?? shop.warehouses[0]?.id));
  const stock = offer.stocks.find((s) => String(s.warehouse_id) === warehouseId);
  const [qty, setQty] = useState(op === "count" ? String(stock?.on_hand ?? 0) : "1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = { offer_id: offer.id, warehouse_id: Number(warehouseId), note, ...(op === "receive" ? { qty: Number(qty) } : { counted: Number(qty) }) };
      await api(`/shops/${shop.id}/stock/${op}`, { body });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title={op === "receive" ? `Приход: ${offer.title}` : `Инвентаризация: ${offer.title}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Склад</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {shop.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {stock && (
          <p className="small muted">
            Сейчас: физически {stock.on_hand}, в резерве {stock.reserved}, доступно {stock.available}
          </p>
        )}
        <label className="field">
          <span>{op === "receive" ? "Пришло, шт." : "Фактически на полке, шт."}</span>
          <input type="number" min={op === "receive" ? 1 : 0} value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
        </label>
        {op === "count" && stock && stock.reserved > 0 && (
          <Notice kind="warn">Нельзя указать меньше {stock.reserved} шт. — они отложены под брони. Сначала отмените брони.</Notice>
        )}
        <label className="field">
          <span>Комментарий</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={op === "receive" ? "накладная №…" : ""} />
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary">Провести</button>
      </form>
    </Modal>
  );
}

function MovementsModal({ shopId, offer, onClose }: { shopId: number; offer: ShopOffer | null; onClose: () => void }) {
  const moves = useFetch<Movement[]>(`/shops/${shopId}/movements${qs({ offer_id: offer?.id, limit: 200 })}`);
  return (
    <Modal title={offer ? `Журнал: ${offer.title}` : "Журнал движений склада"} onClose={onClose}>
      {moves.loading && !moves.data ? (
        <Spinner />
      ) : moves.data?.length === 0 ? (
        <Empty>Движений нет</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                {!offer && <th>Товар</th>}
                <th>Операция</th>
                <th className="num">Физ.</th>
                <th className="num">Резерв</th>
                <th className="num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {moves.data?.map((m) => (
                <tr key={m.id}>
                  <td className="small">
                    {dateTime(m.created_at)}
                    <div className="muted">{m.user ?? "система"}</div>
                  </td>
                  {!offer && <td className="small">{m.title}</td>}
                  <td className="small">
                    {KIND[m.kind] ?? m.kind}
                    {m.note && <div className="muted">{m.note}</div>}
                  </td>
                  <td className="num">{m.on_hand_delta ? (m.on_hand_delta > 0 ? `+${m.on_hand_delta}` : m.on_hand_delta) : ""}</td>
                  <td className="num">{m.reserved_delta ? (m.reserved_delta > 0 ? `+${m.reserved_delta}` : m.reserved_delta) : ""}</td>
                  <td className="num">
                    {m.on_hand_after} / {m.reserved_after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PriceCell({ shopId, offer, onSaved }: { shopId: number; offer: ShopOffer; onSaved: (o: ShopOffer) => void }) {
  const [value, setValue] = useState(String(offer.price));
  const [error, setError] = useState(false);
  const save = async () => {
    if (Number(value) === offer.price) return;
    try {
      onSaved(await api<ShopOffer>(`/shops/${shopId}/offers/${offer.id}`, { method: "PATCH", body: { price: Number(value) } }));
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ width: 100, textAlign: "right", borderColor: error ? "var(--danger)" : undefined }}
      aria-label="Цена"
      title="Цена, ₸ — сохраняется при выходе из поля"
    />
  );
}

export default function ShopStock({ shop }: ShopTabProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "review" | "out">("all");
  const offers = useFetch<ShopOffer[]>(`/shops/${shop.id}/offers${qs({ q, limit: 500 })}`);
  const [adding, setAdding] = useState(false);
  const [op, setOp] = useState<{ offer: ShopOffer; op: "receive" | "count" } | null>(null);
  const [journal, setJournal] = useState<{ offer: ShopOffer | null } | null>(null);

  const replace = (o: ShopOffer) => offers.setData((offers.data ?? []).map((x) => (x.id === o.id ? o : x)));
  const toggleActive = async (o: ShopOffer) =>
    replace(await api<ShopOffer>(`/shops/${shop.id}/offers/${o.id}`, { method: "PATCH", body: { is_active: !o.is_active } }));

  const list = (offers.data ?? []).filter((o) => (filter === "review" ? o.match_status !== "matched" : filter === "out" ? o.available <= 0 : true));
  const reviewCount = (offers.data ?? []).filter((o) => o.match_status !== "matched").length;
  const totals = (offers.data ?? []).reduce((a, o) => ({ on_hand: a.on_hand + o.on_hand, reserved: a.reserved + o.reserved }), { on_hand: 0, reserved: 0 });

  return (
    <>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row" style={{ flex: 1 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию, SKU, артикулу" style={{ maxWidth: 320 }} />
          <div className="chips">
            <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
              Все
            </button>
            <button className={`chip ${filter === "review" ? "on" : ""}`} onClick={() => setFilter("review")}>
              Не в каталоге {reviewCount > 0 && `(${reviewCount})`}
            </button>
            <button className={`chip ${filter === "out" ? "on" : ""}`} onClick={() => setFilter("out")}>
              Нет в наличии
            </button>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setJournal({ offer: null })}>
            Журнал
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Товар
          </button>
        </div>
      </div>
      <p className="small muted">
        Всего на складах: {totals.on_hand} шт., из них в резерве {totals.reserved}. Доступно = физический остаток − резервы; это же
        число видит маркетплейс.
      </p>
      <ErrorBox error={offers.error} onRetry={offers.reload} />
      {offers.loading && !offers.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty>Товаров нет. Добавьте вручную или загрузите Excel на вкладке «Импорт».</Empty>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Каталог</th>
                <th className="num">Физ.</th>
                <th className="num">Резерв</th>
                <th className="num">Доступно</th>
                <th className="num">Цена, ₸</th>
                <th>Ячейка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const [cls, text] = MATCH[o.match_status];
                return (
                  <tr key={o.id} style={{ opacity: o.is_active ? 1 : 0.5 }}>
                    <td>
                      <div>{o.title}</div>
                      <div className="small muted mono">
                        {o.sku}
                        {o.article && ` · ${o.article}`}
                      </div>
                      <div className="small muted">
                        {o.stock_mode === "manual" ? "ручной учёт" : "учёт в системе"} · {ago(o.updated_at)}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${cls}`}>{text}</span>
                      {o.part && (
                        <div className="small">
                          <Link to={`/parts/${o.part.id}`}>{o.part.name}</Link>
                        </div>
                      )}
                    </td>
                    <td className="num">{o.on_hand}</td>
                    <td className="num">{o.reserved || ""}</td>
                    <td className="num">
                      <strong style={{ color: o.available > 0 ? undefined : "var(--danger)" }}>{o.available}</strong>
                    </td>
                    <td className="num">
                      <PriceCell key={o.price} shopId={shop.id} offer={o} onSaved={replace} />
                    </td>
                    <td className="small mono">{o.stocks.map((s) => s.bin_location).filter(Boolean).join(", ")}</td>
                    <td className="num">
                      <div className="row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => setOp({ offer: o, op: "receive" })}>
                          Приход
                        </button>
                        <button className="btn btn-sm" onClick={() => setOp({ offer: o, op: "count" })}>
                          Пересчёт
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setJournal({ offer: o })} title="Журнал движений">
                          ☰
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(o)} title={o.is_active ? "Снять с продажи" : "Вернуть в продажу"}>
                          {o.is_active ? "⏸" : "▶"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        Итого стоимость остатков: {money((offers.data ?? []).reduce((s, o) => s + o.on_hand * o.price, 0))}
      </p>
      {adding && (
        <AddOfferModal
          shop={shop}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void offers.reload();
          }}
        />
      )}
      {op && (
        <StockOpModal
          shop={shop}
          offer={op.offer}
          op={op.op}
          onClose={() => setOp(null)}
          onDone={() => {
            setOp(null);
            void offers.reload();
          }}
        />
      )}
      {journal && <MovementsModal shopId={shop.id} offer={journal.offer} onClose={() => setJournal(null)} />}
    </>
  );
}
