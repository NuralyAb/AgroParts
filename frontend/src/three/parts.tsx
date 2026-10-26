/**
 * Процедурные 3D-модели запчастей для карточек и страницы товара.
 * Каждая модель примерно вписана в куб ~2 единицы и стоит основанием на y = 0.
 */
import { useMemo } from "react";
import * as THREE from "three";

export type PartRender =
  | { type: "vbelt"; ribs: number; stripe?: string; length?: number }
  | { type: "bearing"; seal?: string }
  | { type: "oilfilter"; color?: string; band?: string }
  | { type: "fuelfilter"; color?: string }
  | { type: "airfilter"; paper?: string }
  | { type: "knife" }
  | { type: "segment" }
  | { type: "hydrocyl"; color?: string }
  | { type: "gearpump"; color?: string }
  | { type: "chain" }
  | { type: "seal" }
  | { type: "alternator" };

const DS = THREE.DoubleSide; // тела вращения и открытые цилиндры видны с обеих сторон

function useMats() {
  return useMemo(
    () => ({
      rubber: new THREE.MeshStandardMaterial({ color: "#232425", roughness: 0.7, metalness: 0.05, side: DS }),
      steel: new THREE.MeshStandardMaterial({ color: "#9aa3a8", roughness: 0.3, metalness: 0.92, side: DS }),
      chrome: new THREE.MeshStandardMaterial({ color: "#d3d9dc", roughness: 0.1, metalness: 1, side: DS }),
      darkSteel: new THREE.MeshStandardMaterial({ color: "#5c6468", roughness: 0.38, metalness: 0.85, side: DS }),
      alu: new THREE.MeshStandardMaterial({ color: "#8f969a", roughness: 0.42, metalness: 0.8, side: DS }),
      black: new THREE.MeshStandardMaterial({ color: "#2a2d2e", roughness: 0.45, metalness: 0.3, side: DS }),
      paper: new THREE.MeshStandardMaterial({ color: "#efe3b8", roughness: 0.9, metalness: 0, side: DS }),
      white: new THREE.MeshStandardMaterial({ color: "#f4f4f1", roughness: 0.5, metalness: 0, side: DS }),
      copper: new THREE.MeshStandardMaterial({ color: "#c98a52", roughness: 0.3, metalness: 0.9, side: DS }),
      glass: new THREE.MeshPhysicalMaterial({ color: "#f4f8fa", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, side: DS }),
      fuel: new THREE.MeshStandardMaterial({ color: "#d9a43a", roughness: 0.2, metalness: 0, transparent: true, opacity: 0.75, side: DS }),
    }),
    [],
  );
}

const paint = (color: string, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.35, side: DS });

/** Тело вращения по профилю [радиус, высота]. */
function Lathe({ profile, material, segments = 64 }: { profile: [number, number][]; material: THREE.Material; segments?: number }) {
  const geo = useMemo(() => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments), [profile, segments]);
  return <mesh geometry={geo} material={material} castShadow receiveShadow />;
}

// --- ремень ---------------------------------------------------------------------------------------

