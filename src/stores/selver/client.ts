import type { SelverRawProduct, SelverSearchResponse, ApiEnvelope, StockInfo, CartWriteResult } from './types.js';
import type {
  Product, SearchResult, SearchSort, CartItem, CartTotals, PutCartItemResult, PutMode,
  StoreAdapter, ServerCartApi,
} from '../../core/types.js';
import { klevuSearch, type KlevuRecord } from './klevu.js';
import { parseNutrition, parseKlevuCategory, parseEsCategory, deriveUnitPricePer, resolveQtyRules } from './parser.js';
import { snapQty, round2 } from '../../core/qty.js';
import { browserSyncInstructions, removeScript } from './sync-script.js';

const BASE_URL = 'https://www.selver.ee';
const CATALOG_URL = `${BASE_URL}/api/catalog/vue_storefront_catalog_et`;
const STOCK_URL = `${BASE_URL}/api/stock/list`;
const CART_API = `${BASE_URL}/api/cart`;

export const MAX_SEARCH_LIMIT = 30;

function cartUrl(action: string, token: string): string {
  return `${CART_API}/${action}?token=${encodeURIComponent(token)}&cartId=${encodeURIComponent(token)}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
}

function isExpiredToken(code: number, result: unknown): boolean {
  return code === 404 && typeof result === 'string' && /no such entity/i.test(result);
}

export function buildProduct(raw: SelverRawProduct | undefined, klevu: KlevuRecord | undefined, stock: StockInfo | undefined): Product {
  const sku = raw?.sku ?? klevu?.sku ?? '';
  const name = raw?.name ?? klevu?.name ?? '';
  const klevuPrice = klevu?.salePrice ? parseFloat(klevu.salePrice) : NaN;
  const klevuOrig = klevu?.price ? parseFloat(klevu.price) : NaN;
  const price = round2(raw?.final_price_incl_tax ?? raw?.price_incl_tax ?? (Number.isFinite(klevuPrice) ? klevuPrice : 0));
  const origRaw = raw?.original_price_incl_tax ?? (Number.isFinite(klevuOrig) ? klevuOrig : undefined);
  const original_price = origRaw !== undefined && round2(origRaw) > price ? round2(origRaw) : null;
  const discount_pct = original_price ? Math.round((1 - price / original_price) * 100) : null;
  const rules = resolveQtyRules(raw, stock);
  const in_stock: boolean | null = stock ? stock.in_stock : klevu ? klevu.inStock === 'yes' : null;
  const url_path = raw?.url_path ?? raw?.slug;
  const url = url_path ? `${BASE_URL}/${url_path}` : (klevu?.url ?? `${BASE_URL}/otsing?q=${encodeURIComponent(sku)}`);
  return {
    store: 'selver',
    sku,
    name,
    price,
    original_price,
    discount_pct,
    unit_price: raw?.unit_price ?? null,
    unit_price_per: raw?.unit_price != null ? deriveUnitPricePer(raw?.product_volume, name) : null,
    volume: raw?.product_volume ?? null,
    ...rules,
    in_stock,
    category: parseKlevuCategory(klevu?.klevu_category) ?? (raw ? parseEsCategory(raw) : null),
    nutrition: raw ? parseNutrition(raw) : null,
    allergens: raw?.product_allergens ?? null,
    age_restricted: raw?.product_age_restricted ?? false,
    url,
  };
}

export class SelverClient implements StoreAdapter {
  readonly id = 'selver' as const;
  readonly name = 'Selver';
  readonly homeUrl = BASE_URL;
  readonly cartUrl = `${BASE_URL}/cart`;

  readonly cart: ServerCartApi = {
    kind: 'server',
    create: () => this.createCart(),
    getItems: (token) => this.getCart(token),
    getTotals: (token) => this.getTotals(token),
    putItem: (token, sku, qty, mode, product, existing) => this.putCartItem(token, sku, qty, mode, product, existing),
    deleteItem: (token, sku, itemId) => this.deleteCartItem(token, sku, Number(itemId)),
    browserSync: (token) => browserSyncInstructions(token),
    removeScript: (skus) => removeScript(skus),
  };

  // ---------- catalog ----------

  async searchProducts(query: string, limit = 15, sort: SearchSort = 'relevance'): Promise<SearchResult> {
    const size = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit)));
    let klevuRecords: KlevuRecord[] | null = null;
    let total = 0;
    try {
      const k = await klevuSearch(query, size, sort);
      klevuRecords = k.records;
      total = k.total;
    } catch {
      klevuRecords = null;
    }

    if (klevuRecords) {
      const skus = klevuRecords.map(r => r.sku);
      const rawBySku = await this.catalogBySku(skus);
      // Stock must only be asked about SKUs the catalog knows: one unknown SKU 404s the whole call.
      const stockByPid = await this.stockBySku(skus.filter(s => rawBySku.has(s)));
      const products = klevuRecords.map(k => {
        const raw = rawBySku.get(k.sku);
        return buildProduct(raw, k, raw?.stock?.product_id != null ? stockByPid.get(raw.stock.product_id) : undefined);
      });
      return { store: 'selver', query, source: 'klevu', total, products };
    }

    // Fallback: Vue Storefront Elasticsearch proxy (worse ranking, but independent of Klevu).
    const data = await this.esQueryString(query, size);
    const raws = (data.hits?.hits ?? []).map(h => h._source);
    const t = data.hits?.total;
    total = typeof t === 'number' ? t : t?.value ?? raws.length;
    const stockByPid = await this.stockBySku(raws.map(r => r.sku));
    const products = raws.map(raw => buildProduct(raw, undefined, raw.stock?.product_id != null ? stockByPid.get(raw.stock.product_id) : undefined));
    return { store: 'selver', query, source: 'elasticsearch', total, products };
  }

  async getProducts(skus: string[]): Promise<Product[]> {
    if (skus.length === 0) return [];
    const rawBySku = await this.catalogBySku(skus);
    const stockByPid = await this.stockBySku(skus.filter(s => rawBySku.has(s)));
    return skus
      .filter(sku => rawBySku.has(sku))
      .map(sku => {
        const raw = rawBySku.get(sku)!;
        return buildProduct(raw, undefined, raw.stock?.product_id != null ? stockByPid.get(raw.stock.product_id) : undefined);
      });
  }

  private async esQueryString(query: string, size: number): Promise<SelverSearchResponse> {
    const url = `${CATALOG_URL}/product/_search?q=${encodeURIComponent(query)}&size=${size}`;
    const res = await fetch(url);
    return readJson<SelverSearchResponse>(res);
  }

  /** Full catalog records for a SKU list (nutrition, unit price, discount, weight step). */
  async catalogBySku(skus: string[]): Promise<Map<string, SelverRawProduct>> {
    const map = new Map<string, SelverRawProduct>();
    if (skus.length === 0) return map;
    try {
      const res = await fetch(`${CATALOG_URL}/product/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { terms: { sku: skus } }, size: skus.length }),
      });
      const data = await readJson<SelverSearchResponse>(res);
      for (const h of data.hits?.hits ?? []) map.set(h._source.sku, h._source);
    } catch {
      // Hydration is best-effort; callers fall back to Klevu data.
    }
    return map;
  }

  /** Live stock. The endpoint returns no SKU, only product_id, so the map is keyed by product_id. */
  async stockBySku(skus: string[]): Promise<Map<number, StockInfo>> {
    const map = new Map<number, StockInfo>();
    if (skus.length === 0) return map;
    try {
      // Selver splits on a literal comma; an encoded %2C makes the whole lookup return nothing.
      const res = await fetch(`${STOCK_URL}?skus=${skus.map(encodeURIComponent).join(',')}`);
      const data = await readJson<ApiEnvelope<Array<Record<string, unknown>>>>(res);
      if (data.code !== 200 || !Array.isArray(data.result)) return map;
      for (const s of data.result) {
        const pid = Number(s.product_id);
        if (!Number.isFinite(pid)) continue;
        map.set(pid, {
          product_id: pid,
          in_stock: Boolean(s.is_in_stock),
          is_qty_decimal: Boolean(s.is_qty_decimal),
          min_sale_qty: Number(s.min_sale_qty ?? 0),
          qty_increments: Number(s.qty_increments ?? 0),
          enable_qty_increments: Boolean(s.enable_qty_increments),
          max_sale_qty: Number(s.max_sale_qty ?? 0),
        });
      }
    } catch {
      // Stock is best-effort.
    }
    return map;
  }

  // ---------- cart ----------

  async createCart(): Promise<string | null> {
    try {
      const res = await fetch(`${CART_API}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await readJson<ApiEnvelope<unknown>>(res);
      return data.code === 200 && typeof data.result === 'string' ? data.result : null;
    } catch {
      return null;
    }
  }

  async getCart(token: string): Promise<CartItem[] | null> {
    try {
      const res = await fetch(cartUrl('pull', token));
      const data = await readJson<ApiEnvelope<unknown>>(res);
      if (isExpiredToken(data.code, data.result)) return null;
      if (data.code !== 200 || !Array.isArray(data.result)) return [];
      return (data.result as Array<Record<string, unknown>>).map(item => ({
        item_id: Number(item.item_id),
        sku: String(item.sku),
        name: String(item.name ?? ''),
        qty: Number(item.qty),
        price_excl_tax: Number(item.price ?? 0),
      }));
    } catch {
      return [];
    }
  }

  async getTotals(token: string): Promise<CartTotals | null> {
    try {
      const res = await fetch(cartUrl('totals', token));
      const data = await readJson<ApiEnvelope<Record<string, any>>>(res);
      if (data.code !== 200 || !data.result) return null;
      const r = data.result;
      const segment = (code: string): number => {
        const seg = (r.total_segments ?? []).find((s: { code: string }) => s.code === code);
        return seg ? Number(seg.value ?? 0) : 0;
      };
      return {
        grand_total: round2(Number(r.grand_total ?? 0)),
        subtotal_incl_tax: round2(Number(r.subtotal_incl_tax ?? 0)),
        packaging_fee: round2(segment('packaging')),
        shipping_incl_tax: round2(Number(r.shipping_incl_tax ?? 0)),
        discount_amount: round2(Math.abs(Number(r.discount_amount ?? 0))),
        items_qty: Number(r.items_qty ?? 0),
        items: (r.items ?? []).map((i: Record<string, unknown>) => ({
          item_id: Number(i.item_id),
          name: String(i.name ?? ''),
          qty: Number(i.qty),
          price_incl_tax: round2(Number(i.price_incl_tax ?? 0)),
          row_total_incl_tax: round2(Number(i.row_total_incl_tax ?? 0)),
          discount_amount: round2(Math.abs(Number(i.discount_amount ?? 0))),
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Low-level write. Without item_id Selver ADDS qty to any existing line; with item_id it SETS qty.
   */
  async updateCartItem(token: string, sku: string, qty: number, itemId?: number): Promise<CartWriteResult> {
    try {
      const cartItem: Record<string, unknown> = { sku, qty, quoteId: token };
      if (itemId !== undefined) cartItem.item_id = itemId;
      const res = await fetch(cartUrl('update', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItem }),
      });
      const data = await readJson<ApiEnvelope<unknown>>(res);
      if (data.code === 200) {
        const r = (data.result ?? {}) as Record<string, unknown>;
        return {
          ok: true, code: 200,
          item: { item_id: Number(r.item_id), sku: String(r.sku ?? sku), qty: Number(r.qty ?? qty), name: String(r.name ?? '') },
        };
      }
      const msg = typeof data.result === 'string' ? data.result : `HTTP ${data.code}`;
      return { ok: false, code: data.code, error: msg, expired_token: isExpiredToken(data.code, data.result) };
    } catch (e) {
      return { ok: false, code: 0, error: (e as Error).message };
    }
  }

  async deleteCartItem(token: string, sku: string, itemId: number): Promise<boolean> {
    try {
      const res = await fetch(cartUrl('delete', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItem: { sku, item_id: itemId, quoteId: token } }),
      });
      const data = await readJson<ApiEnvelope<unknown>>(res);
      return data.code === 200;
    } catch {
      return false;
    }
  }

  /**
   * Put a line in the cart with correct quantity semantics.
   * mode 'set' makes the line exactly `requestedQty`; mode 'add' increases it by `requestedQty`.
   * Quantity is snapped to the product's step (e.g. 0.3 kg) before sending, and the write is
   * verified by reading the cart back (Selver occasionally returns 200 without persisting).
   */
  async putCartItem(
    token: string,
    sku: string,
    requestedQty: number,
    mode: PutMode,
    product: Product | undefined,
    existing: CartItem | undefined,
  ): Promise<PutCartItemResult> {
    const step = product?.qty_step ?? 1;
    const min = product?.min_qty ?? step;
    const base = mode === 'add' && existing ? existing.qty : 0;
    const snapped = snapQty(base + requestedQty, step, min);
    const targetQty = snapped.qty;
    const adjusted = Math.abs(targetQty - (base + requestedQty)) > 1e-6;

    const attempt = () => this.updateCartItem(token, sku, targetQty, existing ? Number(existing.item_id) : undefined);
    const verify = async (): Promise<boolean> => {
      const items = await this.getCart(token);
      return !!items && items.some(i => i.sku === sku && Math.abs(i.qty - targetQty) < 1e-4);
    };

    let last = await attempt();
    if (!last.ok) {
      return { ok: false, sku, name: product?.name, requested_qty: requestedQty, error: last.error, expired_token: last.expired_token };
    }
    if (!(await verify())) {
      last = await attempt();
      if (!last.ok) {
        return { ok: false, sku, name: product?.name, requested_qty: requestedQty, error: last.error, expired_token: last.expired_token };
      }
      if (!(await verify())) {
        return { ok: false, sku, name: product?.name, requested_qty: requestedQty, error: 'Server accepted the item but it is not in the cart after a retry' };
      }
    }
    return { ok: true, sku, name: last.item?.name || product?.name, requested_qty: requestedQty, qty: targetQty, qty_adjusted: adjusted };
  }
}
