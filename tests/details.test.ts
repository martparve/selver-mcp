import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { cleanIngredients, htmlToText, markedAllergens, parseAbv } from '../src/core/text.js';
import { parseAlcohol, parseDietary } from '../src/stores/selver/parser.js';
import { parseAttributeLabels, getAttributeLabels, resetAttributeLabelCache } from '../src/stores/selver/attributes.js';
import { SelverClient, buildProduct } from '../src/stores/selver/client.js';
import { parseRimiProductPage, parseRimiSearchHtml } from '../src/stores/rimi/parser.js';
import type { Product } from '../src/core/types.js';

// Fixtures captured live on 2026-11-04 (Selver catalog + attribute index, Rimi product pages), trimmed.
const text = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
const json = (name: string) => JSON.parse(text(name));
const res = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('ingredient text helpers', () => {
  const selver = 'kurk, joogivesi, <bold><bold>SINEP</bold>ISEEMNED</bold>, till. Võib sisaldada vähesel määral <bold>GLUTEEN</bold>i.<br><br><br>* Toote koostisosade loetelu võib muutuda. Kontrollige enne toote tarbimist pakendil esitatud koostisosi.';

  it('cleans markup and the Selver disclaimer', () => {
    expect(cleanIngredients(selver)).toBe('kurk, joogivesi, SINEPISEEMNED, till. Võib sisaldada vähesel määral GLUTEENi.');
    expect(cleanIngredients(null)).toBeNull();
    expect(htmlToText('Alexandri t&auml;idlases<br /> maitses')).toBe('Alexandri täidlases maitses');
    expect(htmlToText('a'.repeat(50), 10)).toHaveLength(10);
  });

  it('finds allergens marked in bold (whole word) and in CAPITALS', () => {
    expect(markedAllergens(selver)).toEqual(['sinepiseemned', 'gluteeni']);
    expect(markedAllergens('täisPIIM')).toEqual(['täispiim']);
    expect(markedAllergens('vesi, ODRALINNASED, ODER, humal')).toEqual(['odralinnased', 'oder']);
    expect(markedAllergens('toiduvärv - E150c, EU päritolu')).toEqual([]);
  });

  it('does not treat an all-capitals list as all allergens', () => {
    expect(markedAllergens('SUHKUR, KAKAOVÕI, <bold>PIIMAPULBER</bold>, VANILLIIN')).toEqual(['piimapulber']);
  });

  it('parses alcohol percentages', () => {
    expect(parseAbv('Hele õlu 6,7%')).toBe(6.7);
    expect(parseAbv('5.2% vol')).toBe(5.2);
    expect(parseAbv('<i>Single Malt Scotch Whisky</i> 46,3%')).toBe(46.3);
    expect(parseAbv('Siider 10,0%')).toBe(10);
    expect(parseAbv('Alkoholivaba õlu')).toBe(0);
    expect(parseAbv('Õlu 0,0%')).toBe(0);
    expect(parseAbv('Punane vein')).toBeNull();
  });
});

describe('Selver attribute decoding', () => {
  const labels = parseAttributeLabels(json('es-attributes.json'));

  it('maps option ids to labels', () => {
    expect(labels.product_alcohol_type?.get('5231')).toBe('Hele õlu 6,7%');
    expect(labels.product_country_of_origin?.get('811')).toBe('Kreeka');
    expect(labels.product_nutr_unit?.get('1004')).toBe('100 milliliitri kohta');
  });

  it('maps dietary labels and caret codes to tags', () => {
    expect(parseDietary(['Vegan', 'Gluteenivaba', null])).toEqual(['vegan', 'gluten_free']);
    expect(parseDietary(['lactose^gluten^vegan^added_sugar', 'eco'])).toEqual(['lactose_free', 'gluten_free', 'vegan', 'no_added_sugar', 'organic']);
    expect(parseDietary(['Lisatud suhkuteta', 'Mahe'])).toEqual(['no_added_sugar', 'organic']);
  });

  it('keeps an alcohol marker even when the label table is unavailable', () => {
    expect(parseAlcohol(null, true)).toEqual({ abv_pct: null, type: null });
    expect(parseAlcohol(null, false)).toBeNull();
  });

  it('caches the label tables and degrades to {} on failure', async () => {
    resetAttributeLabelCache();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(json('es-attributes.json')));
    const a = await getAttributeLabels('https://example.test/cat');
    const b = await getAttributeLabels('https://example.test/cat');
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).query.terms.attribute_code).toContain('product_alcohol_type');

    resetAttributeLabelCache();
    spy.mockResolvedValue(res('busy', 503));
    expect(await getAttributeLabels('https://example.test/cat')).toEqual({});
    spy.mockRestore();
    resetAttributeLabelCache();
  });
});

