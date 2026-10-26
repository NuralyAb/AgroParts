import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { money, pcs } from "../format";
import { useI18n, type TKey } from "../i18n";
import type { OrderStatus, PartBrief } from "../types";
import { PartImage } from "./ProductCard";

export const Spinner = () => <div className="spinner" aria-label="Загрузка" />;

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice notice-error row-between">
      <span>{error}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "ok" | "warn" | "error"; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "badge-yellow",
  confirmed: "badge-blue",
  ready: "badge-green",
  issued: "",
  cancelled: "badge-red",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS_COLOR[status]}`}>{t(`status.${status}` as TKey)}</span>;
}

export const CHANNEL_LABEL = { marketplace: "Маркетплейс", phone: "По телефону", pos: "Касса" } as const;

export function StockModeBadge({ mode }: { mode: "tracked" | "manual" }) {
  return mode === "tracked" ? (
    <span className="badge badge-green" title="Остатки ведутся в учётной системе магазина и обновляются автоматически">
      ✓ Наличие гарантировано
    </span>
  ) : (
    <span className="badge badge-yellow" title="Магазин обновляет остатки вручную — наличие подтвердит продавец">
      Наличие подтвердит продавец
    </span>
  );
}

export function AvailabilityBadge({ available }: { available: number }) {
  const { t } = useI18n();
  return available > 0 ? (
    <span className="badge badge-green">
      {t("common.inStock")}: {pcs(available)}
    </span>
  ) : (
    <span className="badge">{t("common.outOfStock")}</span>
  );
}

export function PartRow({ part, extra }: { part: PartBrief; extra?: ReactNode }) {
  const s = part.summary;
  return (
    <div className="part-row">
      <div className="part-thumb">
        <PartImage part={part} size={26} />
      </div>
      <div className="info">
        <Link className="name" to={`/parts/${part.id}`}>
          {part.name}
        </Link>
        <div className="small muted mono">{part.numbers.join(" · ")}</div>
        {extra}
      </div>
      <div className="price">
        {s.in_stock_offers > 0 ? (
          <>
            <div className="price-big">от {money(s.min_price)}</div>
            <div className="small muted">
              в {s.in_stock_offers} маг. · {pcs(s.available)}
            </div>
          </>
        ) : (
          <span className="badge">{s.offers ? "Нет в наличии" : "Нет предложений"}</span>
        )}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="card-title">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" className={t.id === value ? "on" : ""} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count ? <span className="badge badge-yellow count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