/** Многоручьевой клиновой ремень (HB / 4HB): поперечный профиль выдавливается вдоль замкнутого контура. */
function VBelt({ ribs, stripe = "#f2b630", length = 1 }: { ribs: number; stripe?: string; length?: number }) {
  const m = useMats();
  const { body, band } = useMemo(() => {
    const ribW = 0.17;
    const W = ribs * ribW;
    const topT = 0.05;
    const ribH = 0.11;
    const s = new THREE.Shape();
    // профиль в координатах (поперёк ремня, толщина); клинья смотрят внутрь контура
    // Клинья направлены внутрь контура (+y профиля), снаружи — гладкая спинка с маркировочной полосой.
    s.moveTo(-W / 2, 0);
    s.lineTo(-W / 2, topT);
    for (let i = 0; i < ribs; i++) {
      const x0 = -W / 2 + i * ribW;
      s.lineTo(x0 + ribW * 0.12, topT);
      s.lineTo(x0 + ribW * 0.34, topT + ribH);
      s.lineTo(x0 + ribW * 0.66, topT + ribH);
      s.lineTo(x0 + ribW * 0.88, topT);
    }
    s.lineTo(W / 2, topT);
    s.lineTo(W / 2, 0);
    s.closePath();

    const rx = 1.05 * length;
    const ry = 0.62;
    const pts: THREE.Vector3[] = [];
    const N = 160;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      // «стадион» с мягкими дугами — так ремень выглядит естественно, а не как эллипс
      const c = Math.cos(a);
      const sn = Math.sin(a);
      pts.push(new THREE.Vector3(Math.sign(c) * Math.pow(Math.abs(c), 0.7) * rx, Math.sign(sn) * Math.pow(Math.abs(sn), 0.7) * ry, 0));
    }
    const path = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    const body = new THREE.ExtrudeGeometry(s, { steps: 320, bevelEnabled: false, extrudePath: path });

    const b = new THREE.Shape();
    b.moveTo(-W * 0.3, -0.001);
    b.lineTo(W * 0.3, -0.001);
    b.lineTo(W * 0.3, -0.009);
    b.lineTo(-W * 0.3, -0.009);
    b.closePath();
    const band = new THREE.ExtrudeGeometry(b, { steps: 320, bevelEnabled: false, extrudePath: path });
    return { body, band };
  }, [ribs, length]);
  const stripeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.5 }), [stripe]);
  return (
    <group rotation={[-Math.PI / 3.2, 0.15, 0.3]} position={[0, 0.75, 0]}>
      <mesh geometry={body} material={m.rubber} castShadow receiveShadow />
      <mesh geometry={band} material={stripeMat} />
    </group>
  );
}

// --- подшипник ------------------------------------------------------------------------------------

function Bearing({ seal = "#7a2a1f" }: { seal?: string }) {
  const m = useMats();
  const sealMat = useMemo(() => new THREE.MeshStandardMaterial({ color: seal, roughness: 0.6 }), [seal]);
  const outer: [number, number][] = [[0.78, -0.3], [1.0, -0.3], [1.0, 0.3], [0.78, 0.3], [0.78, 0.08], [0.72, 0], [0.78, -0.08], [0.78, -0.3]];
  const inner: [number, number][] = [[0.38, -0.3], [0.52, -0.3], [0.52, -0.08], [0.58, 0], [0.52, 0.08], [0.52, 0.3], [0.38, 0.3], [0.38, -0.3]];
  const balls = Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2);
  return (
    <group rotation={[Math.PI / 2.4, 0, 0]} position={[0, 1.0, 0]}>
      <Lathe profile={outer} material={m.steel} />
      <Lathe profile={inner} material={m.steel} />
      {balls.map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.65, 0, Math.sin(a) * 0.65]} material={m.chrome} castShadow>
          <sphereGeometry args={[0.105, 32, 16]} />
        </mesh>
      ))}
      {/* сепаратор */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.copper}>
        <torusGeometry args={[0.65, 0.025, 8, 64]} />
      </mesh>
      {/* уплотнение с задней стороны (2RS); переднее снято, чтобы видеть шарики */}
      <mesh position={[0, -0.24, 0]} rotation={[Math.PI / 2, 0, 0]} material={sealMat}>
        <ringGeometry args={[0.52, 0.78, 64]} />
      </mesh>
    </group>
  );
}

// --- фильтры --------------------------------------------------------------------------------------

function OilFilter({ color = "#1f5ea8", band = "#f2b630" }: { color?: string; band?: string }) {
  const m = useMats();
  const body = useMemo(() => paint(color, 0.25), [color]);
  const bandMat = useMemo(() => paint(band, 0.4), [band]);
  const can: [number, number][] = [[0, 2.0], [0.42, 2.0], [0.6, 1.97], [0.66, 1.9], [0.68, 1.75], [0.68, 0.18], [0.66, 0.12], [0.6, 0.1]];
  return (
    <group position={[0, 0, 0]}>
      <Lathe profile={can} material={body} />
      <mesh position={[0, 1.15, 0]} material={bandMat}>
        <cylinderGeometry args={[0.685, 0.685, 0.42, 64, 1, true]} />
      </mesh>
      <mesh position={[0, 1.15, 0]} material={m.white}>
        <cylinderGeometry args={[0.687, 0.687, 0.08, 64, 1, true]} />
      </mesh>
      {/* опорная пластина с уплотнительным кольцом и резьбой */}
      <mesh position={[0, 0.06, 0]} material={m.steel} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.08, 64]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.rubber}>
        <torusGeometry args={[0.47, 0.035, 12, 64]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} material={m.darkSteel}>
        <cylinderGeometry args={[0.16, 0.16, 0.06, 32]} />
      </mesh>
    </group>
  );
}

