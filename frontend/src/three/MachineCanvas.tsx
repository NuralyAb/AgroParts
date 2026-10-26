import { Bounds, ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Machine, PALETTES, type MachineKind, type Palette } from "./models";

// Сдвиг корневой группы каждой модели (см. models.tsx): координаты подсказок задаются в системе модели.
const OFFSET: Record<MachineKind, number> = { combine: -0.6, tractor: -0.2, articulated: 0.1 };

export interface Hotspot {
  position: [number, number, number];
  label: string;
  price?: string | null;
  href?: string;
}

function HotspotPin({ h }: { h: Hotspot }) {
  const navigate = useNavigate();
  return (
    <Html position={h.position} zIndexRange={[20, 0]} occlude style={{ pointerEvents: "auto", transform: "translate(-7px, -50%)" }}>
      <button className="hotspot" onClick={() => h.href && navigate(h.href)} title={h.label}>
        <span className="pulse" />
        <span className="pill">
          <b>{h.label}</b>
          {h.price && <span>{h.price}</span>}
        </span>
      </button>
    </Html>
  );
}

/** Студийный свет без загрузки HDR: отражения на краске дают световые панели Lightformer. */
export function Studio({ shadows }: { shadows: boolean }) {
  return (
    <>
      <hemisphereLight args={["#fff8e7", "#3b4a3f", 0.55]} />
      <directionalLight position={[6, 10, 6]} intensity={2.2} castShadow={shadows} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.5, 30]} />
      </directionalLight>
      <directionalLight position={[-8, 4, -6]} intensity={0.8} color="#cfe3ff" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 6, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-6, 2, 4]} rotation-y={Math.PI / 2.5} scale={[8, 3, 1]} color="#fff3d6" />
        <Lightformer form="rect" intensity={1.2} position={[6, 2, -4]} rotation-y={-Math.PI / 2.5} scale={[8, 3, 1]} color="#d6ecff" />
        <Lightformer form="ring" intensity={2} position={[0, 3, -9]} scale={4} color="#f2b630" />
      </Environment>
    </>
  );
}

export default function MachineCanvas({
  kind,
  palette,
  hotspots = [],
  interactive = true,
  autoRotateSpeed = 0.8,
  podium = false,
  shadows = true,
  className,
  margin,
  children,
}: {
  margin?: number;
  kind: MachineKind;
  palette?: Palette | keyof typeof PALETTES;
  hotspots?: Hotspot[];
  interactive?: boolean;
  autoRotateSpeed?: number;
  podium?: boolean;
  shadows?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const podiumR = kind === "combine" ? 5.3 : 3.1;

  // Не тратим GPU на модели вне экрана (на главной их несколько).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className={className ?? "machine-canvas-default"}>
      <Canvas
        shadows={shadows}
        dpr={[1, 1.75]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [9, 5, 9], fov: 32, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        style={{ touchAction: interactive ? "pan-y" : "auto" }}
      >
        <Studio shadows={shadows} />
        <Suspense fallback={null}>
          <Bounds fit clip margin={margin ?? (kind === "combine" ? 1.12 : 1.25)}>
            <group key={kind}>
              <Machine kind={kind} palette={typeof palette === "string" ? PALETTES[palette] : palette} />
              <group position={[OFFSET[kind], 0, 0]}>
                {hotspots.map((h, i) => (
                  <HotspotPin key={i} h={h} />
                ))}
              </group>
            </group>
          </Bounds>
        </Suspense>
        {podium && (
          <group position={[0, -0.02, 0]}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[podiumR, 96]} />
              <meshStandardMaterial color="#123a24" roughness={0.6} metalness={0.2} transparent opacity={0.55} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
              <ringGeometry args={[podiumR - 0.1, podiumR + 0.05, 128]} />
              <meshBasicMaterial color="#f2b630" transparent opacity={0.8} />
            </mesh>
          </group>
        )}
        <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={18} blur={2.4} far={6} resolution={512} color="#08140c" />
        <OrbitControls
          makeDefault
          autoRotate
          autoRotateSpeed={autoRotateSpeed}
          enableZoom={false}
          enablePan={false}
          enableRotate={interactive}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2.15}
          enableDamping
        />
      </Canvas>
      {children}
    </div>
  );
}