describe('Selver product health fields', () => {
  const labels = parseAttributeLabels(json('es-attributes.json'));
  const raws = json('es-hydrate-details.json').hits.hits.map((h: { _source: unknown }) => h._source);
  const bySku = new Map<string, Product>(raws.map((r: { sku: string }) => [r.sku, buildProduct(r as never, undefined, undefined, labels)]));

  it('beer: alcohol type and %, warning, origin, age restriction, allergens from bold', () => {
    const beer = bySku.get('T000046090')!;
    expect(beer.alcohol).toEqual({ abv_pct: 6.7, type: 'Hele õlu 6,7%' });
    expect(beer.age_restricted).toBe(true);
    expect(beer.country_of_origin).toBe('Poola');
    expect(beer.brand).toBe('GRIMBERGEN');
    expect(beer.allergens).toBe('odralinnased, nisulinnased');
    expect(beer.details?.warnings).toMatch(/Tegemist on alkoholiga/);
    expect(beer.details?.ingredients).not.toMatch(/<bold>|Toote koostisosade loetelu/);
  });

  it('milk: per 100 ml, saturated fat, maker, EAN', () => {
    const milk = bySku.get('T000034837')!;
    expect(milk.nutrition).toMatchObject({ per: '100ml', energy_kcal: 68, fat_g: 3.9, saturated_fat_g: 2.6, fibre_g: null });
    expect(milk.alcohol).toBeNull();
    expect(milk.age_restricted).toBe(false);
    expect(milk.details).toMatchObject({ manufacturer: 'FARMI PIIMATÖÖSTUS AS', ean: '4740113090555', ingredients: 'Pastöriseeritud PIIM' });
    expect(milk.details?.description).not.toMatch(/​/);
  });

  it('yogurt: vitamins and minerals line', () => {
    const y = bySku.get('T000090915')!;
    expect(y.details?.nutrition_extra).toMatch(/^Kaltsium 121 mg/);
    expect(y.country_of_origin).toBe('Kreeka');
  });

  it('almond drink and nuggets: dietary tags', () => {
    expect(bySku.get('T000031660')!.dietary).toEqual(['lactose_free', 'gluten_free', 'vegan', 'sugar_free']);
    expect(bySku.get('T000078761')!.dietary).toEqual(['vegan']);
  });

  it('alcohol-free types are not age restricted by themselves', () => {
    const free = parseAttributeLabels({ hits: { hits: [{ _source: { attribute_code: 'product_alcohol_type', optionsPacked: [['Alkoholivaba õlu', '1']] } }] } });
    const p = buildProduct({ sku: 'x', name: 'Õlu 0,0%', product_alcohol_type: 1 }, undefined, undefined, free);
    expect(p.alcohol).toEqual({ abv_pct: 0, type: 'Alkoholivaba õlu' });
    expect(p.age_restricted).toBe(false);
  });

  it('works without labels: ids are not leaked as names', () => {
    const p = buildProduct(raws[0], undefined, undefined);
    expect(p.brand).toBeNull();
    expect(p.country_of_origin).toBeNull();
    expect(p.nutrition?.per).toBeNull();
  });

  it('getProducts decodes labels fetched from the attribute index', async () => {
    resetAttributeLabelCache();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = String(input);
      if (u.includes('/attribute/_search')) return res(json('es-attributes.json'));
      if (u.includes('/product/_search')) return res(json('es-hydrate-details.json'));
      if (u.includes('/api/stock/list')) return res({ code: 200, result: [] });
      throw new Error(`Unmocked fetch: ${u}`);
    });
    const [beer] = await new SelverClient().getProducts(['T000046090']);
    expect(beer.alcohol?.abv_pct).toBe(6.7);
    expect(beer.country_of_origin).toBe('Poola');
    vi.restoreAllMocks();
    resetAttributeLabelCache();
  });
});

describe('Rimi product page', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('milk: card fields plus nutrition table, origin, brand, maker, storage', () => {
    const milk = parseRimiProductPage(text('rimi-product-milk.html'), '964869')!;
    expect(milk).toMatchObject({ sku: '964869', price: 1.99, in_stock: true, brand: 'Alma', country_of_origin: 'Eesti', volume: '2 l' });
    expect(milk.nutrition).toEqual({ per: '100ml', energy_kcal: 67, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.9, saturated_fat_g: 2.3, sugars_g: 4.8, fibre_g: null, salt_g: 0.1 });
    expect(milk.allergens).toBe('täispiim');
    expect(milk.details?.storage).toBe('Min säilitustemperatuur.: 2° C; Max säilitustemperatuur.: 6° C');
  });

  it('beer: alcohol % and warning; no nutrition table on the page', () => {
    const beer = parseRimiProductPage(text('rimi-product-beer.html'), '1353983')!;
    expect(beer.alcohol).toEqual({ abv_pct: 5.2, type: null });
    expect(beer.age_restricted).toBe(true);
    expect(beer.nutrition).toBeNull();
    expect(beer.details?.warnings).toMatch(/Tegemist on alkoholiga/);
    expect(beer.details?.manufacturer).toBe('A. Le Coq AS');
  });

  it('cookies: per 100 g and saturated fat; allergens from CAPITALS', () => {
    const c = parseRimiProductPage(text('rimi-product-cookie.html'), '168992')!;
    expect(c.nutrition).toMatchObject({ per: '100g', energy_kcal: 472, fat_g: 21, saturated_fat_g: 10, sugars_g: 27 });
    expect(c.details?.allergens_marked).toEqual(expect.arrayContaining(['kaerahelbed', 'nisujahu', 'hapukoor']));
    expect(c.country_of_origin).toBe('Läti');
  });

  it('returns null when the page has no card for the code', () => {
    expect(parseRimiProductPage(text('rimi-product-milk.html'), '1')).toBeNull();
  });

  it('search cards flag the alcohol section as age restricted', () => {
    const [kurk] = parseRimiSearchHtml(text('rimi-search-kurk.html'));
    expect(kurk.age_restricted).toBe(false);
    expect(kurk.alcohol).toBeNull();
  });
});
