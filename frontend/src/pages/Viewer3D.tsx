import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Grid, Html, OrbitControls } from "@react-three/drei";
import { Studio } from "../three/MachineCanvas";
import * as THREE from "three";
import { RoundedBoxGeometry, type OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useFetch } from "../api";
import { useCart } from "../cart";
import { ago, money, pcs } from "../format";
import { ErrorBox, Spinner, StockModeBadge } from "../components/ui";
import type { Model3D, ModelComponent, PartDetail } from "../types";

const ASSEMBLY: Record<string, string> = {
  body: "Корпус",
  engine: "Двигатель",
  transmission: "Трансмиссия и приводы",
  hydraulics: "Гидравлика",
  header: "Жатка и наклонная камера",
  chassis: "Ходовая часть",
};

const HIGHLIGHT = new THREE.Color("#e0a526");
const HOVER = new THREE.Color("#7fd18b");
const MATCH = new THREE.Color("#3b82f6");
const BLACK = new THREE.Color(0, 0, 0);

interface ViewState {
  selected: string | null;
  hovered: string | null;
  hideShell: boolean;
  explode: number;
  assembly: string | null;
  matches: Set<string>;
}

function matchesQuery(c: ModelComponent, q: string) {
  if (!q) return false;
  const s = q.toLowerCase().replace(/[\s-]/g, "");
  const hay = [c.name, c.part?.name ?? "", ...(c.part?.numbers ?? [])].join(" ").toLowerCase().replace(/[\s-]/g, "");
  return hay.includes(s);
}

type MaterialKind = "paint" | "dark" | "metal" | "rubber" | "glass";

const PRESETS: Record<Exclude<MaterialKind, "glass">, { metalness: number; roughness: number }> = {
  paint: { metalness: 0.25, roughness: 0.32 },
  dark: { metalness: 0.35, roughness: 0.55 },
  metal: { metalness: 0.85, roughness: 0.28 },
  rubber: { metalness: 0, roughness: 0.92 },
};
const RIM = new THREE.MeshStandardMaterial({ color: "#c9312a", metalness: 0.4, roughness: 0.35 });
const HUB = new THREE.MeshStandardMaterial({ color: "#a7afab", metalness: 0.85, roughness: 0.3 });

function makeMaterial(g: ModelComponent["geometry"]): THREE.MeshStandardMaterial {
  const kind = (g.material ?? "paint") as MaterialKind;
  if (kind === "glass") {
    return new THREE.MeshPhysicalMaterial({ color: g.color, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.42, envMapIntensity: 1.6 });
  }
  return new THREE.MeshStandardMaterial({ color: g.color, transparent: true, ...PRESETS[kind] });
}

