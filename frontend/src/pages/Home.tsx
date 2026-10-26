import { ArrowRight, Box, CheckCircle2, MousePointerClick, PackageCheck, Search as SearchIcon, Store } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "../api";
import { useAuth } from "../auth";
import { CategoryIcon, KIND_LABEL, MachineIcon } from "../components/icons";
import ProductCard, { ProductGridSkeleton } from "../components/ProductCard";
import SearchBox from "../components/SearchBox";
import type { Brand, Category, Model3DBrief, SearchResponse, Vehicle } from "../types";

// three.js грузится отдельным чанком, текст и поиск показываются сразу.
const HeroShowcase = lazy(() => import("../three/HeroShowcase"));
const MachineCanvas = lazy(() => import("../three/MachineCanvas"));

/** Какую 3D-модель и раскраску показать для модели техники из каталога. */
function machineLook(name: string, kind: string): { kind: "combine" | "tractor" | "articulated"; palette: "red" | "yellow" | "green" | "blue" } {
  if (/к-7\d\d|кировец/i.test(name)) return { kind: "articulated", palette: "yellow" };
  if (kind === "combine") return { kind: "combine", palette: "red" };
  return { kind: "tractor", palette: "red" };
}

const EXAMPLES = ["ремень жатки", "180205", "4HB-4330", "фильтр масляный ЯМЗ", "НШ-32"];

