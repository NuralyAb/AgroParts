import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { isCatalogEditor, useAuth } from "./auth";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Cart from "./pages/Cart";
import Favorites from "./pages/Favorites";
import Garage from "./pages/Garage";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Orders from "./pages/Orders";
import PartPage from "./pages/PartPage";
import Search from "./pages/Search";
import Catalog3DList from "./pages/Catalog3DList";

// Тяжёлые разделы грузятся отдельно: three.js нужен только в 3D-каталоге.
const Viewer3D = lazy(() => import("./pages/Viewer3D"));
const ShopCabinet = lazy(() => import("./pages/shop/ShopCabinet"));
const Admin = lazy(() => import("./pages/admin/Admin"));
const RenderPart = lazy(() => import("./pages/RenderPart"));

function RequireAuth({ children, editor = false }: { children: ReactNode; editor?: boolean }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (editor && !isCatalogEditor(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="render" element={<RenderPart />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="parts/:id" element={<PartPage />} />
          <Route path="cart" element={<Cart />} />
          <Route path="login" element={<Login />} />
          <Route path="catalog3d" element={<Catalog3DList />} />
          <Route path="catalog3d/:id" element={<Viewer3D />} />
          <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="garage" element={<RequireAuth><Garage /></RequireAuth>} />
          <Route path="favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
          <Route path="shop/*" element={<RequireAuth><ShopCabinet /></RequireAuth>} />
          <Route path="admin/*" element={<RequireAuth editor><Admin /></RequireAuth>} />
          <Route path="*" element={<div className="empty">Страница не найдена</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
