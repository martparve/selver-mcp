// Turning store HTML snippets (ingredients, descriptions) into plain text, and finding the
// allergens a store marks inside an ingredient list.
import { parse } from 'node-html-parser';

const BOLD_OPEN = '\u0001';
const BOLD_CLOSE = '\u0002';

/** HTML → text with bold spans kept as sentinel characters, entities decoded, soft hyphens removed. */
function toMarkedText(html: string): string {
  const s = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|div|dd|td)>/gi, ' ')
    .replace(/<\s*(b|bold|strong)\b[^>]*>/gi, BOLD_OPEN)
    .replace(/<\s*\/\s*(b|bold|strong)\s*>/gi, BOLD_CLOSE);
  return parse(s).text.replace(/[­​‌‍﻿]/g, '');
}

const collapse = (s: string) => s.replace(/[\u0001\u0002]/g, '').replace(/\s+/g, ' ').trim();

// Selver appends this to every ingredient list.
const DISCLAIMER = /\*\s*Toote koostisosade loetelu võib muutuda[\s\S]*$/i;

/** Plain text from a store HTML snippet. null for empty input. */
export function htmlToText(html: string | null | undefined, maxLength?: number): string | null {
  if (!html) return null;
  let text = collapse(toMarkedText(html));
  if (maxLength && text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text || null;
}

/** Ingredient list as plain text, without the store's "list may change" disclaimer. */
export function cleanIngredients(html: string | null | undefined): string | null {
  if (!html) return null;
  return collapse(toMarkedText(html).replace(DISCLAIMER, '')) || null;
}

/**
 * Words an ingredient list marks as allergens. EU labelling requires allergens to stand out:
 * Selver wraps them in <bold>, Rimi writes them in CAPITALS ("täisPIIM", "NISUJAHU").
 * Returns each marked word once, lower-cased, in order of appearance ("sinepiseemned", "nisujahu").
 */
export function markedAllergens(html: string | null | undefined): string[] {
  if (!html) return [];
  const marked = toMarkedText(html).replace(DISCLAIMER, '');
  let plain = '';
  const bold: boolean[] = [];
  let depth = 0;
  for (const ch of marked) {
    if (ch === BOLD_OPEN) { depth++; continue; }
    if (ch === BOLD_CLOSE) { depth = Math.max(0, depth - 1); continue; }
    plain += ch;
    for (let i = 0; i < ch.length; i++) bold.push(depth > 0);
  }
  const words = [...plain.matchAll(/\p{L}[\p{L}\p{N}-]*/gu)];
  // A list written (almost) entirely in capitals marks nothing by capitals; rely on bold only.
  const allCapsWords = words.filter(m => !/\p{Ll}/u.test(m[0])).length;
  const capsMeaningful = words.length < 3 || allCapsWords / words.length <= 0.8;

  const out: string[] = [];
  for (const m of words) {
    const word = m[0].replace(/-+$/, '');
    const start = m.index ?? 0;
    const isBold = bold.slice(start, start + m[0].length).some(Boolean);
    const isCaps = capsMeaningful && /\p{Lu}{3,}/u.test(word);
    if (!isBold && !isCaps) continue;
    const w = word.toLowerCase();
    if (w.length >= 3 && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Alcohol-free markers: "alkoholivaba", "alcohol-free", or a standalone 0 / 0,0 %. */
const ALCOHOL_FREE = /alkoholivaba|alcohol[- ]free|(?<![\d.,])0(?:[.,]0+)?\s*%/i;

export function isAlcoholFree(text: string): boolean {
  return ALCOHOL_FREE.test(text);
}

/** Percentage from a label like "Hele õlu 6,7%", "<i>Single Malt Scotch Whisky</i> 46,3%" or "5.2% vol". */
export function parseAbv(text: string | null | undefined): number | null {
  if (!text) return null;
  if (ALCOHOL_FREE.test(text)) return 0;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}
