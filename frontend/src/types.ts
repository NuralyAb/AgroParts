import type { PartRender } from "./three/parts";

export type Role = "buyer" | "admin" | "content_manager";

export interface Me {
  id: number;
  phone: string;
  name: string;
  email: string | null;
  role: Role;
  locale: "ru" | "kk";
  shops: { id: number; name: string; role: "owner" | "staff"; status: ShopStatus }[];
}

export type ShopStatus = "pending" | "verified" | "blocked";

export interface Modification {
  id: number;
  name: string;
  year_from: number | null;
  year_to: number | null;
}
export interface ImageCredit {
  title: string;
  author: string;
  license: string;
  license_url: string;
  source_url: string;
}

export interface MachineModel {
  id: number;
  name: string;
  kind: "combine" | "tractor" | "seeder" | "other";
  image_url: string | null;
  image_credit: ImageCredit | null;
  modifications: Modification[];
}
export interface Brand {
  id: number;
  name: string;
  models: MachineModel[];
}
export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  count: number;
  image_url: string | null;
}

export interface OffersSummary {
  offers: number;
  in_stock_offers: number;
  min_price: number | null;
  available: number;
}

export interface PartBrief {
  id: number;
  name: string;
  oem: string | null;
  numbers: string[];
  image_url: string | null;
  category_id: number | null;
  category: string | null;
  summary: OffersSummary;
  score?: number;
}

export interface SearchResponse {
  items: PartBrief[];
  total: number;
  corrected_query: string | null;
  facets: { categories: { id: number; name: string; count: number }[] };
  sort: string;
}

export interface AnalogBrief extends PartBrief {
  analog_link_id: number;
  source: string;
  verified: boolean;
  note: string;
}

export interface CompatRow {
  id: number;
  model_id: number;
  model: string;
  modification_id: number | null;
  modification: string | null;
  year_from: number | null;
  year_to: number | null;
  source: string;
  verified: boolean;
  note: string;
}

export interface PublicOffer {
  offer_id: number;
  shop: { id: number; name: string; city: string; address: string; phone: string; delivery_available: boolean };
  title: string;
  manufacturer: string | null;
  condition: string;
  price: number;
  available: number;
  stock_mode: "tracked" | "manual";
  stock_updated_at: string;
  warehouses: { name: string; address: string; available: number }[];
}

export interface PartDetail {
  id: number;
  name: string;
  description: string;
  category: string | null;
  category_id: number | null;
  specs: Record<string, string | number>;
  image_url: string | null;
  image_credit: ImageCredit | null;
  render: PartRender | null;
  numbers: { id: number; kind: "oem" | "manufacturer"; manufacturer: string | null; number: string }[];
  compatibility: CompatRow[];
  analogs: AnalogBrief[];
  offers: PublicOffer[];
  on_3d_models: { model3d_id: number; component_key: string; title: string }[];
}

export type OrderStatus = "pending" | "confirmed" | "ready" | "issued" | "cancelled";

export interface Order {
  id: number;
  number: string;
  channel: "marketplace" | "phone" | "pos";
  status: OrderStatus;
  payment_mode: "on_pickup" | "online";
  payment_status: "unpaid" | "paid" | "refund_pending";
  total: number;
  pickup_code: string | null;
  comment: string;
  cancel_reason: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  shop: { id: number; name: string; address: string; phone: string };
  customer: { id: number; name: string; phone: string | null } | null;
  items: { id: number; offer_id: number; part_id: number | null; title: string; sku: string; price: number; qty: number }[];
  events?: { from: string | null; to: OrderStatus; note: string; user_id: number | null; created_at: string }[];
}

export interface Vehicle {
  id: number;
  title: string;
  model_id: number;
  model: string;
  kind: string;
  modification_id: number | null;
  modification: string | null;
  year: number | null;
  serial_number: string | null;
}

export interface StockRow {
  id: number;
  warehouse_id: number;
  warehouse: string;
  on_hand: number;
  reserved: number;
  available: number;
  bin_location: string | null;
  updated_at: string;
}

export interface ShopOffer {
  id: number;
  sku: string;
  title: string;
  article: string | null;
  manufacturer: string | null;
  price: number;
  condition: string;
  is_active: boolean;
  stock_mode: "tracked" | "manual";
  match_status: "matched" | "review" | "unmatched";
  part: { id: number; name: string } | null;
  on_hand: number;
  reserved: number;
  available: number;
  updated_at: string;
  stocks: StockRow[];
}

export interface ShopPrivate {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string;
  description: string;
  delivery_available: boolean;
  status: ShopStatus;
  code: string;
  bin: string | null;
  has_api_key: boolean;
  warehouses: { id: number; name: string; address: string; is_pickup_point: boolean }[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  farm: string | null;
  note: string;
  from_marketplace: boolean;
  created_at: string;
  orders: number;
  spent: number;
  last_order_at: string | null;
}

export interface Movement {
  id: number;
  kind: string;
  sku: string;
  title: string;
  on_hand_delta: number;
  reserved_delta: number;
  on_hand_after: number;
  reserved_after: number;
  order_id: number | null;
  user: string | null;
  note: string;
  created_at: string;
}

export interface ImportReport {
  rows: number;
  created: number;
  updated: number;
  matched: number;
  review: number;
  errors: { row: number; error: string }[];
  dry_run: boolean;
}

export interface Model3DBrief {
  id: number;
  title: string;
  machine_model_id: number;
  brand: string;
  model: string;
  kind: string;
  has_glb: boolean;
}

export interface Geometry {
  shape: "box" | "cylinder" | "torus" | "wheel" | "reel";
  material?: "paint" | "dark" | "metal" | "rubber" | "glass";
  size: number[];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
}

export interface ModelComponent {
  id: number;
  key: string;
  name: string;
  assembly: string;
  geometry: Geometry;
  explode: [number, number, number];
  is_shell: boolean;
  part: PartBrief | null;
}

export interface Model3D {
  id: number;
  title: string;
  glb_url: string | null;
  machine_model_id: number;
  brand: string;
  model: string;
  components: ModelComponent[];
}
