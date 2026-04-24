// src/tools/search.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelverClient } from '../selver/client.js';

export function registerSearchTools(server: McpServer, client: SelverClient): void {
  server.tool(
    'search_products',
    'Search Selver.ee product catalog. Returns products with prices, nutrition per 100g, and stock status. Use Estonian terms for best results (e.g. "kana" for chicken, "riis" for rice, "lohe" for salmon).',
    {
      query: z.string().describe('Search query (Estonian preferred)'),
      limit: z.number().default(20).describe('Max results (default 20)'),
    },
    async (params) => {
      try {
        const results = await client.searchProducts(params.query, params.limit);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          }],
        };
      } catch (e) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: (e as Error).message,
              fallback_url: `https://www.selver.ee/otsing?q=${encodeURIComponent(params.query)}`,
            }),
          }],
        };
      }
    }
  );
}
