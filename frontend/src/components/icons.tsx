import {
  CircleDot, Cog, Droplets, Filter, Flame, Infinity as Loop, Package, Scissors, Tractor, Wheat, Zap, type LucideIcon,
} from "lucide-react";

const BY_CATEGORY: Record<string, LucideIcon> = {
  Ремни: Loop,
  Подшипники: CircleDot,
  Фильтры: Filter,
  Жатка: Scissors,
  Гидравлика: Droplets,
  "Ходовая часть": Cog,
  Двигатель: Flame,
  Электрика: Zap,
};

export function CategoryIcon({ name, size = 18 }: { name: string | null | undefined; size?: number }) {
  const Icon = (name && BY_CATEGORY[name]) || Package;
  return <Icon size={size} strokeWidth={2} />;
}

export function MachineIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const Icon = kind === "combine" ? Wheat : Tractor;
  return <Icon size={size} strokeWidth={2} />;
}

export const KIND_LABEL: Record<string, string> = { combine: "Комбайн", tractor: "Трактор", seeder: "Сеялка", other: "Техника" };
