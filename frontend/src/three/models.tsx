/**
 * Стилизованные 3D-модели техники, собранные из примитивов Three.js.
 * Ось X — вперёд по ходу, Y — вверх, Z — вбок. Масштаб примерно в метрах.
 */
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

export interface Palette {
  paint: string;
  roof: string;
  rim: string;
}

export const PALETTES: Record<string, Palette> = {
  red: { paint: "#c9312a", roof: "#f3f1ea", rim: "#c9312a" },
  yellow: { paint: "#e9a81c", roof: "#2f3431", rim: "#e9a81c" },
  green: { paint: "#2f8f4e", roof: "#f3f1ea", rim: "#f2c230" },
  blue: { paint: "#2a5da8", roof: "#f3f1ea", rim: "#d9d9d9" },
};

function useMaterials(p: Palette) {
  return useMemo(
    () => ({
      paint: new THREE.MeshStandardMaterial({ color: p.paint, roughness: 0.32, metalness: 0.25 }),
      roof: new THREE.MeshStandardMaterial({ color: p.roof, roughness: 0.4, metalness: 0.15 }),
      rim: new THREE.MeshStandardMaterial({ color: p.rim, roughness: 0.35, metalness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: "#2a2f2c", roughness: 0.55, metalness: 0.35 }),
      metal: new THREE.MeshStandardMaterial({ color: "#a7afab", roughness: 0.28, metalness: 0.85 }),
      rubber: new THREE.MeshStandardMaterial({ color: "#181818", roughness: 0.92, metalness: 0 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: "#9cc6dc", roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.42, envMapIntensity: 1.6,
      }),
      light: new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#ffe7a0", emissiveIntensity: 1.6 }),
      beacon: new THREE.MeshStandardMaterial({ color: "#ff9a1f", emissive: "#ff7a00", emissiveIntensity: 2 }),
    }),
    [p.paint, p.roof, p.rim],
  );
}

type Mats = ReturnType<typeof useMaterials>;
type V3 = [number, number, number];

function Box({ args, position, rotation, mat, r = 0.06 }: { args: V3; position: V3; rotation?: V3; mat: THREE.Material; r?: number }) {
  return (
    <RoundedBox args={args} radius={Math.min(r, ...args.map((a) => a / 2.2))} smoothness={3} position={position} rotation={rotation} material={mat} castShadow receiveShadow />
  );
}

function Cyl({ r, h, position, rotation, mat, seg = 32 }: { r: number; h: number; position: V3; rotation?: V3; mat: THREE.Material; seg?: number }) {
  return (
    <mesh position={position} rotation={rotation} material={mat} castShadow>
      <cylinderGeometry args={[r, r, h, seg]} />
    </mesh>
  );
}

