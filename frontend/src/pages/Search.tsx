import { Box, SearchX, X } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { qs, useFetch } from "../api";
import { useAuth } from "../auth";
import MachinePicker, { findModel } from "../components/MachinePicker";
import ProductCard, { plural, ProductGridSkeleton } from "../components/ProductCard";
import { Empty, ErrorBox, Notice } from "../components/ui";
import type { Brand, SearchResponse, Vehicle } from "../types";

const PAGE = 24;
const SORTS = [
  ["relevance", "По релевантности"],
  ["available", "Сначала в наличии"],
  ["price_asc", "Сначала дешевле"],
  ["price_desc", "Сначала дороже"],
] as const;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const q = params.get("q") ?? "";
  const vehicleId = params.get("vehicle");
  const categoryId = params.get("category_id");
  const inStock = params.get("in_stock") === "1";
  const sort = params.get("sort") ?? (q ? "relevance" : "available");
  const limit = Number(params.get("limit") ?? PAGE);

  const brands = useFetch<Brand[]>("/catalog/brands");
  const garage = useFetch<Vehicle[]>(user ? "/garage" : null);
  const vehicle = garage.data?.find((v) => String(v.id) === vehicleId) ?? null;
  const modelId = vehicle?.model_id ?? (params.get("model_id") ? Number(params.get("model_id")) : null);
  const modificationId = vehicle ? vehicle.modification_id : params.get("modification_id") ? Number(params.get("modification_id")) : null;

  const waitingVehicle = !!vehicleId && !vehicle && (garage.loading || !user);
  const result = useFetch<SearchResponse>(
    waitingVehicle
      ? null
      : `/catalog/search${qs({ q, model_id: modelId, modification_id: modificationId, year: vehicle?.year, category_id: categoryId, in_stock: inStock, sort, limit })}`,
  );

  const machine = useMemo(() => {
    const found = findModel(brands.data, modelId);
    return { brandId: found?.brand.id ?? null, modelId, modificationId };
  }, [brands.data, modelId, modificationId]);
  const modelTitle = useMemo(() => {
    const f = findModel(brands.data, modelId);
    return f ? `${f.brand.name} ${f.model.name}` : null;
  }, [brands.data, modelId]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("limit" in patch)) next.delete("limit");
    setParams(next, { replace: true });
  };

  const data = result.data;
  const facets = data?.facets.categories ?? [];
  const activeCategory = facets.find((f) => String(f.id) === categoryId);
  const title = q ? `«${q}»` : vehicle ? vehicle.title || vehicle.model : modelTitle ?? activeCategory?.name ?? "Все запчасти";

  return (
    <div className="layout-sidebar">
      <aside className="filters">
        {user && garage.data && garage.data.length > 0 && (
          <div className="filter-block">
            <h4>Моя техника</h4>
            <select value={vehicleId ?? ""} onChange={(e) => update({ vehicle: e.target.value || null, model_id: null, modification_id: null })}>
              <option value="">— не выбрана —</option>
              {garage.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title || v.model}
                  {v.year ? `, ${v.year}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {!vehicleId && brands.data && (
          <div className="filter-block stack" style={{ gap: 8 }}>
            <h4 style={{ margin: 0 }}>Техника</h4>
            <MachinePicker
              brands={brands.data}
              value={machine}
              onChange={(v) => update({ model_id: v.modelId ? String(v.modelId) : null, modification_id: v.modificationId ? String(v.modificationId) : null })}
            />
          </div>
        )}
        <div className="filter-block">
          <label className="switch">
            Только в наличии
            <input type="checkbox" checked={inStock} onChange={(e) => update({ in_stock: e.target.checked ? "1" : null })} />
          </label>
        </div>
        {facets.length > 0 && (
          <div className="filter-block">
            <h4>Категории</h4>
            <button className={`facet ${!categoryId ? "on" : ""}`} onClick={() => update({ category_id: null })}>
              Все <span className="n">{facets.reduce((s, f) => s + f.count, 0)}</span>
            </button>
            {facets.map((f) => (
              <button key={f.id} className={`facet ${String(f.id) === categoryId ? "on" : ""}`} onClick={() => update({ category_id: String(f.id) })}>
                {f.name} <span className="n">{f.count}</span>
              </button>
            ))}
          </div>
        )}
        {(modelId || vehicleId) && <p className="small muted">Показываем только детали с проверенной совместимостью.</p>}
      </aside>

      <section>
        <div className="results-bar">
          <div>
            <h1>{title}</h1>
            {data && (
              <div className="count">
                {data.total} {plural(data.total, "запчасть", "запчасти", "запчастей")}
              </div>
            )}
          </div>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Сортировка">
            {SORTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {(modelId || categoryId || inStock || vehicleId) && (
          <div className="active-filters">
            {vehicle && (
              <button className="chip" onClick={() => update({ vehicle: null })}>
                {vehicle.title || vehicle.model} <X size={14} />
              </button>
            )}
            {!vehicle && modelTitle && (
              <button className="chip" onClick={() => update({ model_id: null, modification_id: null })}>
                {modelTitle} <X size={14} />
              </button>
            )}
            {activeCategory && (
              <button className="chip" onClick={() => update({ category_id: null })}>
                {activeCategory.name} <X size={14} />
              </button>
            )}
            {inStock && (
              <button className="chip" onClick={() => update({ in_stock: null })}>
                В наличии <X size={14} />
              </button>
            )}
          </div>
        )}

        {data?.corrected_query && (
          <div style={{ marginBottom: 14 }}>
            <Notice kind="info">
              Похоже, раскладка была английской — показываем результаты для «<b>{data.corrected_query}</b>».
            </Notice>
          </div>
        )}
        {vehicleId && !user && <ErrorBox error="Войдите, чтобы подбирать детали по своей технике" />}
        <ErrorBox error={result.error} onRetry={result.reload} />

        {!data ? (
          <ProductGridSkeleton n={8} />
        ) : data.items.length === 0 ? (
          <div className="card">
            <Empty>
              <SearchX size={40} />
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>Ничего не нашли</div>
              Проверьте номер детали или попробуйте{" "}
              <Link to="/catalog3d">
                найти её на 3D-модели <Box size={14} style={{ verticalAlign: "-2px" }} />
              </Link>
              .
            </Empty>
          </div>
        ) : (
          <>
            <div className="product-grid cols-3" style={{ opacity: result.loading ? 0.6 : 1, transition: "opacity 0.15s" }}>
              {data.items.map((p) => (
                <ProductCard key={p.id} part={p} />
              ))}
            </div>
            {data.total > data.items.length && (
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <button className="btn btn-lg" onClick={() => update({ limit: String(limit + PAGE) })}>
                  Показать ещё ({data.total - data.items.length})
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
