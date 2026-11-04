import { parse, type HTMLElement } from 'node-html-parser';
import type { NutritionPer100g, Product } from '../../core/types.js';
import { round2, round3 } from '../../core/qty.js';
import { cleanIngredients, htmlToText, isAlcoholFree, markedAllergens, parseAbv } from '../../core/text.js';

export const RIMI_BASE = 'https://www.rimi.ee';

/** "4.29 € per kg", "Tavahind: 19,99 €", "Hind ühiku kohta: 4,29 €/kg" → number */
export function parseEuro(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\s+/g, ' ').match(/(\d+(?:[.,]\d+)?)\s*€/);
  return m ? round2(parseFloat(m[1].replace(',', '.'))) : null;
}

function num(v: string | undefined, fallback: number): number {
  const n = parseFloat((v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/** Human category from the product URL: /epood/ee/tooted/a/b/c/slug/p/123 → "a > b > c" (slugs). */
function categoryFromUrl(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/tooted\/(.+)\/p\/\d+/);
  if (!m) return null;
  const parts = m[1].split('/');
  parts.pop(); // product slug
  return parts.length ? parts.map(s => s.replace(/-/g, ' ')).join(' > ') : null;
}

export function parseRimiCard(card: HTMLElement): Product | null {
  const sku = card.getAttribute('data-product-code');
  if (!sku) return null;
  const name = card.querySelector('.card__name')?.text.trim() ?? '';
  const href = card.querySelector('a.card__url')?.getAttribute('href') ?? undefined;
  const priceText = card.querySelector('.price-tag .sr-only')?.text ?? card.querySelector('.card__price .sr-only')?.text;
  const price = parseEuro(priceText) ?? 0;
  // Unavailable products render "Ei ole saadaval" instead of a price tag and have no add-to-cart form.
  const available = price > 0 && !/ei ole saadaval/i.test(card.querySelector('.card__price-wrapper')?.text ?? '');
  const oldPrice = parseEuro(card.querySelector('.old-price-tag .sr-only')?.text);
  const perText = card.querySelector('.card__price-per .sr-only')?.text ?? '';
  const unit_price = parseEuro(perText);
  const perUnitMatch = perText.match(/€\s*\/\s*(kg|l|tk)/i);
  const counter = card.querySelector('form.js-counter input[name="amount"]') ?? card.querySelector('input[name="amount"][data-unit]');
  const unit = (counter?.getAttribute('data-unit') ?? (/per\s+kg/i.test(priceText ?? '') ? 'kg' : 'tk')).toLowerCase();
  const step = round3(num(card.querySelector('form.js-counter input[name="step"]')?.getAttribute('value'), unit === 'kg' ? 0.1 : 1));
  const min = round3(num(counter?.getAttribute('min'), step));
  const original_price = oldPrice !== null && oldPrice > price ? oldPrice : null;
  const category = categoryFromUrl(href);
  return {
    store: 'rimi',
    sku,
    name,
    price,
    original_price,
    discount_pct: original_price ? Math.round((1 - price / original_price) * 100) : null,
    unit_price,
    unit_price_per: perUnitMatch ? (perUnitMatch[1].toLowerCase() as 'kg' | 'l' | 'tk') : null,
    volume: unit === 'kg' ? 'kg' : null,
    qty_step: step > 0 ? step : 1,
    min_qty: Math.max(min, step > 0 ? step : 1),
    sold_by_weight: unit === 'kg',
    in_stock: available,
    category,
    nutrition: null,
    allergens: null,
    age_restricted: isAlcoholCategory(category, name),
    alcohol: null,
    dietary: [],
    brand: null,
    country_of_origin: null,
    url: href ? `${RIMI_BASE}${href}` : `${RIMI_BASE}/epood/ee/otsing?query=${sku}`,
  };
}

/** Rimi's top-level alcohol section; alcohol-free drinks there are named "alkoholivaba ...". */
function isAlcoholCategory(category: string | null, name: string): boolean {
  return Boolean(category && /^alkohol\b/i.test(category)) && !isAlcoholFree(`${category} ${name}`);
}

/**
 * The product page embeds its "Tooteinfo" tab as a JSON string inside
 * `Storefront.product_details_page = { tabs: [{ identifier: 'details', html: "..." }] }`.
 */
export function extractRimiDetailsHtml(page: string): string | null {
  const m = /identifier:\s*'details'[\s\S]*?html:\s*("(?:[^"\\]|\\.)*")/.exec(page);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as string;
  } catch {
    return null;
  }
}

