import { useState } from "react";
import { qs, useFetch } from "../../api";
import { money } from "../../format";
import type { ShopOffer } from "../../types";

/** Поиск товара своего магазина по названию, SKU или артикулу. */
export default function OfferPicker({
  shopId,
  onPick,
  onlyAvailable = false,
  reloadKey = 0,
}: {
  shopId: number;
  onPick: (o: ShopOffer) => void;
  onlyAvailable?: boolean;
  reloadKey?: number;
}) {
  const [q, setQ] = useState("");
  const offers = useFetch<ShopOffer[]>(`/shops/${shopId}/offers${qs({ q, only_available: onlyAvailable, limit: 30, _: reloadKey })}`);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, SKU или артикул" autoFocus />
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
        <table>
          <tbody>
            {offers.data?.map((o) => (
              <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => onPick(o)}>
                <td>
                  <div>{o.title}</div>
                  <div className="small muted mono">
                    {o.sku}
                    {o.article && ` · ${o.article}`}
                  </div>
                </td>
                <td className="num">
                  <span className={o.available > 0 ? "" : "muted"}>{o.available} шт.</span>
                  {o.reserved > 0 && <div className="small muted">резерв {o.reserved}</div>}
                </td>
                <td className="num">{money(o.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {offers.data?.length === 0 && <div className="empty">Ничего не найдено</div>}
      </div>
    </div>
  );
}
