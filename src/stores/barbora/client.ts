import type { Product, SearchResult, SearchSort, StoreAdapter, BrowserCartApi, BrowserCartOp, BrowserCartInstructions } from '../../core/types.js';
import { round2, round3 } from '../../core/qty.js';
import { politeGetText } from '../../core/http.js';

export const BARBORA_BASE = 'https://barbora.ee';

export interface BarboraUnit { id: number; price: number; unit: string; min: number; max: number; step: number; defaultValue: number }
export interface BarboraRaw {
  id: string;
  title: string;
  price: number;
  units?: BarboraUnit[];
  promotion?: { oldPrice?: number; percentage?: number; type?: string; loyaltyCardRequired?: boolean } | null;
  comparative_unit_price?: number | null;
  comparative_unit?: string | null;
  status?: string;
  is_adult?: boolean;
  category_name_full_path?: string;
  brand_name?: string;
  Url?: string;
  attributes?: { additional?: Record<string, unknown> };
}

/** Pull the `window.b_productList = [...]` array out of a server-rendered Barbora page. */
export function extractProductList(html: string): BarboraRaw[] {
  const marker = 'window.b_productList = ';
  const i = html.indexOf(marker);
  if (i < 0) return [];
  const start = html.indexOf('[', i);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, k + 1)) as BarboraRaw[];
    }
  }
  return [];
}

export function barboraToProduct(raw: BarboraRaw): Product {
  const unit = raw.units?.find(u => u.unit === 'kg') ?? raw.units?.[0];
  const byWeight = unit?.unit === 'kg';
  const step = unit && unit.step > 0 ? round3(unit.step) : 1;
  const price = round2(unit?.price ?? raw.price);
  const old = raw.promotion?.oldPrice;
  const original_price = old !== undefined && old !== null && round2(old) > price ? round2(old) : null;
  const per = (raw.comparative_unit ?? '').toLowerCase();
  const loyalty = raw.promotion?.loyaltyCardRequired ? ' (loyalty-card price)' : '';
  return {
    store: 'barbora',
    sku: raw.id,
    name: raw.title + loyalty,
    price,
    original_price,
    discount_pct: original_price ? Math.round((1 - price / original_price) * 100) : null,
    unit_price: raw.comparative_unit_price ?? null,
    unit_price_per: per === 'kg' || per === 'l' || per === 'tk' ? per : null,
    volume: byWeight ? 'kg' : null,
    qty_step: step,
    min_qty: unit && unit.min > 0 ? round3(unit.min) : step,
    sold_by_weight: byWeight,
    in_stock: raw.status ? raw.status === 'active' : null,
    category: raw.category_name_full_path ? raw.category_name_full_path.split('/').join(' > ') : null,
    nutrition: null,
    allergens: null,
    age_restricted: Boolean(raw.is_adult),
    url: raw.Url ? `${BARBORA_BASE}/toode/${raw.Url}` : `${BARBORA_BASE}/otsing?q=${encodeURIComponent(raw.id)}`,
  };
}

/**
 * Barbora (Maxima): ASP.NET pages with the product list embedded as JSON. Search is cookie-free.
 * There is no guest cart; the cart needs the logged-in `.BRBAUTH` session, so the browser owns it.
 */
export class BarboraClient implements StoreAdapter {
  readonly id = 'barbora' as const;
  readonly name = 'Barbora';
  readonly homeUrl = BARBORA_BASE;
  readonly cartUrl = `${BARBORA_BASE}/ostukorv`;
  private readonly unitIds = new Map<string, number>();

  private remember(raws: BarboraRaw[]): void {
    for (const r of raws) {
      const u = r.units?.find(x => x.unit === 'kg') ?? r.units?.[0];
      if (u) this.unitIds.set(r.id, u.id);
    }
  }

  private async searchRaw(q: string, page = 1): Promise<BarboraRaw[]> {
    const url = `${BARBORA_BASE}/otsing?q=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ''}`;
    // Barbora rate-limits bursts by answering an empty 200; keep concurrency low and retry with backoff.
    const html = await politeGetText(url, { concurrency: 2, retries: 4, backoffMs: 800, validate: t => t.includes('window.b_productList') });
    const raws = extractProductList(html);
    this.remember(raws);
    return raws;
  }

  async searchProducts(query: string, limit = 15, sort: SearchSort = 'relevance'): Promise<SearchResult> {
    const raws = await this.searchRaw(query);
    let products = raws.map(barboraToProduct);
    if (sort === 'price_asc') products = [...products].sort((a, b) => a.price - b.price);
    if (sort === 'price_desc') products = [...products].sort((a, b) => b.price - a.price);
    return { store: 'barbora', query, source: 'barbora-html', total: raws.length, products: products.slice(0, Math.max(1, limit)) };
  }

  /** Searching for the full 18-digit id returns that product. */
  async getProducts(skus: string[]): Promise<Product[]> {
    const results = await Promise.all(skus.map(async sku => {
      try {
        const raws = await this.searchRaw(sku);
        const hit = raws.find(r => r.id === sku);
        return hit ? barboraToProduct(hit) : null;
      } catch {
        return null;
      }
    }));
    return results.filter((p): p is Product => p !== null);
  }

  opMeta(sku: string): Record<string, unknown> | undefined {
    const unit = this.unitIds.get(sku);
    return unit === undefined ? undefined : { unit };
  }

