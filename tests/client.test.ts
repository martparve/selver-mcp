import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SelverClient, buildProduct } from '../src/stores/selver/client.js';
import type { Product } from '../src/core/types.js';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf-8'));
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = { match: (url: string, init?: RequestInit) => boolean; reply: (url: string, init?: RequestInit) => unknown };

/** Route fetch calls by URL so one test can exercise Klevu + ES + stock in a single flow. */
function mockFetch(routes: Route[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find(r => r.match(url, init));
    if (!r) throw new Error(`Unmocked fetch: ${url}`);
    const out = r.reply(url, init);
    return out instanceof Response ? out : res(out);
  });
  return { spy, calls };
}

const KLEVU = (b: unknown) => ({ match: (u: string) => u.includes('ksearchnet.com'), reply: () => b });
const ES_TERMS = (b: unknown) => ({ match: (u: string, i?: RequestInit) => u.includes('/product/_search') && i?.method === 'POST', reply: () => b });
const ES_Q = (b: unknown) => ({ match: (u: string, i?: RequestInit) => u.includes('/product/_search?q=') && !i?.method, reply: () => b });
const STOCK = (b: unknown) => ({ match: (u: string) => u.includes('/api/stock/list'), reply: () => b });
const CART = (action: string, b: unknown | ((u: string, i?: RequestInit) => unknown)) => ({
  match: (u: string) => new RegExp(`/api/cart/${action}(\\?|$)`).test(u),
  reply: (u: string, i?: RequestInit) => (typeof b === 'function' ? (b as (u: string, i?: RequestInit) => unknown)(u, i) : b),
});

describe('SelverClient.searchProducts', () => {
  let client: SelverClient;
  beforeEach(() => { client = new SelverClient(); vi.restoreAllMocks(); });

  it('uses Klevu ranking, hydrates from the catalog, and reads live stock', async () => {
    const { calls } = mockFetch([KLEVU(fixture('klevu-kurk')), ES_TERMS(fixture('es-hydrate-kurk')), STOCK(fixture('stock-list-kurk'))]);
    const r = await client.searchProducts('kurk', 5);
    expect(r.source).toBe('klevu');
    expect(r.total).toBe(38);
    expect(r.products.map(p => p.sku)).toEqual(fixture('klevu-kurk').queryResults[0].records.map((x: { sku: string }) => x.sku));
    const kurk = r.products.find(p => p.sku === 'T000001325')!;
    expect(kurk.name).toBe('Kurk Luunja, GRÜNE FEE, kg');
    expect(kurk.sold_by_weight).toBe(true);
    expect(kurk.qty_step).toBe(0.3);
    expect(kurk.min_qty).toBe(0.3);
    expect(kurk.in_stock).toBe(true);
    expect(kurk.category).toBe('Puu- ja köögiviljad > Köögiviljad, juurviljad');
    expect(kurk.url).toBe('https://www.selver.ee/kurk-luunja-grune-fee-kg');
    const pickled = r.products.find(p => p.sku === 'T000007887')!;
    expect(pickled.sold_by_weight).toBe(false);
    expect(pickled.qty_step).toBe(1);
    expect(pickled.unit_price_per).toBe('kg');
    expect(pickled.nutrition).not.toBeNull();
    // One Klevu call, one catalog call, one stock call
    expect(calls.filter(c => c.url.includes('ksearchnet'))).toHaveLength(1);
    expect(calls.filter(c => c.url.includes('/product/_search'))).toHaveLength(1);
    expect(calls.filter(c => c.url.includes('/api/stock/list'))).toHaveLength(1);
    // Selver only splits on literal commas
    expect(calls.find(c => c.url.includes('/api/stock/list'))!.url).toMatch(/skus=T000001325,T000007887,/);
  });

  it('passes limit and sort to Klevu and caps limit at 30', async () => {
    const { calls } = mockFetch([KLEVU({ queryResults: [{ meta: { totalResultsFound: 0 }, records: [] }] }), ES_TERMS({ hits: { hits: [] } }), STOCK({ code: 200, result: [] })]);
    await client.searchProducts('piim', 99, 'price_asc');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.recordQueries[0].settings.limit).toBe(30);
    expect(body.recordQueries[0].settings.sort).toBe('PRICE_ASC');
    expect(body.recordQueries[0].settings.query.term).toBe('piim');
  });

  it('falls back to the Elasticsearch query when Klevu fails', async () => {
    mockFetch([
      { match: u => u.includes('ksearchnet.com'), reply: () => res({ error: 'down' }, 503) },
      ES_Q(fixture('es-query-kurk')),
      STOCK(fixture('stock-list-kurk')),
    ]);
    const r = await client.searchProducts('kurk', 3);
    expect(r.source).toBe('elasticsearch');
    expect(r.products.length).toBe(3);
    expect(r.total).toBe(256);
    const pikk = r.products.find(p => p.sku === 'T000049036')!;
    expect(pikk.qty_step).toBe(0.3);
    expect(pikk.discount_pct).toBe(13);
    expect(pikk.original_price).toBe(2.29);
    expect(pikk.price).toBe(1.99);
  });

  it('still returns Klevu products when catalog hydration fails', async () => {
    mockFetch([
      KLEVU(fixture('klevu-kurk')),
      { match: (u, i) => u.includes('/product/_search') && i?.method === 'POST', reply: () => res('<html>502</html>', 502) },
      STOCK({ code: 200, result: [] }),
    ]);
    const r = await client.searchProducts('kurk', 5);
    expect(r.products).toHaveLength(5);
    const kurk = r.products[0];
    expect(kurk.price).toBe(4.49);
    expect(kurk.in_stock).toBe(true);
    expect(kurk.nutrition).toBeNull();
  });

  it('reports in_stock as null when neither Klevu nor the stock service answered', () => {
    const p = buildProduct({ sku: 'X', name: 'Y', final_price_incl_tax: 1 }, undefined, undefined);
    expect(p.in_stock).toBeNull();
  });
});

