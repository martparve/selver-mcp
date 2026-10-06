import type { Product, SearchResult, SearchSort, StoreAdapter, BrowserCartApi, BrowserCartOp, BrowserCartInstructions } from '../../core/types.js';
import { parseRimiSearchHtml, RIMI_BASE } from './parser.js';
import { politeGetText } from '../../core/http.js';

export const RIMI_MAX_PAGE = 80;

async function fetchSearchHtml(query: string): Promise<string> {
  const url = `${RIMI_BASE}/epood/ee/otsing?query=${encodeURIComponent(query)}&page=1&pageSize=${RIMI_MAX_PAGE}`;
  return politeGetText(url, { concurrency: 4, retries: 2, validate: t => t.includes('js-product-container') || /tulemust|ei leitud/i.test(t) });
}

/**
 * Rimi e-pood: Laravel + server-rendered product cards. Search is cookie-free HTML.
 * The guest cart is bound to an httpOnly session cookie, so the browser owns the cart.
 */
export class RimiClient implements StoreAdapter {
  readonly id = 'rimi' as const;
  readonly name = 'Rimi';
  readonly homeUrl = `${RIMI_BASE}/epood/ee`;
  readonly cartUrl = `${RIMI_BASE}/epood/ee/checkout`;

  async searchProducts(query: string, limit = 15, sort: SearchSort = 'relevance'): Promise<SearchResult> {
    const sortSuffix = sort === 'price_asc' ? ':price-asc' : sort === 'price_desc' ? ':price-desc' : '';
    const html = await fetchSearchHtml(`${query}${sortSuffix}`);
    let products = parseRimiSearchHtml(html);
    // Keep unavailable items (so the agent can see them) but never ahead of available ones.
    const rank = (p: Product) => (p.in_stock ? 0 : 1);
    if (sort === 'price_asc') products = [...products].sort((a, b) => rank(a) - rank(b) || a.price - b.price);
    else if (sort === 'price_desc') products = [...products].sort((a, b) => rank(a) - rank(b) || b.price - a.price);
    else products = [...products].sort((a, b) => rank(a) - rank(b));
    return { store: 'rimi', query, source: 'rimi-html', total: products.length, products: products.slice(0, Math.max(1, Math.min(limit, RIMI_MAX_PAGE))) };
  }

  /** Rimi has no JSON product endpoint; searching by product code returns exactly that product. */
  async getProducts(skus: string[]): Promise<Product[]> {
    const results = await Promise.all(skus.map(async sku => {
      try {
        const html = await fetchSearchHtml(sku);
        return parseRimiSearchHtml(html).find(p => p.sku === sku) ?? null;
      } catch {
        return null;
      }
    }));
    return results.filter((p): p is Product => p !== null);
  }

  readonly cart: BrowserCartApi = {
    kind: 'browser',
    login_required: false,
    applyScript: (ops) => rimiScript(ops, false),
    readScript: () => rimiScript([], false),
    clearScript: () => rimiScript([], true),
    instructions: (script, purpose) => rimiInstructions(script, purpose),
  };
}

/**
 * In-page script. Runs inside a rimi.ee tab (same origin, session cookies present).
 * PUT /epood/cart/change queues a change; GET /epood/cart/refresh applies it and returns the side-cart HTML.
 */
export function rimiScript(ops: BrowserCartOp[], clearAll: boolean): string {
  return `async () => {
  const ops = ${JSON.stringify(ops.map(o => ({ sku: o.sku, qty: o.qty })))};
  const clearAll = ${clearAll ? 'true' : 'false'};
  const xsrf = () => decodeURIComponent((document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/) || [])[1] || '');
  const headers = () => ({ 'X-XSRF-TOKEN': xsrf(), 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', 'Content-Type': 'application/json' });
  const change = async (product, amount) => {
    const body = amount == null ? { _method: 'put', product } : { _method: 'put', product, amount: String(amount) };
    const r = await fetch('/epood/cart/change', { method: 'PUT', credentials: 'same-origin', headers: headers(), body: JSON.stringify(body) });
    return r.status;
  };
  const parseCart = (html) => {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const items = [...doc.querySelectorAll('[data-product-code]')].map(el => {
      const amount = el.querySelector('input[name="amount"]');
      return {
        sku: el.getAttribute('data-product-code'),
        name: (el.querySelector('.side-card__name') || {}).textContent?.trim() || null,
        qty: parseFloat((amount && amount.value) || el.getAttribute('data-amount') || '') || null,
        unit: (amount && amount.getAttribute('data-unit')) || el.getAttribute('data-unit') || null,
        price_text: (el.querySelector('.side-card__price, .side-card__price-per') || {}).textContent?.replace(/\\s+/g, ' ').trim() || null,
      };
    });
    const rows = [...doc.querySelectorAll('.row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean);
    const totalRow = rows.find(t => /^Kokku/.test(t)) || null;
    const total = totalRow ? parseFloat((totalRow.match(/(\\d+(?:[.,]\\d+)?)\\s*€/) || [])[1]?.replace(',', '.') || '') || null : null;
    return { items, total, summary_rows: rows, minimum_order_warning: rows.find(t => /miinimum/i.test(t)) || null };
  };
  const get = async (path) => fetch(path, { credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
  const refresh = async () => {
    const r = await get('/epood/cart/refresh');            // applies queued changes
    if (!r.ok) return { status: r.status, items: [], total: null };
    const rc = await get('/epood/cart/recalculated');      // same shape, with calculated totals
    const data = rc.ok ? await rc.json() : await r.json();
    return { status: r.status, ...parseCart(data.sideCart), is_calculated: data.isCalculated };
  };
  if (!xsrf()) return { ok: false, error: 'No XSRF-TOKEN cookie; make sure this tab is on www.rimi.ee/epood and reload it.' };
  const results = [];
  if (clearAll) {
    const current = await refresh();
    for (const it of current.items) if (it.sku) results.push({ sku: it.sku, action: 'remove', status: await change(it.sku, null) });
  }
  for (const op of ops) results.push({ sku: op.sku, action: op.qty == null ? 'remove' : 'set', qty: op.qty, status: await change(op.sku, op.qty) });
  const cart = await refresh();
  const failed = results.filter(r => r.status !== 200);
  return { ok: failed.length === 0, applied: results, failed, cart, note: 'Reload the tab or open /epood/ee/checkout to see the updated cart. Minimum order is 20 EUR.' };
}`;
}

function rimiInstructions(script: string, purpose: string): BrowserCartInstructions {
  return {
    store: 'rimi',
    kind: 'browser',
    login_required: false,
    why: 'Rimi binds the cart to an httpOnly session cookie, so cart changes must run inside the rimi.ee tab. A guest cart works; logging in first is optional (loyalty prices).',
    purpose,
    steps: [
      { step: 1, tool: 'mcp__chrome-devtools__new_page', args: { url: `${RIMI_BASE}/epood/ee` }, note: 'If a rimi.ee tab is already open, use list_pages + select_page instead.' },
      { step: 2, tool: 'mcp__chrome-devtools__evaluate_script', args: { function: '<script below>' }, note: 'Runs the cart changes with the tab\'s cookies and returns the resulting cart (items, total).' },
      { step: 3, tool: 'mcp__chrome-devtools__navigate_page', args: { type: 'url', url: `${RIMI_BASE}/epood/ee/checkout` }, note: 'Shows the cart page so the user can review and check out.' },
    ],
    script,
  };
}
