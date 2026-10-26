import { useState, type FormEvent } from "react";
import { api, errorText } from "../../api";
import { ErrorBox, Notice } from "../../components/ui";
import type { ImportReport } from "../../types";
import type { ShopTabProps } from "./ShopCabinet";

export default function ShopImport({ shop }: ShopTabProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"manual" | "tracked">("manual");
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("stock_mode", mode);
    form.append("dry_run", String(dryRun));
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await api<ImportReport>(`/shops/${shop.id}/import`, { form }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <form className="card stack" onSubmit={submit} style={{ margin: 0 }}>
        <h3>Загрузка прайса и остатков</h3>
        <p className="small muted">
          Файл Excel (.xlsx) или CSV. Нужны колонки «Наименование» или «Артикул» и «Цена»; по желанию «Количество», «Производитель»,
          «Ячейка», «Склад», «Код». Товары обновляются по коду или артикулу, новые — создаются.
        </p>
        <a className="btn btn-sm" href="/api/integrations/import-template.csv" download style={{ alignSelf: "flex-start" }}>
          Скачать шаблон
        </a>
        <input type="file" accept=".xlsx,.xlsm,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="field">
          <span>Как ведёте остатки</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "manual" | "tracked")}>
            <option value="manual">Только этим файлом — наличие подтверждаю при заказе</option>
            <option value="tracked">Файл выгружен из учётной системы — остатки точные</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Сначала проверить, ничего не меняя
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={!file || busy}>
          {busy ? "Обработка…" : dryRun ? "Проверить файл" : "Загрузить"}
        </button>
      </form>

      <section className="card" style={{ margin: 0 }}>
        <h3>Результат</h3>
        {!report ? (
          <p className="muted small">Здесь появится отчёт: сколько товаров создано, обновлено, сопоставлено с каталогом и какие строки с ошибками.</p>
        ) : (
          <div className="stack">
            {report.dry_run && <Notice kind="info">Проверка: изменения не сохранены. Снимите галочку и загрузите снова.</Notice>}
            <div className="grid grid-3">
              {[
                ["Строк", report.rows],
                ["Создано", report.created],
                ["Обновлено", report.updated],
                ["В каталоге", report.matched],
                ["На сопоставлении", report.review],
                ["Ошибок", report.errors.length],
              ].map(([label, value]) => (
                <div key={label} className="kpi">
                  <div className="label">{label}</div>
                  <div className="value">{value}</div>
                </div>
              ))}
            </div>
            {report.review > 0 && (
              <p className="small muted">
                Товары «на сопоставлении» видны в вашем учёте и кассе; на маркетплейсе появятся после привязки к единому каталогу.
              </p>
            )}
            {report.errors.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e) => (
                    <tr key={e.row}>
                      <td>{e.row}</td>
                      <td>{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