/** Колесо с грунтозацепами «ёлочкой», диском и ступицей. Ось колеса — Z. */
export function Wheel({ radius, width, position, m, lugs = 22, side = 1 }: { radius: number; width: number; position: V3; m: Mats; lugs?: number; side?: 1 | -1 }) {
  const lugList = useMemo(() => Array.from({ length: lugs }, (_, i) => (i / lugs) * Math.PI * 2), [lugs]);
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.rubber} castShadow>
        <cylinderGeometry args={[radius * 0.97, radius * 0.97, width, 48]} />
      </mesh>
      {lugList.map((a, i) => (
        <group key={i} rotation={[0, 0, a]}>
          {[-1, 1].map((half) => (
            <mesh
              key={half}
              position={[radius * 0.985, 0, (half * width) / 4]}
              rotation={[half * 0.5, 0, 0]}
              material={m.rubber}
            >
              <boxGeometry args={[radius * 0.08, radius * 0.1, width * 0.52]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0, (side * width) / 2]} rotation={[Math.PI / 2, 0, 0]} material={m.rim}>
        <cylinderGeometry args={[radius * 0.6, radius * 0.6, 0.04, 40]} />
      </mesh>
      <mesh position={[0, 0, (side * width) / 2 + side * 0.04]} rotation={[Math.PI / 2, 0, 0]} material={m.metal}>
        <cylinderGeometry args={[radius * 0.2, radius * 0.24, 0.1, 24]} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius * 0.32, Math.sin(a) * radius * 0.32, (side * width) / 2 + side * 0.04]} rotation={[Math.PI / 2, 0, 0]} material={m.dark}>
            <cylinderGeometry args={[0.03, 0.03, 0.06, 8]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Cab({ position, size, m }: { position: V3; size: V3; m: Mats }) {
  const [w, h, d] = size;
  const pillars: [number, number][] = [
    [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [-w / 2, -d / 2],
  ];
  return (
    <group position={position}>
      <Box args={[w * 0.98, h * 0.96, d * 0.98]} position={[0, 0, 0]} mat={m.glass} r={0.08} />
      {pillars.map(([x, z], i) => (
        <Box key={i} args={[0.07, h, 0.07]} position={[x, 0, z]} mat={m.dark} r={0.02} />
      ))}
      <Box args={[w + 0.22, 0.16, d + 0.22]} position={[0, h / 2 + 0.06, 0]} mat={m.roof} r={0.06} />
      <Box args={[w, 0.08, d]} position={[0, -h / 2, 0]} mat={m.dark} r={0.02} />
      {[d / 2 - 0.12, -d / 2 + 0.12].map((z) => (
        <mesh key={z} position={[w / 2 + 0.1, h / 2 + 0.05, z]} material={m.light}>
          <boxGeometry args={[0.04, 0.08, 0.16]} />
        </mesh>
      ))}
      <mesh position={[-w / 4, h / 2 + 0.2, d / 3]} material={m.beacon}>
        <cylinderGeometry args={[0.07, 0.08, 0.14, 16]} />
      </mesh>
    </group>
  );
}

/** Зерноуборочный комбайн: жатка с вращающимся мотовилом, наклонная камера, бункер, выгрузной шнек. */
export function Combine({ palette = PALETTES.red, spinReel = true }: { palette?: Palette; spinReel?: boolean }) {
  const m = useMaterials(palette);
  const reel = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spinReel && reel.current) reel.current.rotation.z -= dt * 1.2;
  });
  const bats = Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2);
  return (
    <group position={[-0.6, 0, 0]}>
      {/* корпус молотилки */}
      <Box args={[4.4, 2.3, 2.5]} position={[-0.2, 2.15, 0]} mat={m.paint} r={0.14} />
      <Box args={[4.42, 0.16, 2.52]} position={[-0.2, 1.2, 0]} mat={m.dark} r={0.03} />
      {[-1.6, -1.0, -0.4, 0.2, 0.8].map((x) => (
        <Box key={x} args={[0.36, 0.9, 0.04]} position={[x, 2.45, 1.27]} mat={m.dark} r={0.02} />
      ))}
      {/* ременные приводы на левом борту: молотилка и жатка */}
      <mesh position={[0.2, 2.4, 1.31]} material={m.rubber} castShadow>
        <torusGeometry args={[0.55, 0.05, 12, 64]} />
      </mesh>
      <Cyl r={0.2} h={0.1} position={[0.2, 2.4, 1.31]} rotation={[Math.PI / 2, 0, 0]} mat={m.metal} />
      <mesh position={[2.5, 1.72, 0.8]} material={m.rubber} castShadow>
        <torusGeometry args={[0.34, 0.045, 12, 48]} />
      </mesh>
      <Cyl r={0.13} h={0.1} position={[2.5, 1.72, 0.81]} rotation={[Math.PI / 2, 0, 0]} mat={m.metal} />
      {/* бункер */}
      <Box args={[2.5, 1.0, 2.6]} position={[-0.5, 3.8, 0]} mat={m.paint} r={0.1} />
      <Box args={[2.56, 0.1, 2.66]} position={[-0.5, 4.33, 0]} mat={m.dark} r={0.03} />
      {/* моторный отсек и радиатор */}
      <Box args={[1.3, 0.85, 2.1]} position={[-1.95, 3.7, 0]} mat={m.dark} r={0.08} />
      {[-0.6, -0.3, 0, 0.3, 0.6].map((z) => (
        <Box key={z} args={[1.1, 0.05, 0.05]} position={[-1.95, 4.15, z]} mat={m.metal} r={0.01} />
      ))}
      <Cyl r={0.07} h={0.9} position={[-1.5, 4.5, -0.85]} mat={m.dark} />
      <Cyl r={0.1} h={0.08} position={[-1.5, 4.96, -0.85]} mat={m.metal} />
      {/* измельчитель соломы */}
      <Box args={[0.8, 0.9, 2.2]} position={[-2.75, 1.35, 0]} mat={m.dark} r={0.08} />
      {/* кабина и площадка */}
      <Box args={[1.7, 0.35, 1.9]} position={[1.85, 3.45, 0]} mat={m.paint} r={0.06} />
      <Cab position={[1.85, 4.25, 0]} size={[1.45, 1.25, 1.6]} m={m} />
      {[1.7, 2.1, 2.5, 2.9, 3.3].map((y) => (
        <Box key={y} args={[0.4, 0.04, 0.05]} position={[1.05, y, 1.36]} mat={m.metal} r={0.01} />
      ))}
      <Box args={[0.04, 1.8, 0.04]} position={[0.86, 2.5, 1.36]} mat={m.metal} r={0.01} />
      <Box args={[0.04, 1.8, 0.04]} position={[1.24, 2.5, 1.36]} mat={m.metal} r={0.01} />
      {/* выгрузной шнек */}
      <Cyl r={0.14} h={4.3} position={[-1.1, 4.45, 1.45]} rotation={[0, 0, Math.PI / 2]} mat={m.paint} />
      <Cyl r={0.12} h={0.5} position={[-3.2, 4.25, 1.45]} mat={m.dark} />
      {/* наклонная камера */}
      <Box args={[2.0, 0.85, 1.5]} position={[2.85, 1.5, 0]} rotation={[0, 0, -0.42]} mat={m.paint} r={0.08} />
      {/* жатка */}
      <group position={[4.15, 0, 0]}>
        <Box args={[1.25, 0.5, 6.6]} position={[0, 0.62, 0]} mat={m.paint} r={0.08} />
        <Box args={[0.14, 1.05, 6.6]} position={[-0.6, 1.0, 0]} mat={m.paint} r={0.04} />
        <Box args={[0.34, 0.06, 6.6]} position={[0.66, 0.38, 0]} mat={m.metal} r={0.02} />
        <Cyl r={0.27} h={6.3} position={[-0.08, 0.84, 0]} rotation={[Math.PI / 2, 0, 0]} mat={m.metal} />
        {[3.3, -3.3].map((z) => (
          <mesh key={z} position={[0.85, 0.48, z]} rotation={[0, 0, -Math.PI / 2]} material={m.paint} castShadow>
            <coneGeometry args={[0.2, 0.8, 16]} />
          </mesh>
        ))}
        {[3.15, -3.15].map((z) => (
          <Box key={z} args={[1.7, 0.09, 0.09]} position={[-0.05, 1.85, z]} rotation={[0, 0, -0.35]} mat={m.paint} r={0.02} />
        ))}
        <group ref={reel} position={[0.55, 1.62, 0]}>
          <Cyl r={0.06} h={6.4} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} mat={m.metal} />
          {bats.map((a) => (
            <group key={a} rotation={[0, 0, a]}>
              <Box args={[0.06, 0.06, 6.2]} position={[0.62, 0, 0]} mat={m.paint} r={0.01} />
              {[2.9, 0, -2.9].map((z) => (
                <Box key={z} args={[0.62, 0.03, 0.03]} position={[0.31, 0, z]} mat={m.dark} r={0.01} />
              ))}
            </group>
          ))}
        </group>
      </group>
      {/* колёса */}
      <Wheel radius={0.92} width={0.66} position={[1.5, 0.92, 1.62]} m={m} side={1} />
      <Wheel radius={0.92} width={0.66} position={[1.5, 0.92, -1.62]} m={m} side={-1} />
      <Wheel radius={0.55} width={0.4} position={[-2.0, 0.55, 1.25]} m={m} lugs={16} side={1} />
      <Wheel radius={0.55} width={0.4} position={[-2.0, 0.55, -1.25]} m={m} lugs={16} side={-1} />
    </group>
  );
}

