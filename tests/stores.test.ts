import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseRimiSearchHtml, parseEuro } from '../src/stores/rimi/parser.js';
import { RimiClient, rimiScript } from '../src/stores/rimi/client.js';
import { extractProductList, barboraToProduct, BarboraClient, barboraScript } from '../src/stores/barbora/client.js';
import { getStore, STORE_IDS } from '../src/stores/registry.js';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
const htmlRes = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

describe('Rimi parser', () => {
  const products = parseRimiSearchHtml(fixture('rimi-search-kurk.html'));

  it('parses product cards with price, unit price, and weight rules', () => {
    expect(products.length).toBeGreaterThanOrEqual(2);
    const kurk = products.find(p => p.sku === '275290')!;
    expect(kurk.store).toBe('rimi');
    expect(kurk.name).toBe('Kurk Luunja kg');
    expect(kurk.price).toBeGreaterThan(0);
    expect(kurk.sold_by_weight).toBe(true);
    expect(kurk.qty_step).toBe(0.3);
    expect(kurk.min_qty).toBe(0.3);
    expect(kurk.unit_price_per).toBe('kg');
    expect(kurk.url).toMatch(/^https:\/\/www\.rimi\.ee\/epood\/ee\/tooted\/.*\/p\/275290$/);
    expect(kurk.category).toContain('kurk');
  });

  it('marks piece goods with step 1', () => {
    const piece = products.find(p => !p.sold_by_weight)!;
    expect(piece.qty_step).toBe(1);
    expect(piece.min_qty).toBe(1);
  });

  it('parseEuro handles both decimal separators and prefixes', () => {
    expect(parseEuro(' 4.29 € per kg ')).toBe(4.29);
    expect(parseEuro('Tavahind: 19,99 €')).toBe(19.99);
    expect(parseEuro('Hind ühiku kohta: 4,29 €/kg')).toBe(4.29);
    expect(parseEuro(null)).toBeNull();
  });
});

describe('RimiClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('searches the HTML results page and honours limit', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlRes(fixture('rimi-search-kurk.html')));
    const r = await new RimiClient().searchProducts('kurk', 2);
    expect(r.store).toBe('rimi');
    expect(r.products).toHaveLength(2);
    expect(String(spy.mock.calls[0][0])).toContain('/epood/ee/otsing?query=kurk&page=1&pageSize=80');
  });

  it('appends the Hybris sort suffix for price sorting', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlRes(fixture('rimi-search-kurk.html')));
    const r = await new RimiClient().searchProducts('kurk', 10, 'price_asc');
    expect(String(spy.mock.calls[0][0])).toContain('query=kurk%3Aprice-asc');
    const prices = r.products.map(p => p.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('getProducts looks each code up through search', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlRes(fixture('rimi-search-kurk.html')));
    const r = await new RimiClient().getProducts(['275290', '000']);
    expect(r.map(p => p.sku)).toEqual(['275290']);
  });

  it('generates a browser script that parses as JavaScript', () => {
    const js = rimiScript([{ sku: '275290', qty: 0.6 }, { sku: '1', qty: null }], false);
    expect(() => new Function('return (' + js + ')')).not.toThrow();
    expect(js).toContain('"sku":"275290","qty":0.6');
    expect(js).toContain('/epood/cart/change');
  });
});

describe('Barbora parser', () => {
  const raws = extractProductList(fixture('barbora-search-kurk.html'));

  it('extracts the embedded product list even with brackets inside strings', () => {
    expect(raws).toHaveLength(3);
    expect(raws[0].id).toBe('000000000001068635');
  });

  it('maps promotions, unit prices, and piece rules', () => {
    const p = barboraToProduct(raws[0]);
    expect(p.store).toBe('barbora');
    expect(p.price).toBe(2.15);
    expect(p.original_price).toBe(2.69);
    expect(p.discount_pct).toBe(20);
    expect(p.unit_price).toBe(3.19);
    expect(p.unit_price_per).toBe('kg');
    expect(p.qty_step).toBe(1);
    expect(p.sold_by_weight).toBe(false);
    expect(p.in_stock).toBe(true);
    expect(p.url).toBe('https://barbora.ee/toode/marineeritud-kurk-salvest-675-g');
    expect(p.category).toBe('Kauasäilivad toidukaubad > Hoidised ja konservid > Konserveeritud kurgid ja tomatid');
  });

  it('maps kg units to weight rules', () => {
    const p = barboraToProduct({ id: '1', title: 'Kurk lühike kg', price: 3.35, units: [{ id: 7, price: 3.35, unit: 'kg', min: 0.35, max: 5, step: 0.35, defaultValue: 0.35 }], status: 'active' });
    expect(p.sold_by_weight).toBe(true);
    expect(p.qty_step).toBe(0.35);
    expect(p.min_qty).toBe(0.35);
  });

  it('flags suspended products and adult items', () => {
    const p = barboraToProduct({ id: '2', title: 'Õlu', price: 1, status: 'suspended', is_adult: true });
    expect(p.in_stock).toBe(false);
    expect(p.age_restricted).toBe(true);
  });
});

describe('BarboraClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('searches and remembers unit ids for cart ops', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlRes(fixture('barbora-search-kurk.html')));
    const c = new BarboraClient();
    const r = await c.searchProducts('kurk', 2);
    expect(r.products).toHaveLength(2);
    expect(c.opMeta('000000000001068635')).toEqual({ unit: 0 });
  });

  it('generates a browser script that parses and carries the unit id', () => {
    const js = barboraScript([{ sku: '000000000001068635', qty: 2, meta: { unit: 3 } }], false);
    expect(() => new Function('return (' + js + ')')).not.toThrow();
    expect(js).toContain('"unit":3');
    expect(js).toContain('/api/eshop/v1/');
  });
});

describe('registry', () => {
  it('exposes all stores with the right cart kinds', () => {
    expect([...STORE_IDS]).toEqual(['selver', 'rimi', 'barbora']);
    expect(getStore('selver').cart.kind).toBe('server');
    expect(getStore('rimi').cart.kind).toBe('browser');
    expect(getStore('barbora').cart.kind).toBe('browser');
  });
});
