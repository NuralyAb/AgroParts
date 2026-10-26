import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { errorText } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Tabs } from "../components/ui";

const DEMO = [
  ["Фермер", "+77000000100"],
  ["Продавец магазина 1", "+77000000011"],
  ["Администратор", "+77000000001"],
  ["Контент-менеджер", "+77000000002"],
];

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(phone, password);
      else await register({ phone, password, name });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      <section className="card">
        <Tabs
          tabs={[
            { id: "login", label: "Вход" },
            { id: "register", label: "Регистрация" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <form className="stack" onSubmit={submit}>
          {mode === "register" && (
            <label className="field">
              <span>Имя или название хозяйства</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span>Телефон</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" required inputMode="tel" autoComplete="tel" />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 6 : 1}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
      </section>
      {import.meta.env.DEV && (
        <section className="card">
          <h3>Демо-аккаунты</h3>
          <p className="small muted">Пароль у всех: demo1234</p>
          <div className="chips">
            {DEMO.map(([label, p]) => (
              <button
                key={p}
                className="chip"
                onClick={() => {
                  setMode("login");
                  setPhone(p);
                  setPassword("demo1234");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
