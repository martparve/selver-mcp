import type { NutritionPer100g } from './types.js';

export function parseNutrientValue(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export function parseEnergyKcal(value: string | null): number {
  if (!value) return 0;
  const match = value.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*kcal/i);
  return match ? parseFloat(match[1]) : 0;
}

interface RawNutritionFields {
  product_nutr_energy: string | null;
  product_nutr_proteins: string | null;
  product_nutr_carbohydrates: string | null;
  product_nutr_fats: string | null;
}

export function parseNutrition(raw: RawNutritionFields): NutritionPer100g | null {
  if (!raw.product_nutr_proteins) return null;
  return {
    energy_kcal: parseEnergyKcal(raw.product_nutr_energy),
    protein_g: parseNutrientValue(raw.product_nutr_proteins),
    carbs_g: parseNutrientValue(raw.product_nutr_carbohydrates),
    fat_g: parseNutrientValue(raw.product_nutr_fats),
  };
}