function FuelFilter({ color = "#2f8f4e" }: { color?: string }) {
  const m = useMats();
  const head = useMemo(() => paint("#3a3f42", 0.3), []);
  const body = useMemo(() => paint(color, 0.3), [color]);
  return (
    <group>
      {/* корпус-головка с штуцерами */}
      <mesh position={[0, 1.85, 0]} material={head} castShadow>
        <boxGeometry args={[1.1, 0.32, 0.8]} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, 1.85, 0]} rotation={[0, 0, Math.PI / 2]} material={m.copper}>
          <cylinderGeometry args={[0.09, 0.09, 0.32, 24]} />
        </mesh>
      ))}
      <Lathe profile={[[0, 1.7], [0.45, 1.7], [0.48, 1.65], [0.48, 0.85], [0.46, 0.8]]} material={body} />
      {/* прозрачный отстойник с топливом */}
      <Lathe profile={[[0.46, 0.8], [0.44, 0.3], [0.36, 0.2], [0, 0.18]]} material={m.glass} />
      <Lathe profile={[[0, 0.55], [0.4, 0.55], [0.38, 0.3], [0.3, 0.22], [0, 0.21]]} material={m.fuel} />
      <mesh position={[0, 0.12, 0]} material={m.darkSteel}>
        <cylinderGeometry args={[0.07, 0.07, 0.18, 16]} />
      </mesh>
    </group>
  );
}

function AirFilter({ paper = "#efe3b8" }: { paper?: string }) {
  const m = useMats();
  const paperMat = useMemo(() => new THREE.MeshStandardMaterial({ color: paper, roughness: 0.9 }), [paper]);
  const pleatGeo = useMemo(() => new THREE.BoxGeometry(0.22, 1.6, 0.03), []);
  const angles = useMemo(() => Array.from({ length: 80 }, (_, i) => (i / 80) * Math.PI * 2), []);
  return (
    <group>
      {/* гофрированная бумажная штора */}
      {angles.map((a) => (
        <mesh key={a} geometry={pleatGeo} material={paperMat} position={[Math.cos(a) * 0.82, 1.0, Math.sin(a) * 0.82]} rotation={[0, -a, 0]} castShadow />
      ))}
      <mesh position={[0, 1.0, 0]} material={m.darkSteel}>
        <cylinderGeometry args={[0.7, 0.7, 1.6, 48, 1, true]} />
      </mesh>
      {[0.12, 1.88].map((y) => (
        <Lathe key={y} profile={[[0.55, y - 0.12], [0.98, y - 0.12], [1.0, y - 0.08], [1.0, y + 0.08], [0.98, y + 0.12], [0.55, y + 0.12]]} material={m.rubber} />
      ))}
      <mesh position={[0, 1.88, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.black}>
        <ringGeometry args={[0.3, 0.56, 48]} />
      </mesh>
    </group>
  );
}

// --- жатка ----------------------------------------------------------------------------------------

function segmentShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.38, 0);
  s.lineTo(0.38, 0);
  s.lineTo(0.12, 0.9);
  s.lineTo(-0.12, 0.9);
  s.closePath();
  for (const x of [-0.14, 0.14]) {
    const h = new THREE.Path();
    h.absarc(x, 0.2, 0.05, 0, Math.PI * 2, false);
    s.holes.push(h);
  }
  return s;
}

