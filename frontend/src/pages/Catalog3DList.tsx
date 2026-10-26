import { ArrowRight } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useFetch } from "../api";
import { KIND_LABEL } from "../components/icons";
import { Empty, ErrorBox, Spinner } from "../components/ui";
import type { Model3DBrief } from "../types";

const MachineCanvas = lazy(() => import("../three/MachineCanvas"));

export default function Catalog3DList() {
  const models = useFetch<Model3DBrief[]>("/catalog3d/models");
  return (
    <>
      <div className="section-head">
        <div>
          <div className="eyebrow">3D-каталог техники</div>
          <h1 style={{ margin: "6px 0 0" }}>Найдите деталь прямо на модели</h1>
          <p>Выберите технику, откройте узел и нажмите на деталь — увидите номер, совместимость и наличие в магазинах.</p>
        </div>
      </div>
      <ErrorBox error={models.error} onRetry={models.reload} />
      {models.loading && !models.data ? (
        <Spinner />
      ) : models.data?.length === 0 ? (
        <Empty>Модели пока не добавлены</Empty>
      ) : (
        <div className="grid grid-2">
          {models.data?.map((m) => (
            <Link key={m.id} to={`/catalog3d/${m.id}`} className="machine" style={{ aspectRatio: "16 / 10" }}>
              <Suspense fallback={null}>
                <MachineCanvas kind={m.kind === "combine" ? "combine" : "tractor"} palette="red" interactive={false} shadows={false} className="machine-canvas" />
              </Suspense>
              <div className="meta row-between" style={{ alignItems: "flex-end" }}>
                <div>
                  <div className="kind">{KIND_LABEL[m.kind]}</div>
                  <div className="name">{m.title}</div>
                  <div className="brand">{m.has_glb ? "Детальная модель" : "Схема узлов с привязкой к каталогу"}</div>
                </div>
                <span className="btn btn-accent">
                  Открыть <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
