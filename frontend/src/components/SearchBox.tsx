import { Clock, CornerDownLeft, FolderOpen, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, qs } from "../api";
import { money } from "../format";
import { useI18n } from "../i18n";
import type { PartBrief } from "../types";
import { MachineIcon } from "./icons";
import { PartImage } from "./ProductCard";

interface Suggest {
  query: string;
  corrected_query: string | null;
  parts: PartBrief[];
  total: number;
  models: { id: number; title: string; kind: string }[];
  categories: { id: number; name: string }[];
}

interface Option {
  key: string;
  href: string;
  label?: string; // для истории поиска
}

const RECENT_KEY = "agroparts.recent";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function rememberQuery(q: string) {
  const v = q.trim();
  if (v.length < 2) return;
  try {
    const next = [v, ...loadRecent().filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Подсвечивает совпадения: слова запроса и их начала (для падежей — без последних букв). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const stems = query
      .toLowerCase()
      .split(/[^0-9a-zа-яё]+/i)
      .filter((w) => w.length >= 2)
      .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!stems.length) return [text];
    const re = new RegExp(`(${stems.join("|")})`, "gi");
    return text.split(re);
  }, [text, query]);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

export default function SearchBox({ initial = "", big = false, autoFocus = false }: { initial?: string; big?: boolean; autoFocus?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [data, setData] = useState<Suggest | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const root = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => setQ(initial), [initial]);

  // Подсказки с задержкой 150 мс; устаревшие ответы отбрасываются.
  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) {
      setData(null);
      return;
    }
    const my = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const d = await api<Suggest>(`/catalog/suggest${qs({ q: v })}`);
        if (my === seq.current) {
          setData(d);
          setActive(-1);
        }
      } catch {
        /* подсказки не критичны */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const showRecent = q.trim().length < 2 && recent.length > 0;
  const options: Option[] = useMemo(() => {
    if (showRecent) return recent.map((r) => ({ key: `r:${r}`, href: `/search?q=${encodeURIComponent(r)}`, label: r }));
    if (!data) return [];
    const eff = data.corrected_query ?? data.query;
    return [
      ...data.models.map((m) => ({ key: `m:${m.id}`, href: `/search?model_id=${m.id}` })),
      ...data.categories.map((c) => ({ key: `c:${c.id}`, href: `/search?category_id=${c.id}` })),
      ...data.parts.map((p) => ({ key: `p:${p.id}`, href: `/parts/${p.id}` })),
      { key: "all", href: `/search?q=${encodeURIComponent(eff)}` },
    ];
  }, [data, showRecent, recent]);

  const go = (href: string, query?: string) => {
    if (query) rememberQuery(query);
    setRecent(loadRecent());
    setOpen(false);
    navigate(href);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (active >= 0 && options[active]) {
      go(options[active].href, options[active].label ?? q);
      return;
    }
    go(`/search?q=${encodeURIComponent(q.trim())}`, q);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const opt = (key: string, href: string, children: ReactNode, className = "") => {
    const i = options.findIndex((o) => o.key === key);
    return (
      <a
        key={key}
        href={href}
        className={`opt ${className} ${i === active ? "on" : ""}`}
        onMouseEnter={() => setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          go(href, options[i]?.label ?? q);
        }}
      >
        {children}
      </a>
    );
  };

  const hasResults = data && (data.parts.length || data.models.length || data.categories.length);
  const showPanel = open && (showRecent || (q.trim().length >= 2 && data));

  return (
    <div className={`searchbox ${big ? "big" : ""}`} ref={root}>
      <form onSubmit={submit} role="search">
        <span className="lead">
          <Search size={big ? 22 : 18} />
        </span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={t("search.placeholder")}
          aria-label="Поиск запчастей"
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {q && (
          <button type="button" className="clear" onClick={() => setQ("")} aria-label="Очистить">
            <X size={16} />
          </button>
        )}
        <button className="go">{t("search.button")}</button>
      </form>

      {showPanel && (
        <div className="suggest" role="listbox">
          {showRecent ? (
            <>
              <div className="group row-between">
                <span>Вы искали</span>
                <button
                  className="link small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    localStorage.removeItem(RECENT_KEY);
                    setRecent([]);
                  }}
                >
                  очистить
                </button>
              </div>
              {recent.map((r) =>
                opt(`r:${r}`, `/search?q=${encodeURIComponent(r)}`, (
                  <>
                    <span className="ico" style={{ background: "var(--surface-3)", color: "var(--muted)" }}>
                      <Clock size={16} />
                    </span>
                    <span className="main title">{r}</span>
                  </>
                )),
              )}
            </>
          ) : data ? (
            <>
              {data.corrected_query && (
                <div className="note">
                  Исправили раскладку: <b>{data.corrected_query}</b>
                </div>
              )}
              {!hasResults && (
                <div className="note">
                  Ничего не нашли по «{data.query}». Проверьте номер или найдите деталь на 3D-модели.
                </div>
              )}
              {data.models.length > 0 && <div className="group">Техника</div>}
              {data.models.map((m) =>
                opt(`m:${m.id}`, `/search?model_id=${m.id}`, (
                  <>
                    <span className="ico">
                      <MachineIcon kind={m.kind} />
                    </span>
                    <span className="main">
                      <div className="title">
                        <Highlight text={m.title} query={data.corrected_query ?? data.query} />
                      </div>
                      <div className="sub" style={{ fontFamily: "inherit" }}>
                        все совместимые запчасти
                      </div>
                    </span>
                  </>
                )),
              )}
              {data.categories.length > 0 && <div className="group">Категории</div>}
              {data.categories.map((c) =>
                opt(`c:${c.id}`, `/search?category_id=${c.id}`, (
                  <>
                    <span className="ico">
                      <FolderOpen size={17} />
                    </span>
                    <span className="main title">{c.name}</span>
                  </>
                )),
              )}
              {data.parts.length > 0 && <div className="group">Запчасти</div>}
              {data.parts.map((p) =>
                opt(`p:${p.id}`, `/parts/${p.id}`, (
                  <>
                    <span className="thumb" style={{ overflow: "hidden" }}>
                      <PartImage part={p} size={20} />
                    </span>
                    <span className="main">
                      <div className="title">
                        <Highlight text={p.name} query={data.corrected_query ?? data.query} />
                      </div>
                      <div className="sub">
                        <Highlight text={p.numbers.join(" · ")} query={data.query} />
                      </div>
                    </span>
                    <span className="price">
                      {p.summary.min_price ? `от ${money(p.summary.min_price)}` : "—"}
                      <small className={p.summary.in_stock_offers ? "" : "none"}>
                        {p.summary.in_stock_offers ? `в ${p.summary.in_stock_offers} маг.` : "нет в наличии"}
                      </small>
                    </span>
                  </>
                )),
              )}
              {hasResults &&
                opt("all", `/search?q=${encodeURIComponent(data.corrected_query ?? data.query)}`, (
                  <>
                    Все результаты ({data.total}) <CornerDownLeft size={15} />
                  </>
                ), "footer-opt")}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