describe('SelverClient.getProducts', () => {
  it('asks the stock service only about SKUs the catalog knows', async () => {
    vi.restoreAllMocks();
    const { calls } = mockFetch([ES_TERMS(fixture('es-hydrate-kurk')), STOCK(fixture('stock-list-kurk'))]);
    const products = await new SelverClient().getProducts(['T000001325', 'T000000000']);
    expect(products.map(p => p.sku)).toEqual(['T000001325']);
    expect(products[0].in_stock).toBe(true);
    const stockCall = calls.find(c => c.url.includes('/api/stock/list'))!;
    expect(stockCall.url).toContain('skus=T000001325');
    expect(stockCall.url).not.toContain('T000000000');
  });
});

describe('buildProduct', () => {
  it('parses string weight steps and marks discounts', () => {
    const p = buildProduct({
      sku: 'X', name: 'Pikk kurk, kg', product_weight_step: '0.30', final_price_incl_tax: 1.9899999999, original_price_incl_tax: 2.29,
      unit_price: 1.99, product_volume: 'kg', url_path: 'pikk-kurk-kg',
    }, undefined, undefined);
    expect(p.qty_step).toBe(0.3);
    expect(p.sold_by_weight).toBe(true);
    expect(p.price).toBe(1.99);
    expect(p.original_price).toBe(2.29);
    expect(p.discount_pct).toBe(13);
    expect(p.unit_price_per).toBe('kg');
  });

  it('uses stock qty_increments when the catalog has no step', () => {
    const p = buildProduct({ sku: 'X', name: 'Tomat, kg', final_price_incl_tax: 3 }, undefined,
      { product_id: 1, in_stock: true, is_qty_decimal: true, min_sale_qty: 0.5, qty_increments: 0.25, enable_qty_increments: true, max_sale_qty: 10 });
    expect(p.qty_step).toBe(0.25);
    expect(p.min_qty).toBe(0.5);
    expect(p.sold_by_weight).toBe(true);
  });

  it('treats decimal-capable items without increments as whole pieces', () => {
    const p = buildProduct({ sku: 'X', name: 'Kurk poolpikk, kg', final_price_incl_tax: 4.51 }, undefined,
      { product_id: 1, in_stock: true, is_qty_decimal: true, min_sale_qty: 1, qty_increments: 0, enable_qty_increments: false, max_sale_qty: 500 });
    expect(p.qty_step).toBe(1);
    expect(p.min_qty).toBe(1);
    expect(p.sold_by_weight).toBe(false);
  });

  it('does not report a discount when prices are equal', () => {
    const p = buildProduct({ sku: 'X', name: 'Y', final_price_incl_tax: 2.79, original_price_incl_tax: 2.79 }, undefined, undefined);
    expect(p.original_price).toBeNull();
    expect(p.discount_pct).toBeNull();
  });
});