function Fender({ radius, width, position, mat }: { radius: number; width: number; position: V3; mat: THREE.Material }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]} material={mat} castShadow>
      <cylinderGeometry args={[radius, radius, width, 40, 1, true, Math.PI / 2 + 0.25, Math.PI - 0.5]} />
    </mesh>
  );
}

/** Колёсный трактор: классический (большие задние колёса) или с шарнирной рамой и равными колёсами (К-701). */
export function Tractor({ palette = PALETTES.red, articulated = false }: { palette?: Palette; articulated?: boolean }) {
  const m = useMaterials(palette);
  const mat = useMemo(() => {
    const side = m.paint.clone();
    side.side = THREE.DoubleSide;
    return side;
  }, [m.paint]);

  if (articulated) {
    return (
      <group position={[0.1, 0, 0]}>
        {/* передняя полурама с кабиной */}
        <Box args={[1.9, 0.6, 1.2]} position={[1.35, 1.2, 0]} mat={m.dark} r={0.05} />
        <Box args={[1.5, 0.75, 1.5]} position={[1.35, 1.75, 0]} mat={m.paint} r={0.08} />
        <Cab position={[1.35, 2.85, 0]} size={[1.4, 1.35, 1.45]} m={m} />
        <Box args={[0.2, 0.55, 1.3]} position={[2.35, 1.35, 0]} mat={m.dark} r={0.04} />
        {[0.4, -0.4].map((z) => (
          <mesh key={z} position={[2.46, 1.55, z]} material={m.light}>
            <boxGeometry args={[0.04, 0.12, 0.2]} />
          </mesh>
        ))}
        {/* шарнир */}
        <Cyl r={0.22} h={0.5} position={[0.2, 1.2, 0]} mat={m.metal} />
        {/* задняя полурама с двигателем */}
        <Box args={[2.4, 1.15, 1.35]} position={[-1.3, 1.85, 0]} mat={m.paint} r={0.14} />
        <Box args={[2.0, 0.55, 1.1]} position={[-1.3, 1.1, 0]} mat={m.dark} r={0.05} />
        {[-0.4, -0.15, 0.1, 0.35].map((z) => (
          <Box key={z} args={[0.05, 0.75, 0.12]} position={[-2.52, 1.9, z]} mat={m.dark} r={0.02} />
        ))}
        <Cyl r={0.08} h={1.0} position={[-0.7, 2.85, 0.35]} mat={m.dark} />
        <Cyl r={0.11} h={0.5} position={[-0.7, 2.7, -0.35]} mat={m.metal} />
        {[1.35, -1.25].flatMap((x) => [
          <Fender key={`f${x}1`} radius={1.0} width={0.7} position={[x, 0.95, 1.05]} mat={mat} />,
          <Fender key={`f${x}2`} radius={1.0} width={0.7} position={[x, 0.95, -1.05]} mat={mat} />,
        ])}
        <Wheel radius={0.9} width={0.62} position={[1.35, 0.9, 1.05]} m={m} side={1} />
        <Wheel radius={0.9} width={0.62} position={[1.35, 0.9, -1.05]} m={m} side={-1} />
        <Wheel radius={0.9} width={0.62} position={[-1.25, 0.9, 1.05]} m={m} side={1} />
        <Wheel radius={0.9} width={0.62} position={[-1.25, 0.9, -1.05]} m={m} side={-1} />
      </group>
    );
  }

  return (
    <group position={[-0.2, 0, 0]}>
      {/* капот и рама */}
      <Box args={[2.2, 0.95, 0.95]} position={[0.95, 1.45, 0]} mat={m.paint} r={0.12} />
      <Box args={[2.7, 0.42, 0.7]} position={[0.7, 0.92, 0]} mat={m.dark} r={0.05} />
      <Box args={[0.08, 0.8, 0.86]} position={[2.07, 1.42, 0]} mat={m.dark} r={0.02} />
      {[-0.25, -0.1, 0.05, 0.2].map((y) => (
        <Box key={y} args={[0.03, 0.04, 0.8]} position={[2.12, 1.42 + y, 0]} mat={m.metal} r={0.01} />
      ))}
      {[0.33, -0.33].map((z) => (
        <mesh key={z} position={[2.1, 1.72, z]} material={m.light}>
          <boxGeometry args={[0.04, 0.1, 0.16]} />
        </mesh>
      ))}
      <Box args={[0.35, 0.42, 0.9]} position={[2.25, 1.0, 0]} mat={m.dark} r={0.04} />
      <Cyl r={0.06} h={1.1} position={[1.35, 2.4, 0.3]} mat={m.dark} />
      <Cyl r={0.08} h={0.12} position={[1.35, 2.98, 0.3]} mat={m.metal} />
      <Cyl r={0.09} h={0.7} position={[1.35, 2.2, -0.3]} mat={m.metal} />
      {/* кабина */}
      <Box args={[1.5, 0.55, 1.45]} position={[-0.65, 1.35, 0]} mat={m.paint} r={0.06} />
      <Cab position={[-0.65, 2.32, 0]} size={[1.35, 1.35, 1.3]} m={m} />
      {/* навеска */}
      <Box args={[0.5, 0.12, 0.12]} position={[-1.6, 0.95, 0.35]} mat={m.dark} r={0.02} />
      <Box args={[0.5, 0.12, 0.12]} position={[-1.6, 0.95, -0.35]} mat={m.dark} r={0.02} />
      <Box args={[0.12, 0.6, 0.12]} position={[-1.55, 1.35, 0]} mat={m.dark} r={0.02} />
      {/* крылья и колёса */}
      <Fender radius={1.0} width={0.62} position={[-0.7, 0.92, 1.0]} mat={mat} />
      <Fender radius={1.0} width={0.62} position={[-0.7, 0.92, -1.0]} mat={mat} />
      <Wheel radius={0.92} width={0.56} position={[-0.7, 0.92, 1.0]} m={m} side={1} />
      <Wheel radius={0.92} width={0.56} position={[-0.7, 0.92, -1.0]} m={m} side={-1} />
      <Wheel radius={0.55} width={0.32} position={[1.55, 0.55, 0.78]} m={m} lugs={16} side={1} />
      <Wheel radius={0.55} width={0.32} position={[1.55, 0.55, -0.78]} m={m} lugs={16} side={-1} />
    </group>
  );
}

export type MachineKind = "combine" | "tractor" | "articulated";

export function Machine({ kind, palette }: { kind: MachineKind; palette?: Palette }): ReactNode {
  if (kind === "combine") return <Combine palette={palette} />;
  return <Tractor palette={palette} articulated={kind === "articulated"} />;
}