function parseGrams(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/** Rimi nutrition table rows → NutritionPer100g. Labels are Estonian ("millest küllastunud rasvhapped"). */
export function parseRimiNutritionTable(root: HTMLElement, quantity: string | null): NutritionPer100g | null {
  const rows = root.querySelectorAll('.product__table tbody tr');
  if (!rows.length) return null;
  const values = new Map<string, string>();
  for (const tr of rows) {
    const cells = tr.querySelectorAll('td');
    if (cells.length >= 2) values.set(cells[0].text.replace(/\s+/g, ' ').trim().toLowerCase(), cells[1].text.trim());
  }
  const find = (re: RegExp) => [...values.entries()].find(([k]) => re.test(k))?.[1];
  const energy = find(/^energia/);
  const kcal = energy?.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*kcal/i);
  const q = (quantity ?? '').toLowerCase();
  const per = /\d\s*(ml|cl|l)\b/.test(q) ? '100ml' : /\d\s*(kg|g)\b/.test(q) ? '100g' : null;
  return {
    per,
    energy_kcal: kcal ? parseFloat(kcal[1]) : 0,
    protein_g: parseGrams(find(/^valgud?/)) ?? 0,
    carbs_g: parseGrams(find(/^süsivesik/)) ?? 0,
    fat_g: parseGrams(find(/^rasvad?$/)) ?? 0,
    saturated_fat_g: parseGrams(find(/küllastunud/)),
    sugars_g: parseGrams(find(/suhkrud/)) ?? 0,
    fibre_g: parseGrams(find(/kiudaine/)),
    salt_g: parseGrams(find(/^sool/)) ?? 0,
  };
}

/**
 * A Rimi product page (/epood/ee/tooted/.../p/{code}): the same product card as search results,
 * plus origin, brand, maker, alcohol %, ingredients, storage, warnings and the nutrition table.
 */
export function parseRimiProductPage(page: string, sku: string): Product | null {
  const detailsHtml = extractRimiDetailsHtml(page);
  const root = parse(detailsHtml ?? page);
  const card = root.querySelector(`div.js-product-container[data-product-code="${sku}"]`)
    ?? parse(page).querySelector(`div.js-product-container[data-product-code="${sku}"]`);
  const base = card ? parseRimiCard(card) : null;
  if (!base) return null;
  if (!detailsHtml) return base;

  const facts = new Map<string, string>();
  for (const item of root.querySelectorAll('.product__list-wrapper dl.list .item')) {
    const dt = item.querySelector('dt')?.text.trim();
    const dd = item.querySelector('dd')?.text.replace(/\s+/g, ' ').trim();
    if (dt && dd) facts.set(dt.toLowerCase(), dd);
  }
  const sections = new Map<string, HTMLElement>();
  for (const w of root.querySelectorAll('.product__list-wrapper')) {
    const h = w.querySelector('h3.heading')?.text.trim().toLowerCase().replace(/[!:]+$/, '');
    if (h) sections.set(h, w);
  }
  const sectionHtml = (name: string) => {
    const w = sections.get(name);
    if (!w) return null;
    const body = w.querySelector('.content') ?? w.querySelector('ul.list');
    return body ? body.innerHTML : null;
  };
  const listText = (name: string) => {
    const items = sections.get(name)?.querySelectorAll('li.item') ?? [];
    const lines = items.map(li => li.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return lines.length ? lines.join('; ') : null;
  };

  const ingredientsHtml = sectionHtml('koostisosad');
  const allergens_marked = markedAllergens(ingredientsHtml);
  const alcoholText = facts.get('alkohol') ?? null;
  const abv = alcoholText ? parseAbv(alcoholText) : null;
  const alcohol = alcoholText ? { abv_pct: abv, type: null } : null;
  const quantity = facts.get('kogus') ?? null;

  return {
    ...base,
    volume: base.volume ?? quantity,
    nutrition: parseRimiNutritionTable(root, quantity),
    allergens: allergens_marked.length ? allergens_marked.join(', ') : null,
    age_restricted: base.age_restricted || (abv !== null ? abv > 0 : alcohol !== null),
    alcohol,
    brand: facts.get('kaubamärk') ?? null,
    country_of_origin: facts.get('päritolumaa') ?? null,
    details: {
      ingredients: cleanIngredients(ingredientsHtml),
      allergens_marked,
      nutrition_extra: null,
      warnings: listText('hoiatus') ?? htmlToText(sectionHtml('hoiatus')),
      storage: listText('lisainfo'),
      manufacturer: facts.get('tootja') ?? null,
      description: htmlToText(sectionHtml('toote andmed'), 600),
      ean: null,
    },
  };
}

export function parseRimiSearchHtml(html: string): Product[] {
  const root = parse(html);
  return root.querySelectorAll('div.js-product-container[data-product-code]')
    .map(parseRimiCard)
    .filter((p): p is Product => p !== null);
}