function Segment() {
  const m = useMats();
  const geo = useMemo(() => new THREE.ExtrudeGeometry(segmentShape(), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }), []);
  return (
    <group rotation={[-Math.PI / 3.2, 0.2, 0.35]} position={[0, 0.6, 0.3]} scale={1.6}>
      <mesh geometry={geo} material={m.steel} castShadow />
      {/* насечка на режущих кромках */}
      {Array.from({ length: 14 }, (_, i) => i / 14).map((t) => (
        <group key={t}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (0.38 - 0.26 * t) - side * 0.02, t * 0.9, 0.045]} rotation={[0, 0, side * 0.28]} material={m.darkSteel}>
              <boxGeometry args={[0.04, 0.012, 0.01]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Knife() {
  const m = useMats();
  const seg = useMemo(() => new THREE.ExtrudeGeometry(segmentShape(), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.015, bevelSegments: 1 }), []);
  const n = 6;
  return (
    <group rotation={[-Math.PI / 3, 0.5, 0.15]} position={[0, 0.5, 0.2]}>
      {/* спинка ножа */}
      <mesh position={[0, -0.05, 0]} material={m.darkSteel} castShadow>
        <boxGeometry args={[n * 0.4 + 0.2, 0.14, 0.08]} />
      </mesh>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[(i - (n - 1) / 2) * 0.4, 0, 0.04]} scale={0.52}>
          <mesh geometry={seg} material={m.steel} castShadow />
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, 0.2, 0.06]} rotation={[Math.PI / 2, 0, 0]} material={m.copper}>
              <cylinderGeometry args={[0.06, 0.06, 0.05, 12]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* головка ножа */}
      <mesh position={[-(n * 0.4) / 2 - 0.25, 0, 0]} material={m.black} castShadow>
        <boxGeometry args={[0.36, 0.34, 0.2]} />
      </mesh>
    </group>
  );
}

// --- гидравлика -----------------------------------------------------------------------------------

function HydroCyl({ color = "#2b2f2c" }: { color?: string }) {
  const m = useMats();
  const body = useMemo(() => paint(color, 0.35), [color]);
  return (
    <group rotation={[0, 0, Math.PI / 2]} position={[0, 0.42, 0]}>
      <group rotation={[0, 0, 0]} position={[0, 0, 0]}>
        <mesh position={[0, -0.55, 0]} material={body} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 1.6, 48]} />
        </mesh>
        <mesh position={[0, 0.3, 0]} material={m.darkSteel}>
          <cylinderGeometry args={[0.32, 0.32, 0.14, 48]} />
        </mesh>
        <mesh position={[0, -1.38, 0]} material={m.darkSteel}>
          <cylinderGeometry args={[0.32, 0.32, 0.14, 48]} />
        </mesh>
        <mesh position={[0, 0.95, 0]} material={m.chrome} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 1.2, 32]} />
        </mesh>
        {[1.62, -1.62].map((y) => (
          <group key={y} position={[0, y, 0]}>
            <mesh material={m.darkSteel} castShadow>
              <torusGeometry args={[0.16, 0.08, 16, 32]} />
            </mesh>
          </group>
        ))}
        {[0.05, -1.15].map((y) => (
          <mesh key={y} position={[0.33, y, 0]} rotation={[0, 0, Math.PI / 2]} material={m.copper}>
            <cylinderGeometry args={[0.07, 0.07, 0.18, 16]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function GearPump({ color = "#b9bec0" }: { color?: string }) {
  const m = useMats();
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.8 }), [color]);
  return (
    <group position={[0, 0.7, 0]} rotation={[0, 0.6, 0]}>
      {/* корпус «восьмёркой»: два цилиндра шестерён */}
      {[0.32, -0.32].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={body} castShadow>
          <cylinderGeometry args={[0.55, 0.55, 1.1, 48]} />
        </mesh>
      ))}
      <mesh material={body}>
        <boxGeometry args={[1.1, 0.64, 1.1]} />
      </mesh>
      {/* фланец и вал */}
      <mesh position={[0, 0.32, 0.62]} rotation={[Math.PI / 2, 0, 0]} material={m.alu}>
        <cylinderGeometry args={[0.42, 0.42, 0.14, 48]} />
      </mesh>
      <mesh position={[0, 0.32, 0.95]} rotation={[Math.PI / 2, 0, 0]} material={m.steel}>
        <cylinderGeometry args={[0.1, 0.1, 0.55, 24]} />
      </mesh>
      {/* штуцеры */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.62, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.darkSteel}>
          <cylinderGeometry args={[0.16, 0.16, 0.2, 6]} />
        </mesh>
      ))}
      {/* болты крышки */}
      {[[-0.4, 0.75], [0.4, 0.75], [-0.4, -0.75], [0.4, -0.75]].map(([x, y]) => (
        <mesh key={`${x}${y}`} position={[x, y, -0.56]} rotation={[Math.PI / 2, 0, 0]} material={m.darkSteel}>
          <cylinderGeometry args={[0.07, 0.07, 0.06, 6]} />
        </mesh>
      ))}
    </group>
  );
}

// --- цепь, манжета, генератор ---------------------------------------------------------------------