describe('SelverClient cart', () => {
  let client: SelverClient;
  beforeEach(() => { client = new SelverClient(); vi.restoreAllMocks(); });

  it('createCart returns the token', async () => {
    mockFetch([CART('create', fixture('cart-create'))]);
    expect(await client.createCart()).toBe(fixture('cart-create').result);
  });

  it('createCart returns null on failure or network error', async () => {
    mockFetch([CART('create', { code: 500, result: null })]);
    expect(await client.createCart()).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await client.createCart()).toBeNull();
  });

  it('getCart parses lines and keeps the net price separate', async () => {
    mockFetch([CART('pull', fixture('cart-pull'))]);
    const items = (await client.getCart('tok'))!;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sku: 'T000049036', qty: 0.6, price_excl_tax: 1.6048 });
  });

  it('getCart returns null for an expired token and [] on network error', async () => {
    mockFetch([CART('pull', fixture('cart-bad-token'))]);
    expect(await client.getCart('bad')).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await client.getCart('tok')).toEqual([]);
  });

  it('getTotals returns VAT-inclusive totals and the packaging fee', async () => {
    mockFetch([CART('totals', fixture('cart-totals'))]);
    const t = (await client.getTotals('tok'))!;
    expect(t.grand_total).toBe(5.67);
    expect(t.subtotal_incl_tax).toBe(5.17);
    expect(t.packaging_fee).toBe(0.5);
    expect(t.items[0]).toMatchObject({ item_id: 106876622, qty: 0.6, price_incl_tax: 1.99, row_total_incl_tax: 1.19 });
  });

  it('updateCartItem surfaces the server message verbatim', async () => {
    mockFetch([CART('update', fixture('cart-update-step-error'))]);
    const r = await client.updateCartItem('tok', 'T000049036', 1);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Toote samm on muutunud (0.3)');
    expect(r.expired_token).toBe(false);
  });

  it('updateCartItem flags an expired token', async () => {
    mockFetch([CART('update', fixture('cart-bad-token'))]);
    const r = await client.updateCartItem('bad', 'T000049036', 0.3);
    expect(r.expired_token).toBe(true);
  });

  it('deleteCartItem posts item_id and reports success', async () => {
    const { calls } = mockFetch([CART('delete', { code: 200, result: true })]);
    expect(await client.deleteCartItem('tok', 'T1', 42)).toBe(true);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ cartItem: { sku: 'T1', item_id: 42, quoteId: 'tok' } });
  });
});

