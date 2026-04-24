export interface SelverRawProduct {
  sku: string;
  name: string;
  slug: string;
  price_incl_tax: number;
  final_price_incl_tax: number;
  unit_price: number;
  product_volume: string | null;
  product_weight_step: number | null;
  image: string;
  stock: {
    is_in_stock: boolean;
    stock_status?: number;
  };
  product_nutr_energy: string | null;
  product_nutr_proteins: string | null;
  product_nutr_carbohydrates: string | null;
  product_nutr_fats: string | null;
}

export interface NutritionPer100g {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Product {
  sku: string;
  name: string;
  slug: string;
  price: number;
  unit_price: number;
  volume: string | null;
  weight_step: number | null;
  in_stock: boolean;
  nutrition: NutritionPer100g | null;
}

export interface AddToCartResult {
  ok: boolean;
  error?: string;
}

export interface CartItem {
  item_id: number;
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface SelverSearchResponse {
  hits: {
    total: number;
    hits: Array<{ _source: SelverRawProduct }>;
  };
}