function Chain() {
  const m = useMats();
  const plate = useMemo(() => {
    const s = new THREE.Shape();
    const r = 0.13;
    s.absarc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
    s.lineTo(0.38, -r * 0.8);
    s.absarc(0.38, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, r);
    return new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
  }, []);
  const links = 7;
  // звенья по пологой дуге
  const pts = Array.from({ length: links + 1 }, (_, i) => {
    const t = i / links;
    return new THREE.Vector3((t - 0.5) * links * 0.38, 0.35 + Math.sin(t * Math.PI) * 0.5, 0);
  });
  return (
    <group rotation={[-0.5, 0.3, 0]} position={[0, 0.2, 0]}>
      {pts.slice(0, -1).map((p, i) => {
        const q = pts[i + 1];
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        const outer = i % 2 === 0;
        const w = outer ? 0.2 : 0.13;
        return (
          <group key={i} position={p} rotation={[0, 0, ang]}>
            {[-w, w].map((z) => (
              <mesh key={z} geometry={plate} position={[0, 0, z - 0.02]} material={outer ? m.steel : m.alu} castShadow />
            ))}
            <mesh rotation={[Math.PI / 2, 0, 0]} material={m.copper}>
              <cylinderGeometry args={[0.1, 0.1, 0.3, 24]} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} material={m.chrome}>
              <cylinderGeometry args={[0.045, 0.045, 0.5, 16]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Seal() {
  const m = useMats();
  const profile: [number, number][] = [[0.82, -0.18], [1.0, -0.18], [1.0, 0.18], [0.84, 0.18], [0.84, 0.1], [0.74, 0.06], [0.68, -0.02], [0.74, -0.06], [0.82, -0.1]];
  return (
    <group rotation={[Math.PI / 2.5, 0, 0]} position={[0, 1.0, 0]}>
      <Lathe profile={profile} material={m.rubber} segments={96} />
      <mesh material={m.steel} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.022, 8, 96]} />
      </mesh>
      <mesh position={[0, -0.181, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.steel}>
        <ringGeometry args={[0.86, 0.99, 96]} />
      </mesh>
    </group>
  );
}

function Alternator() {
  const m = useMats();
  const fins = Array.from({ length: 28 }, (_, i) => (i / 28) * Math.PI * 2);
  return (
    <group rotation={[0, 0, Math.PI / 2]} position={[0, 0.75, 0]}>
      <mesh material={m.alu} castShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.9, 48]} />
      </mesh>
      {fins.map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.63, 0, Math.sin(a) * 0.63]} rotation={[0, -a, 0]} material={m.alu}>
          <boxGeometry args={[0.06, 0.7, 0.03]} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0]} material={m.black}>
        <cylinderGeometry args={[0.5, 0.5, 0.12, 24]} />
      </mesh>
      {/* шкив с ручьём */}
      <Lathe profile={[[0.1, 0.62], [0.32, 0.62], [0.32, 0.66], [0.24, 0.72], [0.32, 0.78], [0.32, 0.82], [0.1, 0.82]]} material={m.steel} />
      <mesh position={[0, 0.88, 0]} material={m.darkSteel}>
        <cylinderGeometry args={[0.07, 0.07, 0.12, 6]} />
      </mesh>
      {/* проушины крепления */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.72, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.alu}>
          <torusGeometry args={[0.1, 0.05, 12, 24]} />
        </mesh>
      ))}
      <mesh position={[0.2, -0.5, 0.3]} material={m.copper}>
        <cylinderGeometry args={[0.05, 0.05, 0.15, 12]} />
      </mesh>
    </group>
  );
}

export function PartModel({ spec }: { spec: PartRender }) {
  switch (spec.type) {
    case "vbelt":
      return <VBelt ribs={spec.ribs} stripe={spec.stripe} length={spec.length} />;
    case "bearing":
      return <Bearing seal={spec.seal} />;
    case "oilfilter":
      return <OilFilter color={spec.color} band={spec.band} />;
    case "fuelfilter":
      return <FuelFilter color={spec.color} />;
    case "airfilter":
      return <AirFilter paper={spec.paper} />;
    case "knife":
      return <Knife />;
    case "segment":
      return <Segment />;
    case "hydrocyl":
      return <HydroCyl color={spec.color} />;
    case "gearpump":
      return <GearPump color={spec.color} />;
    case "chain":
      return <Chain />;
    case "seal":
      return <Seal />;
    case "alternator":
      return <Alternator />;
  }
}
