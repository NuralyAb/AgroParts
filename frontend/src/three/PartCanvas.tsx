import { Bounds, ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { PartModel, type PartRender } from "./parts";

/** Светлая «предметная» студия: серое окружение даёт металлу читаемые отражения. */
function PartStudio() {
  return (
    <>
      <hemisphereLight args={["#ffffff", "#8a8f86", 0.7]} />
      <directionalLight position={[4, 8, 5]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-5, 3, -4]} intensity={0.9} color="#dbe8ff" />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#8e938d"]} />
        <Lightformer form="rect" intensity={2.6} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={2.5} position={[-5, 2, 3]} rotation-y={Math.PI / 2.5} scale={[6, 4, 1]} />
        <Lightformer form="rect" intensity={2} position={[5, 2, -3]} rotation-y={-Math.PI / 2.5} scale={[6, 4, 1]} color="#fff2dc" />
        <Lightformer form="rect" intensity={1.2} position={[0, -3, 4]} rotation-x={-Math.PI / 3} scale={[8, 2, 1]} />
      </Environment>
    </>
  );
}

/** Интерактивная 3D-модель запчасти: крутится, приближается, с мягкой тенью. */
export default function PartCanvas({
  spec,
  interactive = true,
  autoRotate = true,
  className,
  preserve = false,
}: {
  spec: PartRender;
  interactive?: boolean;
  autoRotate?: boolean;
  className?: string;
  preserve?: boolean;
}) {
  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4.6, 3.6, 5.2], fov: 30 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: preserve }}
        style={{ touchAction: "pan-y" }}
      >
        <PartStudio />
        <Suspense fallback={null}>
          {preserve ? (
            // Рендер картинок: фиксированный кадр без анимированной подгонки — результат не зависит от тайминга.
            <PartModel spec={spec} />
          ) : (
            <Bounds fit clip margin={1.12} maxDuration={0.8}>
              <PartModel spec={spec} />
            </Bounds>
          )}
        </Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.42} scale={9} blur={2.6} far={3.5} resolution={512} color="#0b1a10" />
        <OrbitControls
          makeDefault
          target={[0, 0.9, 0]}
          autoRotate={autoRotate}
          autoRotateSpeed={1.2}
          enablePan={false}
          enableZoom={interactive}
          enableRotate={interactive}
          minDistance={2}
          maxDistance={12}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  );
}
