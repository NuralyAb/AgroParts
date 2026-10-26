import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PartCanvas from "../three/PartCanvas";
import type { PartRender } from "../three/parts";

/**
 * Служебная страница для генерации изображений карточек: backend/scripts/render_part_images.py
 * открывает её в headless-браузере и сохраняет скриншот с прозрачным фоном.
 *   /render?spec={"type":"vbelt","ribs":4}
 */
export default function RenderPart() {
  const [params] = useSearchParams();
  const spec = useMemo(() => {
    try {
      return JSON.parse(params.get("spec") ?? "") as PartRender;
    } catch {
      return null;
    }
  }, [params]);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    const t = setTimeout(() => (document.title = "ready"), 1500);
    return () => {
      document.body.style.background = prev;
      clearTimeout(t);
    };
  }, []);

  if (!spec) return <pre>?spec= — JSON с описанием модели</pre>;
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <PartCanvas spec={spec} interactive={false} autoRotate={false} preserve />
    </div>
  );
}
