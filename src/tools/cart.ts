// src/tools/cart.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SelverClient } from '../selver/client.js';
import { readCartToken, writeCartToken, clearCartToken } from '../storage/cart-token.js';

async function getOrCreateCart(client: SelverClient): Promise<string> {
  const existing = await readCartToken();
  if (existing) return existing;
  const token = await client.createCart();
  if (!token) throw new Error('Failed to create Selver cart');
  await writeCartToken(token);
  return token;
}

export function registerCartTools(server: McpServer, client: SelverClient): void {
  server.tool(
    'add_to_cart',
    'Add products to Selver.ee guest cart by SKU. Creates a new cart if none exists. Server-side only - if a browser is open on selver.ee/cart, you must ALSO dispatch cart/addItem via chrome-devtools-mcp to keep the browser in sync (see README).',
    {
      items: z.array(z.object({
        sku: z.string().describe('Product SKU (e.g. "T000089179")'),
        qty: z.number().describe('Quantity to add'),
      })),
    },
    async (params) => {
      let token: string;
      try {
        token = await getOrCreateCart(client);
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: (e as Error).message }) }],
        };
      }

      const added: string[] = [];
      const failed: Array<{ sku: string; error: string }> = [];

      for (const item of params.items) {
        const ok = await client.addToCart(token, item.sku, item.qty);
        if (ok) {
          added.push(item.sku);
        } else {
          failed.push({ sku: item.sku, error: 'Add failed' });
        }
      }

      if (added.length === 0 && failed.length > 0) {
        await clearCartToken();
        const newToken = await client.createCart();
        if (newToken) {
          token = newToken;
          await writeCartToken(token);
          added.length = 0;
          failed.length = 0;
          for (const item of params.items) {
            const ok = await client.addToCart(token, item.sku, item.qty);
            if (ok) {
              added.push(item.sku);
            } else {
              failed.push({ sku: item.sku, error: 'Add failed after cart retry' });
            }
          }
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ added, failed, cart_token: token }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'view_cart',
    'View current Selver.ee cart contents and total price.',
    {},
    async () => {
      const token = await readCartToken();
      if (!token) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active cart. Use add_to_cart first.' }) }],
        };
      }
      const items = await client.getCart(token);
      const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ items, total: Math.round(total * 100) / 100 }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'remove_from_cart',
    'Remove products from Selver.ee cart by SKU. Server-side only - if a browser is open on selver.ee/cart, you must ALSO dispatch cart/removeItem via chrome-devtools-mcp to keep the browser in sync (see README).',
    {
      items: z.array(z.object({
        sku: z.string().describe('Product SKU to remove'),
      })),
    },
    async (params) => {
      const token = await readCartToken();
      if (!token) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active cart.' }) }],
        };
      }

      const cartItems = await client.getCart(token);
      const removed: string[] = [];
      const failed: Array<{ sku: string; error: string }> = [];

      for (const req of params.items) {
        const match = cartItems.find(ci => ci.sku === req.sku);
        if (!match) {
          failed.push({ sku: req.sku, error: 'Item not found in cart' });
          continue;
        }
        const ok = await client.deleteCartItem(token, req.sku, match.item_id);
        if (ok) {
          removed.push(req.sku);
        } else {
          failed.push({ sku: req.sku, error: 'Delete failed' });
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ removed, failed }, null, 2),
        }],
      };
    }
  );

}
