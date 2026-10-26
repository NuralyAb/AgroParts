import { Heart, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { useFetch } from "../api";
import ProductCard, { ProductGridSkeleton } from "../components/ProductCard";
import { Empty, ErrorBox } from "../components/ui";
import type { PartBrief } from "../types";

export default function Favorites() {
  const fav = useFetch<{ parts: PartBrief[]; shops: { id: number; name: string; address: string; phone: string }[] }>("/favorites");
  return (
    <>
      <h1>Избранное</h1>
      <ErrorBox error={fav.error} onRetry={fav.reload} />
      {!fav.data ? (
        <ProductGridSkeleton n={4} />
      ) : fav.data.parts.length === 0 ? (
        <div className="card">
          <Empty>
            <Heart size={40} />
            <div>
              Сохраняйте детали сердечком на странице товара. <Link to="/search">Перейти в каталог</Link>
            </div>
          </Empty>
        </div>
      ) : (
        <div className="product-grid">
          {fav.data.parts.map((p) => (
            <ProductCard key={p.id} part={p} />
          ))}
        </div>
      )}
      {!!fav.data?.shops.length && (
        <section className="section">
          <h2>Магазины</h2>
          <div className="grid grid-3">
            {fav.data.shops.map((s) => (
              <div key={s.id} className="cat">
                <span className="pic">
                  <Store size={24} />
                </span>
                <span>
                  <b>{s.name}</b>
                  <span>
                    {s.address} · {s.phone}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
