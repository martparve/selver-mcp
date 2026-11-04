// Store-agnostic shapes shared by every store adapter and the MCP tools.

export const STORE_IDS = ['selver', 'rimi', 'barbora'] as const;
export type StoreId = typeof STORE_IDS[number];

export interface NutritionPer100g {
  /** What the values are per: 100 g or 100 ml. null when the store does not say. */
  per: '100g' | '100ml' | null;
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** "millest küllastunud rasvhapped". null when the store does not list it. */
  saturated_fat_g: number | null;
  sugars_g: number;
  /** Dietary fibre. null when the store does not list it (Selver never does). */
  fibre_g: number | null;
  salt_g: number;
}

export interface AlcoholInfo {
  /** Alcohol by volume in percent; 0 for alcohol-free variants; null when only the type is known. */
  abv_pct: number | null;
  /** Store's own label, e.g. "Hele õlu 6,7%". null when the store gives only a percentage. */
  type: string | null;
}

/** Machine-friendly dietary tags, mapped from each store's own labels. */
export type DietaryTag = 'vegan' | 'gluten_free' | 'lactose_free' | 'sugar_free' | 'no_added_sugar' | 'organic';

/**
 * Longer product information. Returned by get_products, and by search_products only with details: true,
 * so that ordinary searches stay compact.
 */
export interface ProductDetails {
  /** Ingredient list as plain text (store markup and boilerplate disclaimers removed). */
  ingredients: string | null;
  /**
   * Words the store marks as allergens inside the ingredient list (bold or CAPITALS, as EU labelling requires).
   * Heuristic: always tell the user to check the package.
   */
  allergens_marked: string[];
  /** Extra nutrition lines such as vitamins and minerals, e.g. "Kaltsium 121 mg (15%*)". */
  nutrition_extra: string | null;
  warnings: string | null;
  storage: string | null;
  manufacturer: string | null;
  description: string | null;
  ean: string | null;
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
  /**
   * The store's allergen field; when that is empty, the allergen words marked in the ingredient list
   * (see details.allergens_marked), comma-separated. null when neither is known.
   */
  allergens: string | null;
  age_restricted: boolean;
  /** Set for alcoholic drinks when the store says so (Selver alcohol type, Rimi product page). */
  alcohol: AlcoholInfo | null;
  dietary: DietaryTag[];
  brand: string | null;
  country_of_origin: string | null;
  url: string;
  details?: ProductDetails;
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
  /** Products by SKU, including details. */
  getProducts(skus: string[]): Promise<Product[]>;
  /**
   * Fill in `details` (and nutrition etc.) for search results that do not carry them yet.
   * Optional: stores whose search already returns full records (Selver) do not need it.
   */
  enrichDetails?(products: Product[]): Promise<Product[]>;
  cart: ServerCartApi | BrowserCartApi;
  /** Store-specific data a browser op needs for a SKU (looked up from the adapter's cache). */
  opMeta?(sku: string): Record<string, unknown> | undefined;
}
