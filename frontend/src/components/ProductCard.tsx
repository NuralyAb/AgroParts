import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { money } from "../format";
import type { PartBrief } from "../types";
import { CategoryIcon } from "./icons";

/** Рендер 3D-модели (прозрачный PNG из media/parts) вписываем целиком, фото — обрезаем по кадру. */
export const isRender = (url: string) => url.startsWith("/api/media/parts/") && url.endsWith(".png");

export function PartImage({ part, size = 44 }: { part: Pick<PartBrief, "image_url" | "name" | "category">; size?: number }) {
  return part.image_url ? (
    <img src={part.image_url} alt={part.name} loading="lazy" className={isRender(part.image_url) ? "render" : undefined} />
  ) : (
    <div className="ph">
      <CategoryIcon name={part.category} size={size} />
    </div>
  );
}

export default function ProductCard({ part }: { part: PartBrief }) {
  const s = part.summary;
  const inStock = s.in_stock_offers > 0;
  return (
    <Link to={`/parts/${part.id}`} className="product">
      <div className="media">
        <PartImage part={part} />
        {part.category && <span className="cat-tag">{part.category}</span>}
      </div>
      <div className="body">
        <div className="name">{part.name}</div>
        <div className="nums">{part.numbers.slice(0, 2).join(" · ")}</div>
        <div className="foot">
          <div>
            {inStock ? (
              <div className="price">
                <small>от</small>
                {money(s.min_price)}
              </div>
            ) : (
              <div className="price" style={{ color: "var(--faint)", fontSize: 15 }}>
                {s.offers ? "Нет в наличии" : "Нет предложений"}
              </div>
            )}
            <div className={`avail ${inStock ? "" : "off"}`}>
              <span className={`dot ${inStock ? "" : "off"}`} />
              {inStock ? `в ${s.in_stock_offers} ${plural(s.in_stock_offers, "магазине", "магазинах", "магазинах")}` : "сообщим о поступлении"}
            </div>
          </div>
          <span className="go" aria-hidden>
            <ArrowRight size={17} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function ProductGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" style={{ aspectRatio: "3 / 4" }} />
      ))}
    </div>
  );
}