  readonly cart: BrowserCartApi = {
    kind: 'browser',
    login_required: true,
    applyScript: (ops) => barboraScript(ops, false),
    readScript: () => barboraScript([], false),
    clearScript: () => barboraScript([], true),
    instructions: (script, purpose) => barboraInstructions(script, purpose),
  };
}

/**
 * In-page script for a logged-in barbora.ee tab. Endpoints from the site bundle:
 * GET /api/eshop/v1/cart, POST /api/eshop/v1/cart/item {product_id, quantity, unit, cart_id}, DELETE /api/eshop/v1/cart/item?id=&cartId=.
 * The cart JSON shape has not been observed from a logged-in session yet, so the raw payload is returned too.
 */
export function barboraScript(ops: BrowserCartOp[], clearAll: boolean): string {
  return `async () => {
  const ops = ${JSON.stringify(ops.map(o => ({ sku: o.sku, qty: o.qty, unit: o.meta?.unit ?? 0 })))};
  const clearAll = ${clearAll ? 'true' : 'false'};
  const base = '/api/eshop/v1/';
  const cookie = (n) => (document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')) || [])[1] || '';
  const version = ((document.querySelector('script[src*="main.concat.js"]') || {}).src || '').match(/v=([\\d.]+)/)?.[1] || (window.b_data && window.b_data.version) || '';
  const headers = () => ({ 'Content-Type': 'application/json', 'ClientVersion': version, 'X-Session-ID': decodeURIComponent(cookie('X-Session-ID')) });
  const api = async (path, init = {}) => {
    const r = await fetch(base + path, { credentials: 'include', ...init, headers: { ...headers(), ...(init.headers || {}) } });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const summarize = (cartBody) => {
    const cart = cartBody && (cartBody.cart || cartBody);
    const lines = (cart && (cart.items || cart.products || cart.cartItems || cart.lines)) || [];
    return {
      cart_id: cart && (cart.id || cart.cart_id || cart.cartId) || null,
      items: Array.isArray(lines) ? lines.map(l => ({ sku: l.product_id || l.productId || (l.product && l.product.id) || l.id, name: l.title || l.name || (l.product && l.product.title) || null, qty: l.quantity ?? l.qty ?? null, price: l.price ?? l.total ?? null })) : [],
      total: cart && (cart.total || cart.totalPrice || cart.total_price || cart.grand_total) || null,
      raw: cartBody,
    };
  };
  let current = await api('cart');
  if (current.status === 401 || current.status === 403) {
    return { ok: false, login_required: true, error: 'Not logged in to Barbora. Ask the user to log in in this tab (Logi sisse), then run this script again.' };
  }
  let summary = summarize(current.body);
  const cartId = summary.cart_id;
  if (!cartId) return { ok: false, error: 'Could not find cart id in GET cart response', raw: current.body };
  const results = [];
  if (clearAll) {
    const r = await api('cart/removeallitems', { method: 'POST', body: JSON.stringify({ cart_id: cartId }) });
    results.push({ action: 'clear', status: r.status });
  }
  for (const op of ops) {
    if (op.qty == null) {
      const r = await api('cart/item?id=' + encodeURIComponent(op.sku) + '&cartId=' + encodeURIComponent(cartId), { method: 'DELETE' });
      results.push({ sku: op.sku, action: 'remove', status: r.status, message: r.body && r.body.messages });
    } else {
      const existing = summary.items.find(i => String(i.sku) === String(op.sku));
      if (existing) {
        const d = await api('cart/item?id=' + encodeURIComponent(op.sku) + '&cartId=' + encodeURIComponent(cartId), { method: 'DELETE' });
        results.push({ sku: op.sku, action: 'remove-before-set', status: d.status });
      }
      const r = await api('cart/item', { method: 'POST', body: JSON.stringify({ product_id: op.sku, quantity: op.qty, unit: op.unit, cart_id: cartId }) });
      results.push({ sku: op.sku, action: 'set', qty: op.qty, status: r.status, message: r.body && r.body.messages });
    }
  }
  current = await api('cart');
  summary = summarize(current.body);
  const failed = results.filter(r => r.status < 200 || r.status >= 300);
  return { ok: failed.length === 0, applied: results, failed, cart: summary, note: 'Barbora adds a 4 EUR fee to carts under 39.99 EUR. Open /ostukorv to review.' };
}`;
}

function barboraInstructions(script: string, purpose: string): BrowserCartInstructions {
  return {
    store: 'barbora',
    kind: 'browser',
    login_required: true,
    why: 'Barbora has no guest cart; the cart belongs to the logged-in account session. Cart changes must run inside a barbora.ee tab where the user is logged in.',
    purpose,
    steps: [
      { step: 1, tool: 'mcp__chrome-devtools__new_page', args: { url: BARBORA_BASE }, note: 'If a barbora.ee tab is already open, use list_pages + select_page instead.' },
      { step: 2, tool: 'mcp__chrome-devtools__evaluate_script', args: { function: '<script below>' }, note: 'If it returns login_required, ask the user to log in in that tab (never type their password yourself), then run it again.' },
      { step: 3, tool: 'mcp__chrome-devtools__navigate_page', args: { type: 'url', url: `${BARBORA_BASE}/ostukorv` }, note: 'Shows the cart page so the user can review and check out.' },
    ],
    script,
  };
}
