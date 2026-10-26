import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, errorText, useFetch } from "../../api";
import { money } from "../../format";
import { ErrorBox, Spinner } from "../../components/ui";
import type { ShopOffer } from "../../types";
import type { ShopTabProps } from "./ShopCabinet";

interface Label {
  offer_id: number;
  sku: string;
  title: string;
  article: string | null;
  price: number;
  bins: string[];
  qr: string;
}

/** QR-этикетки для магазинов без штрихкодов: SKU, артикул, ячейка, цена. */
export default function ShopLabels({ shop }: ShopTabProps) {
  const offers = useFetch<ShopOffer[]>(`/shops/${shop.id}/offers?limit=500`);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const make = async () => {
    setError(null);
    try {
      setLabels(await api<Label[]>(`/shops/${shop.id}/labels?ids=${[...picked].join(",")}`));
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (labels) {
    return (
      <>
        <div className="row no-print" style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Печать
          </button>
          <button className="btn" onClick={() => setLabels(null)}>
            ← Назад к выбору
          </button>
        </div>
        <div className="labels">
          {labels.map((l) => (
            <div key={l.offer_id} className="label">
              <QRCodeSVG value={l.qr} size={72} />
              <div style={{ minWidth: 0 }}>
                <div className="sku">{l.sku}</div>
                <div className="small">{l.title}</div>
                {l.article && <div className="small mono">{l.article}</div>}
                <div className="small">
                  {l.bins.join(", ")} · <strong>{money(l.price)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <span className="muted small">Отметьте товары и распечатайте этикетки на полки и упаковку.</span>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setPicked(new Set(offers.data?.map((o) => o.id)))}>
            Выбрать все
          </button>
          <button className="btn btn-primary" disabled={picked.size === 0} onClick={make}>
            Этикетки ({picked.size})
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {offers.loading && !offers.data ? (
        <Spinner />
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <tbody>
              {offers.data?.map((o) => (
                <tr key={o.id} onClick={() => toggle(o.id)} style={{ cursor: "pointer" }}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" checked={picked.has(o.id)} readOnly />
                  </td>
                  <td>
                    {o.title}
                    <div className="small muted mono">{o.sku}</div>
                  </td>
                  <td className="small mono">{o.stocks.map((s) => s.bin_location).filter(Boolean).join(", ")}</td>
                  <td className="num">{money(o.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
