import type { SearchSort } from '../../core/types.js';

// Selver.ee's own search box talks to Klevu with this public, client-side key.
export const KLEVU_API_KEY = 'klevu-14410928010151845';
export const KLEVU_SEARCH_URL = 'https://eucs3v2.ksearchnet.com/cs/v2/search';

export interface KlevuRecord {
  sku: string;
  name: string;
  salePrice?: string;
  price?: string;
  inStock?: string;
  min_sale_qty?: string;
  qty_increments?: string;
  is_qty_decimal?: string;
  klevu_category?: string;
  url?: string;
}

export interface KlevuSearchResult {
  total: number;
  records: KlevuRecord[];
}

const SORT_MAP: Record<SearchSort, string> = {
  relevance: 'RELEVANCE',
  price_asc: 'PRICE_ASC',
  price_desc: 'PRICE_DESC',
};

const FIELDS = ['sku', 'name', 'salePrice', 'price', 'inStock', 'min_sale_qty', 'qty_increments', 'is_qty_decimal', 'klevu_category', 'url'];

export async function klevuSearch(term: string, limit: number, sort: SearchSort = 'relevance'): Promise<KlevuSearchResult> {
  const body = {
    context: { apiKeys: [KLEVU_API_KEY] },
    recordQueries: [{
      id: 'q',
      typeOfRequest: 'SEARCH',
      settings: {
        query: { term },
        limit,
        offset: 0,
        sort: SORT_MAP[sort],
        typeOfRecords: ['KLEVU_PRODUCT'],
        fields: FIELDS,
      },
    }],
  };
  const res = await fetch(KLEVU_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Klevu HTTP ${res.status}`);
  const data = await res.json() as {
    queryResults?: Array<{ meta?: { totalResultsFound?: number }; records?: KlevuRecord[] }>;
  };
  const qr = data.queryResults?.[0];
  if (!qr) throw new Error('Klevu: empty response');
  return { total: qr.meta?.totalResultsFound ?? 0, records: qr.records ?? [] };
}
