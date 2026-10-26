import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { money } from "../format";
import type { SearchResponse } from "../types";
import MachineCanvas, { type Hotspot } from "./MachineCanvas";
import { PALETTES, type MachineKind, type Palette } from "./models";

interface Spot {
  q: string; // номер детали в каталоге — по нему подтягиваем карточку и цену
  label: string;
  position: [number, number, number];
}

interface Showcase {
  id: string;
  title: string;
  kind: MachineKind;
  palette: Palette;
  spots: Spot[];
}

export const SHOWCASES: Showcase[] = [
  {
    id: "don",
    title: "Дон-1500Б",
    kind: "combine",
    palette: PALETTES.red,
    spots: [
      { q: "4HB-4330", label: "Ремень привода жатки", position: [2.5, 1.72, 0.86] },
      { q: "180205", label: "Подшипник битера", position: [0.2, 2.4, 1.38] },
      { q: "238-1017010", label: "Фильтр масляный", position: [-1.95, 3.7, 1.08] },
      { q: "ЖНУ-6-01.050", label: "Нож жатки", position: [4.81, 0.42, 2.4] },
    ],
  },
  {
    id: "k701",
    title: "Кировец К-701",
    kind: "articulated",
    palette: PALETTES.yellow,
    spots: [
      { q: "238-1017010", label: "Фильтр масляный", position: [-1.3, 1.95, 0.7] },
      { q: "4001.3771-48", label: "Генератор 28 В", position: [-0.5, 1.6, 0.7] },
      { q: "180306", label: "Подшипник 180306", position: [-1.25, 0.9, 1.42] },
    ],
  },
  {
    id: "mtz",
    title: "Беларус-82.1",
    kind: "tractor",
    palette: PALETTES.red,
    spots: [
      { q: "240-1404010", label: "Фильтр масляный Д-243", position: [1.0, 1.5, 0.5] },
      { q: "НШ-32", label: "Насос НШ-32", position: [0.35, 0.95, 0.38] },
      { q: "180205", label: "Подшипник 180205", position: [1.55, 0.55, 0.98] },
    ],
  },
];

/** 3D-витрина на главной: модель на подиуме, точки на деталях с ценой из каталога. */
export default function HeroShowcase() {
  const [active, setActive] = useState(SHOWCASES[0]);
  const [spots, setSpots] = useState<Hotspot[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSpots([]);
    Promise.all(
      active.spots.map(async (s): Promise<Hotspot> => {
        try {
          const r = await api<SearchResponse>(`/catalog/search${qs({ q: s.q, limit: 1 })}`);
          const p = r.items[0];
          return {
            position: s.position,
            label: s.label,
            price: p?.summary.min_price ? `от ${money(p.summary.min_price)}` : p ? "нет в наличии" : null,
            href: p ? `/parts/${p.id}` : `/search?q=${encodeURIComponent(s.q)}`,
          };
        } catch {
          return { position: s.position, label: s.label, href: `/search?q=${encodeURIComponent(s.q)}` };
        }
      }),
    ).then((list) => !cancelled && setSpots(list));
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <MachineCanvas key={active.id} kind={active.kind} palette={active.palette} hotspots={spots} podium className="hero-canvas" autoRotateSpeed={0.7} margin={active.kind === "combine" ? 1.32 : 1.6}>
      <div className="stage-tabs" role="tablist" aria-label="Модель техники">
        {SHOWCASES.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === active.id} className={s.id === active.id ? "on" : ""} onClick={() => setActive(s)}>
            {s.title}
          </button>
        ))}
      </div>
      <div className="stage-hint">Покрутите модель и нажмите на точку детали</div>
    </MachineCanvas>
  );
}