export default function Home() {
  const { user } = useAuth();
  const brands = useFetch<Brand[]>("/catalog/brands");
  const categories = useFetch<Category[]>("/catalog/categories");
  const models3d = useFetch<Model3DBrief[]>("/catalog3d/models");
  const popular = useFetch<SearchResponse>("/catalog/search?sort=available&in_stock=true&limit=8");
  const shops = useFetch<unknown[]>("/shops");
  const garage = useFetch<Vehicle[]>(user ? "/garage" : null);

  const machines = (brands.data ?? []).flatMap((b) => b.models.map((m) => ({ ...m, brand: b.name })));
  const partsTotal = (categories.data ?? []).reduce((s, c) => s + c.count, 0);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
        <div className="eyebrow" style={{ color: "var(--accent)", marginBottom: 12 }}>
          Маркетплейс запчастей · Костанайская область
        </div>
        <h1>
          Нужная запчасть — <em>за минуту</em>, а не за день обзвона
        </h1>
        <p className="lead">Цены и реальное наличие во всех магазинах Костаная. Забронируйте деталь и заберите в удобной точке.</p>
        <SearchBox big autoFocus />
        <div className="quick">
          Например:
          {EXAMPLES.map((s) => (
            <Link key={s} to={`/search?q=${encodeURIComponent(s)}`}>
              {s}
            </Link>
          ))}
        </div>
        <div className="hero-stats">
          <div>
            <b>{shops.data?.length ?? "—"}</b>
            <span>магазинов онлайн</span>
          </div>
          <div>
            <b>{partsTotal || "—"}</b>
            <span>запчастей в каталоге</span>
          </div>
          <div>
            <b>{machines.length || "—"}</b>
            <span>моделей техники</span>
          </div>
        </div>
        </div>
        <div className="hero-stage">
          <Suspense fallback={<div className="hero-canvas stage-loading" />}>
            <HeroShowcase />
          </Suspense>
        </div>
      </section>

      {user && garage.data && garage.data.length > 0 && (
        <section className="card row-between" style={{ marginTop: 20 }}>
          <div className="row">
            <span className="cat" style={{ padding: 0, border: 0, boxShadow: "none" }}>
              <span className="pic" style={{ width: 44, height: 44 }}>
                <MachineIcon kind={garage.data[0].kind} size={22} />
              </span>
            </span>
            <div>
              <b>Подбор для вашей техники</b>
              <div className="small muted">Только детали с проверенной совместимостью</div>
            </div>
          </div>
          <div className="chips">
            {garage.data.map((v) => (
              <Link key={v.id} className="chip" to={`/search?vehicle=${v.id}`}>
                {v.title || v.model}
                {v.year ? `, ${v.year}` : ""} <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Подбор по технике</h2>
            <p>Покажем только детали с подтверждённой совместимостью</p>
          </div>
          <Link to="/catalog3d" className="btn btn-sm">
            <Box size={15} /> 3D-каталог
          </Link>
        </div>
        <div className="machine-grid">
          {machines.map((m) => {
            const has3d = models3d.data?.some((x) => x.machine_model_id === m.id);
            const look = machineLook(m.name, m.kind);
            return (
              <Link key={m.id} to={`/search?model_id=${m.id}`} className="machine">
                <Suspense fallback={null}>
                  <MachineCanvas
                    kind={look.kind}
                    palette={look.palette}
                    interactive={false}
                    shadows={false}
                    autoRotateSpeed={1.4}
                    className="machine-canvas"
                  />
                </Suspense>
                {has3d && <span className="tag3d">3D-каталог</span>}
                <div className="meta">
                  <div className="kind">{KIND_LABEL[m.kind]}</div>
                  <div className="name">{m.name}</div>
                  <div className="brand">{m.brand}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Есть в наличии сейчас</h2>
            <p>Детали, которые можно забрать сегодня</p>
          </div>
          <Link to="/search?in_stock=1" className="btn btn-sm">
            Все запчасти <ArrowRight size={15} />
          </Link>
        </div>
        {popular.data ? (
          <div className="product-grid">
            {popular.data.items.map((p) => (
              <ProductCard key={p.id} part={p} />
            ))}
          </div>
        ) : (
          <ProductGridSkeleton />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Категории</h2>
        </div>
        <div className="cat-grid">
          {categories.data?.map((c) => (
            <Link key={c.id} to={`/search?category_id=${c.id}`} className="cat">
              <span className="pic">{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <CategoryIcon name={c.name} size={26} />}</span>
              <span>
                <b>{c.name}</b>
                <span>{c.count} поз.</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section promo3d">
        <div>
          <div className="eyebrow" style={{ color: "var(--accent)" }}>
            Не знаете номер детали?
          </div>
          <h2>Найдите её прямо на 3D-модели техники</h2>
          <p>Выберите свой комбайн или трактор, откройте нужный узел и нажмите на деталь.</p>
          <ul>
            <li>
              <CheckCircle2 size={18} /> Каталожный номер и характеристики
            </li>
            <li>
              <CheckCircle2 size={18} /> Проверенная совместимость и аналоги
            </li>
            <li>
              <CheckCircle2 size={18} /> Цены и наличие в магазинах Костаная
            </li>
          </ul>
          {models3d.data?.[0] && (
            <Link to={`/catalog3d/${models3d.data[0].id}`} className="btn btn-accent btn-lg">
              Открыть {models3d.data[0].title} <ArrowRight size={18} />
            </Link>
          )}
        </div>
        <div className="art">
          <Suspense fallback={null}>
            <MachineCanvas kind="combine" palette="red" podium autoRotateSpeed={-0.5} className="promo-canvas" />
          </Suspense>
        </div>
      </section>

      <section className="section steps">
        {[
          [SearchIcon, "Найдите деталь", "По названию, номеру OEM, артикулу, модели техники или на 3D-модели."],
          [Store, "Сравните магазины", "Цены и остатки всех магазинов на одной странице, с временем обновления."],
          [PackageCheck, "Заберите по коду", "Магазин откладывает товар — получите его по коду или QR."],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof SearchIcon;
          return (
            <div key={title as string} className="step">
              <span className="n">
                <I size={20} />
              </span>
              <div>
                <b>{title as string}</b>
                <p>{text as string}</p>
              </div>
            </div>
          );
        })}
      </section>

      {!user && (
        <section className="section card row-between" style={{ padding: 24 }}>
          <div className="row">
            <MousePointerClick size={28} color="var(--brand)" />
            <div>
              <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>У вас магазин запчастей?</b>
              <div className="muted">Подключитесь бесплатно: склад, касса и CRM — и покупатели со всей области.</div>
            </div>
          </div>
          <Link to="/shop" className="btn btn-primary">
            Подключить магазин
          </Link>
        </section>
      )}
    </>
  );
}
