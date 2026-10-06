import { describe, it, expect } from 'vitest';
import {
  parseNutrition, parseEnergyKcal, parseNutrientValue, parseStep, snapQty,
  deriveUnitPricePer, parseKlevuCategory, resolveQtyRules,
} from '../src/stores/selver/parser.js';

describe('parseNutrientValue', () => {
  it('parses dot and comma decimals', () => {
    expect(parseNutrientValue('9.10')).toBe(9.1);
    expect(parseNutrientValue('9,10')).toBe(9.1);
    expect(parseNutrientValue('24')).toBe(24);
  });
  it('returns 0 for null or empty', () => {
    expect(parseNutrientValue(null)).toBe(0);
    expect(parseNutrientValue('')).toBe(0);
  });
});

describe('parseEnergyKcal', () => {
  it('parses Selver energy strings', () => {
    expect(parseEnergyKcal('811.7kJ/194kcal')).toBe(194);
    expect(parseEnergyKcal('194kcal')).toBe(194);
    expect(parseEnergyKcal('811.7 kJ / 194 kcal')).toBe(194);
    expect(parseEnergyKcal('811,7kJ/194,5kcal')).toBe(194.5);
    expect(parseEnergyKcal(null)).toBe(0);
  });
});

describe('parseNutrition', () => {
  it('parses full nutrition data', () => {
    expect(parseNutrition({
      product_nutr_energy: '811.7kJ/194kcal', product_nutr_proteins: '9.10', product_nutr_carbohydrates: '24.10',
      product_nutr_fats: '6.30', product_nutr_sugars: '1,2', product_nutr_salt: '0.5',
    })).toEqual({ energy_kcal: 194, protein_g: 9.1, carbs_g: 24.1, fat_g: 6.3, sugars_g: 1.2, salt_g: 0.5 });
  });
  it('returns null when nothing is provided', () => {
    expect(parseNutrition({ product_nutr_energy: null, product_nutr_proteins: null, product_nutr_carbohydrates: null, product_nutr_fats: null })).toBeNull();
  });
});

describe('parseStep', () => {
  it('accepts strings, numbers, commas; rejects empty and zero', () => {
    expect(parseStep('0.30')).toBe(0.3);
    expect(parseStep(0.3)).toBe(0.3);
    expect(parseStep('0,5')).toBe(0.5);
    expect(parseStep(null)).toBeNull();
    expect(parseStep('')).toBeNull();
    expect(parseStep('0')).toBeNull();
    expect(parseStep('abc')).toBeNull();
  });
});

describe('resolveQtyRules', () => {
  it('prefers the catalog step, then stock increments, then whole pieces', () => {
    expect(resolveQtyRules({ sku: 'a', name: 'a', product_weight_step: '0.30' }, undefined)).toEqual({ qty_step: 0.3, min_qty: 0.3, sold_by_weight: true });
    expect(resolveQtyRules({ sku: 'a', name: 'a' }, { product_id: 1, in_stock: true, is_qty_decimal: true, min_sale_qty: 0.5, qty_increments: 0.25, enable_qty_increments: true, max_sale_qty: 9 }))
      .toEqual({ qty_step: 0.25, min_qty: 0.5, sold_by_weight: true });
    expect(resolveQtyRules({ sku: 'a', name: 'a' }, undefined)).toEqual({ qty_step: 1, min_qty: 1, sold_by_weight: false });
  });
});

describe('snapQty', () => {
  it('rounds weight quantities up to the next step', () => {
    expect(snapQty(0.5, 0.3, 0.3)).toEqual({ qty: 0.6, adjusted: true });
    expect(snapQty(0.6, 0.3, 0.3)).toEqual({ qty: 0.6, adjusted: false });
    expect(snapQty(1, 0.3, 0.3)).toEqual({ qty: 1.2, adjusted: true });
    expect(snapQty(0.9, 0.3, 0.3)).toEqual({ qty: 0.9, adjusted: false });
  });
  it('enforces minimums and whole pieces', () => {
    expect(snapQty(0.1, 0.3, 0.3)).toEqual({ qty: 0.3, adjusted: true });
    expect(snapQty(0.5, 1, 1)).toEqual({ qty: 1, adjusted: true });
    expect(snapQty(2, 1, 1)).toEqual({ qty: 2, adjusted: false });
    expect(snapQty(0.25, 0.25, 0.5)).toEqual({ qty: 0.5, adjusted: true });
  });
});

describe('deriveUnitPricePer', () => {
  it('guesses kg, l, or tk from the volume string', () => {
    expect(deriveUnitPricePer('500 g')).toBe('kg');
    expect(deriveUnitPricePer('kg')).toBe('kg');
    expect(deriveUnitPricePer('1,5 L')).toBe('l');
    expect(deriveUnitPricePer('200 ml')).toBe('l');
    expect(deriveUnitPricePer('neto 360g')).toBe('kg');
    expect(deriveUnitPricePer('330ml')).toBe('l');
    expect(deriveUnitPricePer('10 tk')).toBe('tk');
    expect(deriveUnitPricePer(null, 'Hambahari')).toBeNull();
  });
});

describe('parseKlevuCategory', () => {
  it('turns the Klevu category blob into a readable path', () => {
    expect(parseKlevuCategory('KLEVU_PRODUCT;;e-Selver;Puu- ja köögiviljad;Köögiviljad, juurviljad  @ku@kuCategory@ku@'))
      .toBe('Puu- ja köögiviljad > Köögiviljad, juurviljad');
    expect(parseKlevuCategory(null)).toBeNull();
  });
});
