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
