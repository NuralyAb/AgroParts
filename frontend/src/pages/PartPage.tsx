import { AlertTriangle, Box, Check, ChevronRight, Clock, Heart, MapPin, Phone, Rotate3d, ShieldCheck, ShoppingCart, Truck } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorText, useFetch } from "../api";
import { useAuth } from "../auth";
import { useCart } from "../cart";
import ProductCard, { PartImage, plural } from "../components/ProductCard";
import { Empty, ErrorBox, Notice, Spinner } from "../components/ui";
import { ago, money, pcs, yearsText } from "../format";
import { useI18n } from "../i18n";
import type { CompatRow, PartBrief, PartDetail, PublicOffer, Vehicle } from "../types";

const PartCanvas = lazy(() => import("../three/PartCanvas"));

function fits(compat: CompatRow[], v: Vehicle): boolean {
  return compat.some(
    (c) =>
      c.model_id === v.model_id &&
      (c.modification_id === null || c.modification_id === v.modification_id) &&
      (!v.year || ((c.year_from ?? 0) <= v.year && v.year <= (c.year_to ?? 9999))),
  );
}

function OfferRow({ offer, part, best }: { offer: PublicOffer; part: PartDetail; best: boolean }) {
  const cart = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const out = offer.available <= 0;
  const add = () => {
    cart.add(
      { offer_id: offer.offer_id, part_id: part.id, title: part.name, price: offer.price, shop_id: offer.shop.id, shop_name: offer.shop.name, available: offer.available },
      qty,
    );
    setAdded(true);
  };
  return (
    <tr className={best ? "highlight" : ""}>
      <td>
        <div className="offer-shop">
          <span className="avatar">{offer.shop.name.slice(0, 1)}</span>
          <div>
            <strong>{offer.shop.name}</strong>
            <div className="small muted row" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 4 }}>
                <MapPin size={13} /> {offer.shop.address}
              </span>
              {offer.shop.delivery_available && (
                <span className="row" style={{ gap: 4 }}>
                  <Truck size={13} /> доставка
                </span>
              )}
            </div>
            <a className="small row" style={{ gap: 4 }} href={`tel:${offer.shop.phone.replace(/[^+\d]/g, "")}`}>
              <Phone size={13} /> {offer.shop.phone}
            </a>
          </div>
        </div>
      </td>
      <td>
        {offer.stock_mode === "tracked" ? (
          <span className="badge badge-green" title="Остатки ведутся в учётной системе магазина и обновляются автоматически">
            <ShieldCheck size={13} /> Наличие гарантировано
          </span>
        ) : (
          <span className="badge badge-yellow" title="Магазин обновляет остатки вручную — наличие подтвердит продавец">
            <Clock size={13} /> Подтвердит продавец
          </span>
        )}
        <div className="small muted" style={{ marginTop: 4 }}>
          {offer.manufacturer ?? offer.title}
        </div>
      </td>
      <td className="num">
        {out ? (
          <span className="badge">Нет в наличии</span>
        ) : (
          <span className="row" style={{ gap: 6, justifyContent: "flex-end", fontWeight: 700 }}>
            <span className="dot" /> {pcs(offer.available)}
          </span>
        )}
        <div className="small muted" title="Когда магазин последний раз обновлял остаток">
          обновлено {ago(offer.stock_updated_at)}
        </div>
      </td>
      <td className="num">
        <span className="price-big">{money(offer.price)}</span>
        {best && (
          <div style={{ marginTop: 3 }}>
            <span className="best-flag">Лучшая цена</span>
          </div>
        )}
      </td>
      <td className="num">
        {!out && (
          <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap", gap: 8 }}>
            <input
              className="qty"
              type="number"
              min={1}
              max={offer.available}
              value={qty}
              onChange={(e) => setQty(Math.min(offer.available, Math.max(1, Number(e.target.value) || 1)))}
              aria-label="Количество"
            />
            <button className={`btn ${added ? "" : "btn-primary"}`} onClick={add}>
              {added ? <Check size={16} /> : <ShoppingCart size={16} />}
              {added ? "В корзине" : "В корзину"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function PartPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const part = useFetch<PartDetail>(`/catalog/parts/${id}`);
  const garage = useFetch<Vehicle[]>(user ? "/garage" : null);
  const favorites = useFetch<{ parts: PartBrief[] }>(user ? "/favorites" : null);
  const [favError, setFavError] = useState<string | null>(null);

  if (part.loading && !part.data) return <Spinner />;
  if (!part.data) return <ErrorBox error={part.error} onRetry={part.reload} />;
  const p = part.data;
  const isFav = favorites.data?.parts.some((x) => x.id === p.id) ?? false;
  const inStock = p.offers.filter((o) => o.available > 0);
  const prices = inStock.map((o) => o.price);
  const bestPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const totalAvail = inStock.reduce((s, o) => s + o.available, 0);
  const oem = p.numbers.find((n) => n.kind === "oem");

  const toggleFav = async () => {
    try {
      if (isFav) await api(`/favorites/part/${p.id}`, { method: "DELETE" });
      else await api("/favorites", { body: { kind: "part", target_id: p.id } });
      await favorites.reload();
    } catch (e) {
      setFavError(errorText(e));
    }
  };

  return (
    <>
      <nav className="crumbs">
        <Link to="/">Главная</Link> <ChevronRight size={14} />
        <Link to="/search">Каталог</Link>
        {p.category && (
          <>
            <ChevronRight size={14} />
            <Link to={`/search?category_id=${p.category_id}`}>{p.category}</Link>
          </>
        )}
      </nav>

      <div className="product-top">
        <div className="gallery">
          <div className="main">
            {p.render ? (
              <Suspense fallback={<PartImage part={{ image_url: p.image_url, name: p.name, category: p.category }} size={96} />}>
                <PartCanvas spec={p.render} />
                <span className="tag3d">3D</span>
                <span className="hint">
                  <Rotate3d size={14} /> Покрутите деталь мышью или пальцем
                </span>
              </Suspense>
            ) : (
              <PartImage part={{ image_url: p.image_url, name: p.name, category: p.category }} size={96} />
            )}
          </div>
          {p.image_credit && (
            <div className="credit">
              Фото:{" "}
              <a href={p.image_credit.source_url} target="_blank" rel="noreferrer">
                {p.image_credit.author}
              </a>
              ,{" "}
              <a href={p.image_credit.license_url} target="_blank" rel="noreferrer">
                {p.image_credit.license}
              </a>
              . Иллюстрация, внешний вид у продавцов может отличаться.
            </div>
          )}
        </div>

        <div className="buybox">
          {p.category && <div className="eyebrow">{p.category}</div>}
          <h1>{p.name}</h1>
          <div className="nums">
            {p.numbers.map((n) => (
              <span key={n.id} className="badge badge-num" title={n.kind === "oem" ? "Оригинальный номер" : "Артикул производителя"}>
                {n.kind === "oem" ? "OEM" : n.manufacturer ?? "арт."} {n.number}
              </span>
            ))}
          </div>

          <div className="pricebox">
            {bestPrice !== null ? (
              <>
                <div className="from">Цена в магазинах Костаная</div>
                <div className="big">от {money(bestPrice)}</div>
                {maxPrice !== bestPrice && <div className="range">до {money(maxPrice)} — сравните ниже</div>}
              </>
            ) : (
              <>
                <div className="big" style={{ fontSize: 26 }}>Нет в наличии</div>
                <div className="range">{p.analogs.length ? "Посмотрите проверенные аналоги ниже" : "Добавьте в избранное — увидите, когда появится"}</div>
              </>
            )}
            <div className="facts">
              <div>
                <b>{inStock.length}</b>
                <span>{plural(inStock.length, "магазин", "магазина", "магазинов")} в наличии</span>
              </div>
              <div>
                <b>{totalAvail}</b>
                <span>штук всего</span>
              </div>
              <div>
                <b>{p.compatibility.length}</b>
                <span>{plural(p.compatibility.length, "модель", "модели", "моделей")} техники</span>
              </div>
            </div>
            <div className="row">
              <a href="#offers" className="btn btn-primary btn-lg" style={{ flex: 1 }}>
                <ShoppingCart size={18} /> Выбрать магазин
              </a>
              {user && (
                <button className="btn btn-lg" onClick={toggleFav} aria-pressed={isFav} title="Избранное">
                  <Heart size={18} fill={isFav ? "currentColor" : "none"} color={isFav ? "var(--danger)" : undefined} />
                </button>
              )}
              {p.on_3d_models.map((m) => (
                <Link key={m.model3d_id} className="btn btn-lg" to={`/catalog3d/${m.model3d_id}?key=${m.component_key}`} title="Показать на 3D-модели">
                  <Box size={18} /> 3D
                </Link>
              ))}
            </div>
            <ErrorBox error={favError} />
          </div>

          {user && garage.data && garage.data.length > 0 && (
            <div className="fit-list">
              {garage.data.map((v) =>
                fits(p.compatibility, v) ? (
                  <Notice key={v.id} kind="ok">
                    <Check size={17} /> Подходит для вашей техники: <b>{v.title || v.model}</b>
                  </Notice>
                ) : (
                  <Notice key={v.id} kind="warn">
                    <AlertTriangle size={17} /> Для «{v.title || v.model}» совместимость не подтверждена
                  </Notice>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      <section className="card section" id="offers" style={{ scrollMarginTop: 140 }}>
        <div className="card-title">
          <h2>{t("part.offers")}</h2>
          <span className="muted small">
            {inStock.length} из {p.offers.length} в наличии
          </span>
        </div>
        {p.offers.length === 0 ? (
          <Empty>Пока ни один магазин не предлагает эту деталь. Посмотрите аналоги ниже.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead>
                <tr>
                  <th>Магазин</th>
                  <th>Условия</th>
                  <th className="num">Наличие</th>
                  <th className="num">{t("common.price")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.offers.map((o) => (
                  <OfferRow key={o.offer_id} offer={o} part={p} best={o.available > 0 && o.price === bestPrice && inStock.length > 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Характеристики</h2>
          <dl className="specs">
            {oem && (
              <>
                <dt>Каталожный номер</dt>
                <dd className="mono">{oem.number}</dd>
              </>
            )}
            {Object.entries(p.specs).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {p.description && (
            <p className="small muted" style={{ marginTop: 14 }}>
              {p.description}
            </p>
          )}
        </section>

        <section className="card">
          <h2>{t("part.compat")}</h2>
          {p.compatibility.length === 0 ? (
            <Notice kind="warn">Подтверждённых данных о совместимости пока нет — уточните у продавца.</Notice>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {p.compatibility.map((c) => (
                <Link key={c.id} to={`/search?model_id=${c.model_id}`} className="cat" style={{ padding: 10 }}>
                  <span className="pic" style={{ width: 40, height: 40 }}>
                    <Check size={20} />
                  </span>
                  <span>
                    <b>
                      {c.model}
                      {c.modification && `, ${c.modification}`} {yearsText(c.year_from, c.year_to)}
                    </b>
                    <span>Источник: {c.source}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {p.analogs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>{t("part.analogs")}</h2>
              <p>Взаимозаменяемость подтверждена по каталогам производителей</p>
            </div>
          </div>
          <div className="product-grid">
            {p.analogs.map((a) => (
              <ProductCard key={a.id} part={a} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
