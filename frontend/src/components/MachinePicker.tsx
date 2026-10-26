import type { Brand } from "../types";

export interface MachineValue {
  brandId: number | null;
  modelId: number | null;
  modificationId: number | null;
}

export const emptyMachine: MachineValue = { brandId: null, modelId: null, modificationId: null };

export function findModel(brands: Brand[] | null, modelId: number | null) {
  for (const b of brands ?? []) {
    const m = b.models.find((x) => x.id === modelId);
    if (m) return { brand: b, model: m };
  }
  return null;
}

/** Выбор техники: марка → модель → модификация. */
export default function MachinePicker({
  brands,
  value,
  onChange,
  withModification = true,
}: {
  brands: Brand[];
  value: MachineValue;
  onChange: (v: MachineValue) => void;
  withModification?: boolean;
}) {
  const brand = brands.find((b) => b.id === value.brandId);
  const model = brand?.models.find((m) => m.id === value.modelId);
  const num = (s: string) => (s ? Number(s) : null);
  return (
    <>
      <label className="field">
        <span>Марка</span>
        <select value={value.brandId ?? ""} onChange={(e) => onChange({ ...emptyMachine, brandId: num(e.target.value) })}>
          <option value="">Все марки</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Модель</span>
        <select
          value={value.modelId ?? ""}
          disabled={!brand}
          onChange={(e) => onChange({ ...value, modelId: num(e.target.value), modificationId: null })}
        >
          <option value="">{brand ? "Все модели" : "Сначала марка"}</option>
          {brand?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {withModification && model && model.modifications.length > 0 && (
        <label className="field">
          <span>Модификация</span>
          <select
            value={value.modificationId ?? ""}
            onChange={(e) => onChange({ ...value, modificationId: num(e.target.value) })}
          >
            <option value="">Любая</option>
            {model.modifications.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.year_from ? ` (${m.year_from}–${m.year_to ?? "н.в."})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
