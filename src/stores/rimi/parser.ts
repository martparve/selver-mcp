import { parse, type HTMLElement } from 'node-html-parser';
import type { Product } from '../../core/types.js';
import { round2, round3 } from '../../core/qty.js';

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
    category: categoryFromUrl(href),
    nutrition: null,
    allergens: null,
    age_restricted: false,
    url: href ? `${RIMI_BASE}${href}` : `${RIMI_BASE}/epood/ee/otsing?query=${sku}`,
  };
}

export function parseRimiSearchHtml(html: string): Product[] {
  const root = parse(html);
  return root.querySelectorAll('div.js-product-container[data-product-code]')
    .map(parseRimiCard)
    .filter((p): p is Product => p !== null);
}
