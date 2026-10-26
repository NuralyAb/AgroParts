import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorText, useFetch } from "../api";
import MachinePicker, { emptyMachine } from "../components/MachinePicker";
import { Empty, ErrorBox, Spinner } from "../components/ui";
import type { Brand, Model3DBrief, Vehicle } from "../types";

export default function Garage() {
  const garage = useFetch<Vehicle[]>("/garage");
  const brands = useFetch<Brand[]>("/catalog/brands");
  const models3d = useFetch<Model3DBrief[]>("/catalog3d/models");
  const [machine, setMachine] = useState(emptyMachine);
  const [year, setYear] = useState("");
  const [serial, setSerial] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      garage.setData(
        await api<Vehicle[]>("/garage", {
          body: {
            model_id: machine.modelId,
            modification_id: machine.modificationId,
            year: year ? Number(year) : null,
            serial_number: serial || null,
            title,
          },
        }),
      );
      setMachine(emptyMachine);
      setYear("");
      setSerial("");
      setTitle("");
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Удалить технику из гаража?")) return;
    garage.setData(await api<Vehicle[]>(`/garage/${id}`, { method: "DELETE" }));
  };

  return (
    <div className="grid grid-2">
      <section>
        <h1>Мой гараж</h1>
        <p className="muted">Добавьте технику один раз — поиск будет показывать только подходящие детали.</p>
        {garage.loading && !garage.data ? (
          <Spinner />
        ) : garage.data?.length === 0 ? (
          <Empty>В гараже пока пусто</Empty>
        ) : (
          garage.data?.map((v) => {
            const m3d = models3d.data?.find((m) => m.machine_model_id === v.model_id);
            return (
              <div key={v.id} className="card">
                <div className="row-between">
                  <div>
                    <h3 style={{ margin: 0 }}>{v.title || v.model}</h3>
                    <div className="muted small">
                      {v.model}
                      {v.modification && `, ${v.modification}`}
                      {v.year && `, ${v.year} г.`}
                      {v.serial_number && ` · № ${v.serial_number}`}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(v.id)}>
                    Удалить
                  </button>
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <Link className="btn btn-primary btn-sm" to={`/search?vehicle=${v.id}`}>
                    Подходящие запчасти
                  </Link>
                  {m3d && (
                    <Link className="btn btn-sm" to={`/catalog3d/${m3d.id}`}>
                      Открыть 3D-модель
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>
      <section className="card">
        <h2>Добавить технику</h2>
        {brands.data && (
          <form className="stack" onSubmit={add}>
            <MachinePicker brands={brands.data} value={machine} onChange={setMachine} />
            <div className="grid grid-2">
              <label className="field">
                <span>Год выпуска</span>
                <input type="number" min={1950} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
              </label>
              <label className="field">
                <span>Серийный номер</span>
                <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="необязательно" />
              </label>
            </div>
            <label className="field">
              <span>Как называть</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="например, «Дон №2 на втором отделении»" />
            </label>
            <ErrorBox error={error} />
            <button className="btn btn-primary" disabled={!machine.modelId}>
              Добавить в гараж
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
