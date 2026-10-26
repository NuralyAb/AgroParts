import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface CartItem {
  offer_id: number;
  part_id: number | null;
  title: string;
  price: number;
  qty: number;
  shop_id: number;
  shop_name: string;
  available: number | null; // null — неизвестно (повторный заказ), проверится при оформлении
}

interface CartState {
  items: CartItem[];
  count: number;
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (offerId: number, qty: number) => void;
  remove: (offerId: number) => void;
  removeMany: (offerIds: number[]) => void;
  has: (offerId: number) => boolean;
}

const KEY = "agroparts.cart";
const Ctx = createContext<CartState | null>(null);

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items]);

  const value: CartState = {
    items,
    count: items.reduce((s, i) => s + i.qty, 0),
    add: (item, qty = 1) =>
      setItems((prev) => {
        const existing = prev.find((i) => i.offer_id === item.offer_id);
        if (existing) return prev.map((i) => (i.offer_id === item.offer_id ? { ...i, ...item, qty: i.qty + qty } : i));
        return [...prev, { ...item, qty }];
      }),
    setQty: (offerId, qty) =>
      setItems((prev) => prev.map((i) => (i.offer_id === offerId ? { ...i, qty: Math.max(1, qty) } : i))),
    remove: (offerId) => setItems((prev) => prev.filter((i) => i.offer_id !== offerId)),
    removeMany: (ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.offer_id))),
    has: (offerId) => items.some((i) => i.offer_id === offerId),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error("CartProvider missing");
  return v;
}