/** Форма узла. Сложные формы (колесо, мотовило) собираются из нескольких мешей с общим материалом. */
function Shape({ g, mat }: { g: ModelComponent["geometry"]; mat: THREE.Material }) {
  const [a = 1, b = 1, c = 1] = g.size;
  const rounded = useMemo(
    () => (g.shape === "box" ? new RoundedBoxGeometry(a, b, c, 3, Math.min(0.12, Math.min(a, b, c) / 2.2)) : null),
    [g.shape, a, b, c],
  );
  const lugs = useMemo(() => {
    const n = a > 0.7 ? 22 : 16;
    return Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2);
  }, [a]);

  if (rounded) return <mesh geometry={rounded} material={mat} castShadow receiveShadow />;
  if (g.shape === "cylinder") {
    return (
      <mesh material={mat} castShadow receiveShadow>
        <cylinderGeometry args={[a, a, b, 40]} />
      </mesh>
    );
  }
  if (g.shape === "torus") {
    return (
      <mesh material={mat} castShadow>
        <torusGeometry args={[a, b, 16, 64]} />
      </mesh>
    );
  }
  if (g.shape === "wheel") {
    // a — радиус, b — ширина; ось колеса — Z
    const side = g.position[2] >= 0 ? 1 : -1;
    return (
      <group>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mat} castShadow>
          <cylinderGeometry args={[a * 0.97, a * 0.97, b, 48]} />
        </mesh>
        {lugs.map((ang, i) => (
          <group key={i} rotation={[0, 0, ang]}>
            {[-1, 1].map((half) => (
              <mesh key={half} position={[a * 0.985, 0, (half * b) / 4]} rotation={[half * 0.5, 0, 0]} material={mat}>
                <boxGeometry args={[a * 0.08, a * 0.1, b * 0.52]} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, 0, (side * b) / 2]} rotation={[Math.PI / 2, 0, 0]} material={RIM}>
          <cylinderGeometry args={[a * 0.6, a * 0.6, 0.04, 40]} />
        </mesh>
        <mesh position={[0, 0, (side * b) / 2 + side * 0.04]} rotation={[Math.PI / 2, 0, 0]} material={HUB}>
          <cylinderGeometry args={[a * 0.2, a * 0.24, 0.1, 24]} />
        </mesh>
      </group>
    );
  }
  if (g.shape === "reel") {
    // a — радиус, b — длина
    return (
      <group>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={HUB}>
          <cylinderGeometry args={[0.06, 0.06, b + 0.2, 16]} />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => (
          <group key={i} rotation={[0, 0, (i / 6) * Math.PI * 2]}>
            <mesh position={[a, 0, 0]} material={mat} castShadow>
              <boxGeometry args={[0.07, 0.07, b]} />
            </mesh>
            {[b / 2 - 0.2, 0, -b / 2 + 0.2].map((z) => (
              <mesh key={z} position={[a / 2, 0, z]} material={mat}>
                <boxGeometry args={[a, 0.035, 0.035]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    );
  }
  return (
    <mesh material={mat} castShadow>
      <boxGeometry args={[a, b, c]} />
    </mesh>
  );
}

function Part3D({
  c,
  view,
  onHover,
  onSelect,
}: {
  c: ModelComponent;
  view: ViewState;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(() => makeMaterial(c.geometry), [c.geometry]);
  useEffect(() => () => mat.dispose(), [mat]);
  const baseOpacity = mat.opacity;
  const base = useMemo(() => new THREE.Vector3(...c.geometry.position), [c.geometry.position]);
  const offset = useMemo(() => new THREE.Vector3(...(c.explode.length === 3 ? c.explode : [0, 0, 0])), [c.explode]);
  const target = useMemo(() => new THREE.Vector3(), []);

  const clickable = !!c.part;
  const hidden = c.is_shell && view.hideShell;
  const dimmed = view.assembly !== null && c.assembly !== view.assembly;
  const selected = view.selected === c.key;
  const hovered = view.hovered === c.key && clickable;
  const matched = view.matches.has(c.key);

  useFrame(() => {
    if (!group.current) return;
    target.copy(base).addScaledVector(offset, view.explode);
    group.current.position.lerp(target, 0.15);
    const emissive = selected ? HIGHLIGHT : hovered ? HOVER : matched ? MATCH : null;
    mat.emissive.lerp(emissive ?? BLACK, 0.25);
    mat.emissiveIntensity = emissive ? 0.8 : 0;
    const opacity = dimmed ? 0.1 : baseOpacity;
    mat.opacity += (opacity - mat.opacity) * 0.2;
    mat.depthWrite = !dimmed && baseOpacity === 1;
  });

  if (hidden) return null;

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); // ближний объект перекрывает дальние
    if (dimmed) return;
    onHover(clickable ? c.key : null);
    document.body.style.cursor = clickable ? "pointer" : "default";
  };
  const out = () => {
    onHover(null);
    document.body.style.cursor = "default";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Кликабельны только элементы, связанные с записью технического каталога.
    if (clickable && !dimmed) onSelect(c.key);
  };

  return (
    <group
      ref={group}
      position={c.geometry.position}
      rotation={c.geometry.rotation as [number, number, number]}
      onPointerOver={over}
      onPointerOut={out}
      onClick={click}
    >
      <Shape g={c.geometry} mat={mat} />
      {hovered && !selected && (
        <Html center zIndexRange={[10, 0]}>
          <div className="tooltip3d">{c.name}</div>
        </Html>
      )}
    </group>
  );
}

/** Плавно переводит центр вращения камеры на выбранную деталь. */
function FocusRig({ point }: { point: THREE.Vector3 | null }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const focusing = useRef(false);
  useEffect(() => {
    focusing.current = !!point;
  }, [point]);
  useFrame(() => {
    if (!controls || !point || !focusing.current) return;
    controls.target.lerp(point, 0.08);
    controls.update();
    if (controls.target.distanceTo(point) < 0.02) focusing.current = false;
  });
  return null;
}

function OfferPanel({ partId }: { partId: number }) {
  const part = useFetch<PartDetail>(`/catalog/parts/${partId}`);
  const cart = useCart();
  const [added, setAdded] = useState<number | null>(null);
  if (part.loading && !part.data) return <Spinner />;
  if (!part.data) return <ErrorBox error={part.error} />;
  const p = part.data;
  const offers = p.offers.filter((o) => o.available > 0).slice(0, 4);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        {p.numbers.map((n) => (
          <span key={n.id} className="badge badge-blue mono">
            {n.kind === "oem" ? "OEM" : n.manufacturer} {n.number}
          </span>
        ))}
      </div>
      {Object.keys(p.specs).length > 0 && (
        <dl className="specs small">
          {Object.entries(p.specs).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="small muted">
        Совместимость: {p.compatibility.map((c) => c.model).join(", ") || "не подтверждена"}
      </div>
      <h3 style={{ margin: "6px 0 0" }}>Где купить в Костанае</h3>
      {offers.length === 0 ? (
        <div className="small muted">
          Сейчас нет в наличии.{" "}
          {p.analogs.length > 0 && <Link to={`/parts/${p.id}`}>Есть аналоги ({p.analogs.length}) →</Link>}
        </div>
      ) : (
        offers.map((o) => (
          <div key={o.offer_id} className="row-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div>
              <strong className="small">{o.shop.name}</strong>
              <div className="small muted">
                {pcs(o.available)} · {ago(o.stock_updated_at)}
              </div>
              <StockModeBadge mode={o.stock_mode} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800 }}>{money(o.price)}</div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  cart.add({ offer_id: o.offer_id, part_id: p.id, title: p.name, price: o.price, shop_id: o.shop.id, shop_name: o.shop.name, available: o.available });
                  setAdded(o.offer_id);
                }}
              >
                {added === o.offer_id ? "✓ В корзине" : "В корзину"}
              </button>
            </div>
          </div>
        ))
      )}
      <Link className="btn" to={`/parts/${p.id}`}>
        Все предложения и аналоги →
      </Link>
    </div>
  );
}

export default function Viewer3D() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const model = useFetch<Model3D>(`/catalog3d/models/${id}`);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hideShell, setHideShell] = useState(false);
  const [explode, setExplode] = useState(0);
  const [assembly, setAssembly] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const selected = params.get("key");

  const components = model.data?.components ?? [];
  const selectedComp = components.find((c) => c.key === selected) ?? null;
  const matches = useMemo(() => new Set(components.filter((c) => matchesQuery(c, query)).map((c) => c.key)), [components, query]);
  const assemblies = useMemo(() => [...new Set(components.map((c) => c.assembly))], [components]);

  const select = (key: string | null, fromList = false) => {
    const next = new URLSearchParams(params);
    if (key) next.set("key", key);
    else next.delete("key");
    setParams(next, { replace: true });
    const comp = components.find((c) => c.key === key);
    if (fromList && comp && !comp.is_shell) setHideShell(true); // внутренние детали иначе не видны
  };

  // Переход «Показать на 3D-модели» из карточки детали: сразу открываем внутренности.
  useEffect(() => {
    if (selectedComp && !selectedComp.is_shell) setHideShell(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.data]);

  useEffect(() => () => void (document.body.style.cursor = "default"), []);

  const focusPoint = useMemo(() => {
    if (!selectedComp) return null;
    const p = new THREE.Vector3(...selectedComp.geometry.position);
    const e = selectedComp.explode.length === 3 ? new THREE.Vector3(...selectedComp.explode) : new THREE.Vector3();
    return p.addScaledVector(e, explode);
  }, [selectedComp, explode]);

  if (model.loading && !model.data) return <Spinner />;
  if (!model.data) return <ErrorBox error={model.error} onRetry={model.reload} />;

  const view: ViewState = { selected, hovered, hideShell, explode, assembly, matches };
  const visibleList = components.filter(
    (c) => (!assembly || c.assembly === assembly) && (!query || matches.has(c.key)),
  );

  return (
    <>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <div className="small muted">
            <Link to="/catalog3d">3D-каталог</Link> / {model.data.brand}
          </div>
          <h1 style={{ margin: 0 }}>{model.data.title}</h1>
        </div>
        <span className="small muted">Упрощённая схема узлов · детальную GLB-модель подключает контент-менеджер</span>
      </div>

      <div className="viewer">
        <div className="viewer-canvas">
          <Canvas shadows camera={{ position: [9, 6.5, 10], fov: 40 }} onPointerMissed={() => select(null)}>
            <Studio shadows />
            <Suspense fallback={null}>
              {components.map((c) => (
                <Part3D key={c.key} c={c} view={view} onHover={setHovered} onSelect={(k) => select(k)} />
              ))}
            </Suspense>
            <ContactShadows position={[0, 0.005, 0]} opacity={0.5} scale={20} blur={2.2} far={6} resolution={512} color="#0b1a10" />
            <Grid args={[30, 30]} position={[0, 0, 0]} cellColor="#9aa597" sectionColor="#667064" fadeDistance={28} infiniteGrid />
            <OrbitControls makeDefault target={[1, 2, 0]} enableDamping minDistance={3} maxDistance={30} maxPolarAngle={Math.PI / 2.05} />
            <FocusRig point={focusPoint} />
          </Canvas>
          <div className="viewer-toolbar">
            <div className="panel row" style={{ gap: 10 }}>
              <label className="check small">
                <input type="checkbox" checked={hideShell} onChange={(e) => setHideShell(e.target.checked)} />
                Скрыть корпус
              </label>
              <label className="check small">
                Разобрать
                <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} style={{ width: 110 }} />
              </label>
            </div>
          </div>
          <div className="viewer-hint">Вращение — левая кнопка · сдвиг — правая · масштаб — колесо</div>
        </div>

        <aside className="stack">
          <div className="card" style={{ margin: 0 }}>
            {selectedComp?.part ? (
              <>
                {selectedComp.part.image_url && <img className="viewer-part-photo" src={selectedComp.part.image_url} alt={selectedComp.part.name} />}
                <div className="small muted">{ASSEMBLY[selectedComp.assembly] ?? selectedComp.assembly}</div>
                <h2 style={{ marginBottom: 4 }}>{selectedComp.part.name}</h2>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  На модели: {selectedComp.name}
                </div>
                <OfferPanel partId={selectedComp.part.id} />
              </>
            ) : (
              <>
                <h3>Выберите деталь</h3>
                <p className="small muted">
                  Наведите на деталь — она подсветится, нажмите — увидите номер, характеристики и цены. Корпусные элементы без цены
                  отдельно не продаются; включите «Скрыть корпус», чтобы увидеть узлы внутри.
                </p>
              </>
            )}
          </div>

          <div className="card" style={{ margin: 0 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти на модели: ремень, 180205…" aria-label="Поиск по модели" />
            <div className="chips" style={{ margin: "10px 0" }}>
              <button className={`chip ${assembly === null ? "on" : ""}`} onClick={() => setAssembly(null)}>
                Все узлы
              </button>
              {assemblies.map((a) => (
                <button key={a} className={`chip ${assembly === a ? "on" : ""}`} onClick={() => setAssembly(assembly === a ? null : a)}>
                  {ASSEMBLY[a] ?? a}
                </button>
              ))}
            </div>
            <div className="component-list">
              {visibleList.map((c) => (
                <button
                  key={c.key}
                  className={c.key === selected ? "on" : ""}
                  disabled={!c.part}
                  onClick={() => select(c.key, true)}
                  onMouseEnter={() => c.part && setHovered(c.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span>{c.name}</span>
                  <span className="muted small">
                    {c.part ? (c.part.summary.min_price ? `от ${money(c.part.summary.min_price)}` : "нет в наличии") : "—"}
                  </span>
                </button>
              ))}
              {visibleList.length === 0 && <div className="small muted">Ничего не найдено</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