describe('SelverClient.putCartItem', () => {
  let client: SelverClient;
  const pikkKurk: Product = {
    store: 'selver', sku: 'T000049036', name: 'Pikk kurk, kg', price: 1.99, original_price: 2.29, discount_pct: 13, unit_price: 1.99, unit_price_per: 'kg',
    volume: 'kg', qty_step: 0.3, min_qty: 0.3, sold_by_weight: true, in_stock: true, category: null, nutrition: null, allergens: null,
    age_restricted: false, url: 'https://www.selver.ee/pikk-kurk-kg',
  };
  beforeEach(() => { client = new SelverClient(); vi.restoreAllMocks(); });

  /** Simulates Selver: update without item_id adds, with item_id sets. */
  function fakeCart(initial: Array<{ item_id: number; sku: string; qty: number; name: string }>, opts: { dropFirstWrite?: boolean } = {}) {
    const lines = [...initial];
    let writes = 0;
    const update = (_u: string, i?: RequestInit) => {
      const { cartItem } = JSON.parse(String(i?.body));
      writes++;
      if (opts.dropFirstWrite && writes === 1) return { code: 200, result: { ...cartItem, item_id: 1 } };
      const existing = lines.find(l => l.sku === cartItem.sku);
      if (cartItem.item_id !== undefined && existing) existing.qty = cartItem.qty;
      else if (existing) existing.qty += cartItem.qty;
      else lines.push({ item_id: 100 + lines.length, sku: cartItem.sku, qty: cartItem.qty, name: 'X' });
      return { code: 200, result: lines.find(l => l.sku === cartItem.sku) };
    };
    return { lines, routes: [CART('update', update), CART('pull', () => ({ code: 200, result: lines.map(l => ({ ...l, price: 1 })) }))], writes: () => writes };
  }

  it('snaps weight quantities up to the step and reports the adjustment', async () => {
    const cart = fakeCart([]);
    mockFetch(cart.routes);
    const r = await client.putCartItem('tok', 'T000049036', 0.5, 'set', pikkKurk, undefined);
    expect(r).toMatchObject({ ok: true, qty: 0.6, qty_adjusted: true, requested_qty: 0.5 });
    expect(cart.lines[0].qty).toBe(0.6);
  });

  it('mode set replaces an existing line instead of merging', async () => {
    const cart = fakeCart([{ item_id: 7, sku: 'T000049036', qty: 0.6, name: 'Pikk kurk, kg' }]);
    const { calls } = mockFetch(cart.routes);
    const r = await client.putCartItem('tok', 'T000049036', 0.6, 'set', pikkKurk, { item_id: 7, sku: 'T000049036', qty: 0.6, name: 'Pikk kurk, kg', price_excl_tax: 1.6 });
    expect(r.ok).toBe(true);
    expect(cart.lines[0].qty).toBe(0.6);
    const body = JSON.parse(String(calls.find(c => c.url.includes('/update'))!.init?.body));
    expect(body.cartItem.item_id).toBe(7);
  });

  it('mode add increases an existing line by the requested amount', async () => {
    const cart = fakeCart([{ item_id: 7, sku: 'T000049036', qty: 0.6, name: 'Pikk kurk, kg' }]);
    mockFetch(cart.routes);
    const r = await client.putCartItem('tok', 'T000049036', 0.3, 'add', pikkKurk, { item_id: 7, sku: 'T000049036', qty: 0.6, name: 'Pikk kurk, kg', price_excl_tax: 1.6 });
    expect(r).toMatchObject({ ok: true, qty: 0.9, qty_adjusted: false });
    expect(cart.lines[0].qty).toBe(0.9);
  });

  it('retries once when the server returns 200 without persisting', async () => {
    const cart = fakeCart([], { dropFirstWrite: true });
    mockFetch(cart.routes);
    const r = await client.putCartItem('tok', 'T000049036', 0.3, 'set', pikkKurk, undefined);
    expect(r.ok).toBe(true);
    expect(cart.writes()).toBe(2);
  });

  it('returns the server error and expired flag on failure', async () => {
    mockFetch([CART('update', fixture('cart-bad-token'))]);
    const r = await client.putCartItem('bad', 'T000049036', 0.3, 'set', pikkKurk, undefined);
    expect(r.ok).toBe(false);
    expect(r.expired_token).toBe(true);
  });
});
