import { useState } from "react";
import { useFetch } from "../../api";
import { money } from "../../format";
import { useI18n, type TKey } from "../../i18n";
import { CHANNEL_LABEL, Empty, ErrorBox, Spinner } from "../../components/ui";
import type { ShopTabProps } from "./ShopCabinet";

interface Stats {
  period_days: number;
  by_channel: Record<string, { orders: number; revenue: number }>;
  revenue: number;
  orders_by_status: Record<string, number>;
  top_products: { title: string; sku: string; qty: number; revenue: number }[];
  stock: { offers: number; on_hand: number; reserved: number; value: number };
  offers_need_review: number;
}

export default function ShopStats({ shop }: ShopTabProps) {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const stats = useFetch<Stats>(`/shops/${shop.id}/stats?days=${days}`);
  if (stats.loading && !stats.data) return <Spinner />;
  if (!stats.data) return <ErrorBox error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  const marketplaceShare = s.revenue ? Math.round(((s.by_channel.marketplace?.revenue ?? 0) / s.revenue) * 100) : 0;

  return (
    <>
      <div className="chips" style={{ marginBottom: 12 }}>
        {[7, 30, 90, 365].map((d) => (
          <button key={d} className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>
            {d} дн.
          </button>
        ))}
      </div>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="label">Выручка</div>
          <div className="value">{money(s.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="label">Доля маркетплейса</div>
          <div className="value">{marketplaceShare}%</div>
        </div>
        <div className="kpi">
          <div className="label">Остатки, шт. / резерв</div>
          <div className="value">
            {s.stock.on_hand} / {s.stock.reserved}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Стоимость склада</div>
          <div className="value">{money(s.stock.value)}</div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card" style={{ margin: 0 }}>
          <h3>Продажи по каналам</h3>
          <table>
            <tbody>
              {(["marketplace", "phone", "pos"] as const).map((ch) => (
                <tr key={ch}>
                  <td>{CHANNEL_LABEL[ch]}</td>
                  <td className="num">{s.by_channel[ch]?.orders ?? 0} зак.</td>
                  <td className="num">{money(s.by_channel[ch]?.revenue ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>Заказы по статусам (всё время)</h3>
          <div className="chips">
            {Object.entries(s.orders_by_status).map(([st, n]) => (
              <span key={st} className="badge">
                {t(`status.${st}` as TKey)}: {n}
              </span>
            ))}
          </div>
          {s.offers_need_review > 0 && (
            <p className="small muted" style={{ marginTop: 12 }}>
              {s.offers_need_review} товаров ждут сопоставления с каталогом и пока не видны на маркетплейсе.
            </p>
          )}
        </section>
        <section className="card" style={{ margin: 0 }}>
          <h3>Популярные товары</h3>
          {s.top_products.length === 0 ? (
            <Empty>Продаж за период нет</Empty>
          ) : (
            <table>
              <tbody>
                {s.top_products.map((p) => (
                  <tr key={p.sku}>
                    <td>
                      {p.title}
                      <div className="small muted mono">{p.sku}</div>
                    </td>
                    <td className="num">{p.qty} шт.</td>
                    <td className="num">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
