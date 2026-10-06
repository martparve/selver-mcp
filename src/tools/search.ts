import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Product, SearchResult, StoreId } from '../core/types.js';
import { STORE_IDS, getStore } from '../stores/registry.js';
import { MAX_SEARCH_LIMIT } from '../stores/selver/client.js';
import { snapQty, round2 } from '../core/qty.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

const storeEnum = z.enum(STORE_IDS);
const storesParam = z.array(storeEnum).min(1).default(['selver']).describe(`Stores to query: ${STORE_IDS.join(', ')}`);

async function searchStore(store: StoreId, query: string, limit: number, sort: 'relevance' | 'price_asc' | 'price_desc'): Promise<SearchResult | { store: StoreId; query: string; error: string }> {
  try {
    return await getStore(store).searchProducts(query, limit, sort);
  } catch (e) {
    return { store, query, error: (e as Error).message };
  }
}

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    'search_products',
    {
      title: 'Search grocery products',
      description: [
        'Search one or more Estonian grocery e-shops with each shop\'s own search engine.',
        'Use Estonian terms (kurk, kanafilee, kreeka jogurt, täispiim); English words find almost nothing.',
        'Each product includes price (incl. VAT), discount, unit price, live in_stock, and ordering rules:',
        'qty_step and min_qty. For sold_by_weight items qty is in kg and must be a multiple of qty_step (e.g. 0.3, 0.6).',
        'Nutrition is per 100 g when the shop provides it.',
      ].join(' '),
      inputSchema: {
        query: z.string().min(1).describe('Search term, Estonian preferred'),
        stores: storesParam,
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(15).describe(`Max results per store (1-${MAX_SEARCH_LIMIT}, default 15)`),
        sort: z.enum(['relevance', 'price_asc', 'price_desc']).default('relevance').describe('Result order'),
      },
    },
    async ({ query, stores, limit, sort }) => {
      const results = await Promise.all(stores.map(s => searchStore(s, query, limit, sort)));
      if (results.length === 1) return json(results[0]);
      return json({ query, results });
    },
  );

  server.registerTool(
    'get_products',
    {
      title: 'Get products by SKU',
      description: 'Fetch full product details (price, stock, qty rules, nutrition) for known SKUs of one store, e.g. to re-check items before adding them.',
      inputSchema: {
        store: storeEnum.default('selver'),
        skus: z.array(z.string().min(1)).min(1).max(50).describe('Product SKUs, e.g. ["T000049036"]'),
      },
    },
    async ({ store, skus }) => {
      try {
        const products = await getStore(store).getProducts(skus);
        const found = new Set(products.map(p => p.sku));
        return json({ store, products, not_found: skus.filter(s => !found.has(s)) });
      } catch (e) {
        return json({ store, error: (e as Error).message });
      }
    },
  );

  server.registerTool(
    'compare_prices',
    {
      title: 'Price a shopping list across stores',
      description: [
        'Search every requested store for each shopping-list line and return the top candidates per store with line totals',
        '(price × qty, qty snapped to the store\'s step). Use it for "which shop is cheaper for this list" questions.',
        'The top candidate is the search engine\'s first in-stock hit; review the candidates and pick the right SKUs before calling add_to_cart.',
      ].join(' '),
      inputSchema: {
        items: z.array(z.object({
          query: z.string().min(1).describe('Estonian search term for the line, e.g. "kanafilee"'),
          qty: z.number().positive().default(1).describe('Pieces, or kg for weight goods'),
        })).min(1).max(40),
        stores: storesParam,
        candidates: z.number().int().min(1).max(10).default(3).describe('Candidates to return per line per store'),
      },
    },
    async ({ items, stores, candidates }) => {
      const perStore = await Promise.all(stores.map(async store => {
        const lines = await Promise.all(items.map(async item => {
          const r = await searchStore(store, item.query, Math.max(candidates, 5), 'relevance');
          if ('error' in r) return { query: item.query, qty: item.qty, error: r.error, candidates: [] as unknown[] };
          // In-stock first; then products whose name starts with the query (fresh "Tomat ..." before "Kons. tomatid").
          const q = item.query.trim().toLowerCase();
          const rank = (p: Product) => (p.in_stock === false ? 2 : 0) + (p.name.toLowerCase().startsWith(q) ? 0 : 1);
          const sorted = r.products.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p);
          const cands = sorted.slice(0, candidates).map(p => {
            const snapped = snapQty(item.qty, p.qty_step, p.min_qty);
            return {
              sku: p.sku, name: p.name, price: p.price, unit_price: p.unit_price, unit_price_per: p.unit_price_per,
              volume: p.volume, sold_by_weight: p.sold_by_weight, qty: snapped.qty, line_total: round2(p.price * snapped.qty), in_stock: p.in_stock,
            };
          });
          return { query: item.query, qty: item.qty, candidates: cands };
        }));
        const matched = lines.filter(l => l.candidates.length > 0);
        const top = matched.map(l => l.candidates[0] as { line_total: number });
        return {
          store,
          store_name: getStore(store).name,
          matched_lines: matched.length,
          unmatched: lines.filter(l => l.candidates.length === 0).map(l => l.query),
          estimated_total_top_candidates: round2(top.reduce((s, c) => s + c.line_total, 0)),
          lines,
        };
      }));
      return json({ items: items.length, stores: perStore, note: 'Totals use each line\'s top candidate and exclude delivery and packaging fees.' });
    },
  );
}
