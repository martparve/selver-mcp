import type { SelverRawProduct, StockInfo } from './types.js';
import type { NutritionPer100g, UnitPricePer } from '../../core/types.js';
import { round3 } from '../../core/qty.js';
export { round2, round3, snapQty } from '../../core/qty.js';

export function parseNutrientValue(value: string | null | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export function parseEnergyKcal(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*kcal/i);
  return match ? parseFloat(match[1]) : 0;
}

type RawNutritionFields = Pick<SelverRawProduct,
  'product_nutr_energy' | 'product_nutr_proteins' | 'product_nutr_carbohydrates' |
  'product_nutr_fats' | 'product_nutr_sugars' | 'product_nutr_salt'>;

export function parseNutrition(raw: RawNutritionFields): NutritionPer100g | null {
  if (!raw.product_nutr_proteins && !raw.product_nutr_energy) return null;
  return {
    energy_kcal: parseEnergyKcal(raw.product_nutr_energy),
    protein_g: parseNutrientValue(raw.product_nutr_proteins),
    carbs_g: parseNutrientValue(raw.product_nutr_carbohydrates),
    fat_g: parseNutrientValue(raw.product_nutr_fats),
    sugars_g: parseNutrientValue(raw.product_nutr_sugars),
    salt_g: parseNutrientValue(raw.product_nutr_salt),
  };
}

/** Selver returns product_weight_step as a string ("0.30"), occasionally as a number, often null. */
export function parseStep(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? round3(n) : null;
}

/** Best-effort guess of what unit_price is expressed per, from the volume string. */
export function deriveUnitPricePer(volume: string | null | undefined, name?: string): UnitPricePer | null {
  const text = `${volume ?? ''} ${name ?? ''}`.toLowerCase();
  if (/(\d\s*|\b)(ml|cl|l|liitrit)\b/.test(text)) return 'l';
  if (/(\d\s*|\b)(kg|g|gr|grammi)\b/.test(text)) return 'kg';
  if (/(\d\s*|\b)(tk|tükki|paar)\b/.test(text)) return 'tk';
  return null;
}

/**
 * Klevu category strings look like
 * "KLEVU_PRODUCT;;e-Selver;Puu- ja köögiviljad;Köögiviljad, juurviljad  @ku@kuCategory@ku@".
 */
export function parseKlevuCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split('@ku@')[0];
  const path = first.split(';;')[1] ?? first;
  const parts = path.split(';').map(s => s.trim()).filter(s => s && s !== 'e-Selver');
  return parts.length ? parts.join(' > ') : null;
}

export function parseEsCategory(raw: SelverRawProduct): string | null {
  const real = (raw.category ?? []).find(c => c.name && (c.is_virtual === false || c.is_virtual === 'false'));
  return real?.name ?? raw.category?.[0]?.name ?? null;
}

/**
 * Work out how a product can be ordered. ES `product_weight_step` wins when present,
 * otherwise the live stock record (qty_increments when enabled), otherwise whole pieces.
 */
export function resolveQtyRules(raw: SelverRawProduct | undefined, stock: StockInfo | undefined): {
  qty_step: number; min_qty: number; sold_by_weight: boolean;
} {
  const esStep = parseStep(raw?.product_weight_step);
  const stockStep = stock && stock.enable_qty_increments && stock.qty_increments > 0 ? round3(stock.qty_increments) : null;
  const qty_step = esStep ?? stockStep ?? 1;
  const minFromStock = stock && stock.min_sale_qty > 0 ? round3(stock.min_sale_qty) : qty_step;
  const min_qty = Math.max(minFromStock, qty_step);
  const sold_by_weight = qty_step < 1 || !Number.isInteger(qty_step);
  return { qty_step, min_qty, sold_by_weight };
}

