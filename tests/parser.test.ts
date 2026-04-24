import { describe, it, expect } from 'vitest';
import { parseNutrition, parseEnergyKcal, parseNutrientValue } from '../src/selver/parser.js';

describe('parseNutrientValue', () => {
  it('parses decimal with dot', () => {
    expect(parseNutrientValue('9.10')).toBe(9.1);
  });
  it('parses decimal with comma (Estonian format)', () => {
    expect(parseNutrientValue('9,10')).toBe(9.1);
  });
  it('returns 0 for null', () => {
    expect(parseNutrientValue(null)).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(parseNutrientValue('')).toBe(0);
  });
  it('parses integer string', () => {
    expect(parseNutrientValue('24')).toBe(24);
  });
});

describe('parseEnergyKcal', () => {
  it('parses combined kJ/kcal string', () => {
    expect(parseEnergyKcal('811.7kJ/194kcal')).toBe(194);
  });
  it('parses kcal-only string', () => {
    expect(parseEnergyKcal('194kcal')).toBe(194);
  });
  it('parses with spaces', () => {
    expect(parseEnergyKcal('811.7 kJ / 194 kcal')).toBe(194);
  });
  it('parses with comma decimal', () => {
    expect(parseEnergyKcal('811,7kJ/194,5kcal')).toBe(194.5);
  });
  it('returns 0 for null', () => {
    expect(parseEnergyKcal(null)).toBe(0);
  });
});

describe('parseNutrition', () => {
  it('parses full nutrition data', () => {
    const result = parseNutrition({
      product_nutr_energy: '811.7kJ/194kcal',
      product_nutr_proteins: '9.10',
      product_nutr_carbohydrates: '24.10',
      product_nutr_fats: '6.30',
    });
    expect(result).toEqual({
      energy_kcal: 194,
      protein_g: 9.1,
      carbs_g: 24.1,
      fat_g: 6.3,
    });
  });
  it('returns null when proteins field is missing', () => {
    const result = parseNutrition({
      product_nutr_energy: null,
      product_nutr_proteins: null,
      product_nutr_carbohydrates: null,
      product_nutr_fats: null,
    });
    expect(result).toBeNull();
  });
});
