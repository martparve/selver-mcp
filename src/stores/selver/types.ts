// Raw shapes from Selver's APIs (only the fields we read).

export interface SelverRawStock {
  product_id?: number;
  qty?: number;
  is_in_stock?: boolean;
  is_qty_decimal?: boolean;
  min_sale_qty?: number;
  max_sale_qty?: number;
  qty_increments?: number;
  enable_qty_increments?: boolean;
  stock_status?: number;
}

export interface SelverRawProduct {
  sku: string;
  name: string;
  slug?: string;
  url_path?: string;
  price_incl_tax?: number;
  final_price_incl_tax?: number;
  original_price_incl_tax?: number;
  unit_price?: number | null;
  product_volume?: string | null;
  product_weight_step?: string | number | null;
  product_age_restricted?: boolean;
  product_allergens?: string | null;
  product_ingrediens?: string | null;
  product_nutr_energy?: string | null;
  product_nutr_proteins?: string | null;
  product_nutr_carbohydrates?: string | null;
  product_nutr_fats?: string | null;
  product_nutr_sugars?: string | null;
  product_nutr_salt?: string | null;
  /** Saturated fatty acids, g per 100 g/ml. */
  product_nutr_fats_acids?: string | null;
  /** Vitamins and minerals as free text, e.g. "Kaltsium 121 mg (15%*) ...". */
  product_nutr_info?: string | null;
  // Option ids; their labels come from the attribute index (see attributes.ts).
  product_nutr_unit?: number | string | null;
  product_alcohol_type?: number | string | null;
  product_dietary_info?: Array<number | string> | null;
  product_country_of_origin?: number | string | null;
  product_brand?: number | string | null;
  product_manufacturer?: number | string | null;
  product_main_ean?: string | null;
  product_warnings?: string | null;
  product_storage_cond_use?: string | null;
  description?: string | null;
  category?: Array<{ name?: string; is_virtual?: boolean | string }>;
  stock?: SelverRawStock;
}

export interface SelverSearchResponse {
  hits?: {
    total?: number | { value: number };
    hits?: Array<{ _source: SelverRawProduct }>;
  };
}

export interface ApiEnvelope<T> {
  code: number;
  result: T;
}

export interface StockInfo {
  product_id: number;
  in_stock: boolean;
  is_qty_decimal: boolean;
  min_sale_qty: number;
  qty_increments: number;
  enable_qty_increments: boolean;
  max_sale_qty: number;
}

export interface CartWriteResult {
  ok: boolean;
  code: number;
  error?: string;
  expired_token?: boolean;
  item?: { item_id: number; sku: string; qty: number; name: string };
}
