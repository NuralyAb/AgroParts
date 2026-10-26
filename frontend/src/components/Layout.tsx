import { Box, Heart, LogIn, LogOut, MapPin, Package, Shield, ShoppingCart, Store, Tractor, Truck, Wheat } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useFetch } from "../api";
import { isCatalogEditor, useAuth } from "../auth";
import { useCart } from "../cart";
import { useI18n } from "../i18n";
import type { Category } from "../types";
import { CategoryIcon } from "./icons";
import SearchBox from "./SearchBox";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="AgroParts — на главную">
      <span className="logo-mark">
        <Wheat size={21} strokeWidth={2.4} />
      </span>
      <span>
        AgroParts
        <small>запчасти для сельхозтехники</small>
      </span>
    </Link>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const categories = useFetch<Category[]>("/catalog/categories");
  const onSearch = location.pathname === "/search";
  const activeCat = onSearch ? params.get("category_id") : null;
  const isHome = location.pathname === "/";

  const iconLink = (to: string, Icon: typeof Box, label: string, badge?: number) => (
    <NavLink to={to} className={({ isActive }) => `icon-link ${isActive ? "active" : ""}`}>
      <Icon size={21} strokeWidth={1.9} />
      <span className="lbl">{label}</span>
      {badge ? <span className="count">{badge}</span> : null}
    </NavLink>
  );

  return (
    <>
      <div className="topbar">
        <div className="container">
          <span>
            <MapPin size={14} /> Костанай и область
          </span>
          <span className="hide-sm">
            <Store size={14} /> Наличие в магазинах города в реальном времени
          </span>
          <span className="hide-sm">
            <Truck size={14} /> Самовывоз и доставка в районы
          </span>
          <span className="spacer" />
          <div className="lang-switch" role="group" aria-label="Язык">
            <button className={lang === "ru" ? "on" : ""} onClick={() => setLang("ru")}>
              РУС
            </button>
            <button className={lang === "kk" ? "on" : ""} onClick={() => setLang("kk")}>
              ҚАЗ
            </button>
          </div>
        </div>
      </div>
      <header className="header">
        <div className="container header-row">
          <Logo />
          {!isHome && <SearchBox key={location.pathname} initial={onSearch ? params.get("q") ?? "" : ""} />}
          <nav className="header-actions">
            {iconLink("/catalog3d", Box, t("nav.3d"))}
            {user && iconLink("/garage", Tractor, t("nav.garage"))}
            {user && iconLink("/orders", Package, t("nav.orders"))}
            {user && iconLink("/favorites", Heart, t("nav.favorites"))}
            {iconLink("/cart", ShoppingCart, t("nav.cart"), count)}
            {user && iconLink("/shop", Store, "Магазин")}
            {isCatalogEditor(user) && iconLink("/admin", Shield, "Админ")}
            {user ? (
              <button
                className="icon-link"
                title={`${user.name} · ${user.phone}`}
                onClick={() => {
                  logout();
                  navigate("/");
                }}
              >
                <LogOut size={21} strokeWidth={1.9} />
                <span className="lbl">{t("nav.logout")}</span>
              </button>
            ) : (
              iconLink(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, LogIn, t("nav.login"))
            )}
          </nav>
        </div>
        <div className="catnav">
          <div className="container">
            <NavLink to="/search" end className={() => (onSearch && !activeCat ? "active" : "")}>
              <Package size={16} /> Все запчасти
            </NavLink>
            {categories.data?.map((c) => (
              <Link key={c.id} to={`/search?category_id=${c.id}`} className={activeCat === String(c.id) ? "active" : ""}>
                <CategoryIcon name={c.name} size={16} /> {c.name}
              </Link>
            ))}
          </div>
        </div>
      </header>
      <main className="container page">
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="logo">
                <span className="logo-mark">
                  <Wheat size={21} strokeWidth={2.4} />
                </span>
                AgroParts
              </div>
              <p>Единый каталог запчастей для сельхозтехники: цены и реальное наличие во всех магазинах Костаная.</p>
            </div>
            <div>
              <h4>Покупателям</h4>
              <Link to="/search">Каталог запчастей</Link>
              <Link to="/catalog3d">3D-каталог техники</Link>
              <Link to="/garage">Мой гараж</Link>
            </div>
            <div>
              <h4>Магазинам</h4>
              <Link to="/shop">Подключить магазин</Link>
              <Link to="/shop">Склад, касса и CRM</Link>
              <a href="/api/integrations/import-template.csv">Шаблон для загрузки прайса</a>
            </div>
          </div>
          <div className="fine">
            Демо-версия: магазины, цены и остатки вымышленные. Изображения запчастей и техники — 3D-модели AgroParts;
            внешний вид у продавцов может отличаться.
          </div>
        </div>
      </footer>
    </>
  );
}
