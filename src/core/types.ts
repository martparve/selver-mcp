// Store-agnostic shapes shared by every store adapter and the MCP tools.

export const STORE_IDS = ['selver', 'rimi', 'barbora'] as const;
export type StoreId = typeof STORE_IDS[number];

export interface NutritionPer100g {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugars_g: number;
  salt_g: number;
}

export type UnitPricePer = 'kg' | 'l' | 'tk';

export interface Product {
  store: StoreId;
  sku: string;
  name: string;
  /** Current price incl. VAT, in EUR. For weight goods this is per kg. */
  price: number;
  /** Price before discount, or null when not discounted. */
  original_price: number | null;
  discount_pct: number | null;
  /** Comparison price (per kg / per litre / per piece). */
  unit_price: number | null;
  unit_price_per: UnitPricePer | null;
  volume: string | null;
  /** qty must be a multiple of this (1 for piece goods, e.g. 0.3 for kg goods). */
  qty_step: number;
  min_qty: number;
  sold_by_weight: boolean;
  /** null = stock service unavailable; let the store decide at add time. */
  in_stock: boolean | null;
  category: string | null;
  nutrition: NutritionPer100g | null;
  allergens: string | null;
  age_restricted: boolean;
  url: string;
}

export type SearchSort = 'relevance' | 'price_asc' | 'price_desc';

export interface SearchResult {
  store: StoreId;
  query: string;
  source: string;
  total: number;
  products: Product[];
}

export interface CartItem {
  item_id: number | string;
  sku: string;
  name: string;
  qty: number;
  /** Unit price excl. VAT when that is all the store's cart API gives; see totals for real prices. */
  price_excl_tax: number;
}

export interface CartTotalsItem {
  item_id: number | string;
  name: string;
  qty: number;
  price_incl_tax: number;
  row_total_incl_tax: number;
  discount_amount: number;
}

export interface CartTotals {
  grand_total: number;
  subtotal_incl_tax: number;
  packaging_fee: number;
  shipping_incl_tax: number;
  discount_amount: number;
  items_qty: number;
  items: CartTotalsItem[];
}

export type PutMode = 'set' | 'add';

export interface PutCartItemResult {
  ok: boolean;
  sku: string;
  name?: string;
  requested_qty: number;
  qty?: number;
  qty_adjusted?: boolean;
  error?: string;
  expired_token?: boolean;
}

export interface BrowserSyncInstructions {
  store: StoreId;
  cart_token: string;
  why: string;
  steps: Array<{ step: number; tool: string; args?: Record<string, unknown>; note: string }>;
  replay_script: string;
  [extra: string]: unknown;
}

/**
 * A store whose cart lives on the store's servers under a token the MCP holds,
 * and which a browser can be pointed at afterwards (Selver model).
 */
export interface ServerCartApi {
  kind: 'server';
  create(): Promise<string | null>;
  /** null = token no longer valid on the store side. */
  getItems(token: string): Promise<CartItem[] | null>;
  getTotals(token: string): Promise<CartTotals | null>;
  putItem(token: string, sku: string, requestedQty: number, mode: PutMode, product: Product | undefined, existing: CartItem | undefined): Promise<PutCartItemResult>;
  deleteItem(token: string, sku: string, itemId: number | string): Promise<boolean>;
  browserSync(token: string): BrowserSyncInstructions;
  removeScript(skus: string[]): string;
}

/** One cart mutation to perform inside the store's own browser tab. qty null = remove the line. */
export interface BrowserCartOp {
  sku: string;
  qty: number | null;
  name?: string;
  /** Store-specific extra data the in-page script needs (e.g. Barbora unit id). */
  meta?: Record<string, unknown>;
}

export interface BrowserCartInstructions {
  store: StoreId;
  kind: 'browser';
  login_required: boolean;
  why: string;
  steps: Array<{ step: number; tool: string; args?: Record<string, unknown>; note: string }>;
  script: string;
  [extra: string]: unknown;
}

/**
 * A store whose cart is bound to the browser session (httpOnly cookies, or login required).
 * The MCP resolves products and quantities, then hands the agent a script to run in that tab.
 */
export interface BrowserCartApi {
  kind: 'browser';
  login_required: boolean;
  /** Script that applies the ops (set qty / remove) and returns the resulting cart. */
  applyScript(ops: BrowserCartOp[]): string;
  /** Script that only reads the cart. */
  readScript(): string;
  /** Script that empties the cart. */
  clearScript(): string;
  instructions(script: string, purpose: string): BrowserCartInstructions;
}

export interface StoreAdapter {
  id: StoreId;
  name: string;
  homeUrl: string;
  cartUrl: string;
  searchProducts(query: string, limit?: number, sort?: SearchSort): Promise<SearchResult>;
  getProducts(skus: string[]): Promise<Product[]>;
  cart: ServerCartApi | BrowserCartApi;
  /** Store-specific data a browser op needs for a SKU (looked up from the adapter's cache). */
  opMeta?(sku: string): Record<string, unknown> | undefined;
}
