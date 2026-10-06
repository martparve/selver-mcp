import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  BrowserCartApi, BrowserCartOp, CartItem, CartTotals, Product, PutCartItemResult, PutMode, ServerCartApi, StoreAdapter, StoreId,
} from '../core/types.js';
import { STORE_IDS, getStore } from '../stores/registry.js';
import { readCartToken, writeCartToken, clearCartToken } from '../storage/cart-token.js';
import { round2, snapQty } from '../core/qty.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const storeEnum = z.enum(STORE_IDS);

const SERVER_SYNC_HINT = 'Server cart updated. To show it in the browser call get_browser_sync_script for this store and follow its steps with chrome-devtools-mcp.';
const BROWSER_HINT = 'This store\'s cart lives in the browser session. Run the returned script in the store\'s tab via chrome-devtools-mcp evaluate_script; its return value is the real cart state.';

type ServerStore = StoreAdapter & { cart: ServerCartApi };
type BrowserStore = StoreAdapter & { cart: BrowserCartApi };

function isServer(store: StoreAdapter): store is ServerStore {
  return store.cart.kind === 'server';
}

// ---------- server-cart helpers (Selver model) ----------

async function getOrCreateCart(store: ServerStore): Promise<string> {
  const existing = await readCartToken(store.id);
  if (existing) return existing;
  return newCart(store);
}

async function newCart(store: ServerStore): Promise<string> {
  await clearCartToken(store.id);
  const token = await store.cart.create();
  if (!token) throw new Error(`Failed to create a ${store.name} cart`);
  await writeCartToken(store.id, token);
  return token;
}

function cartView(items: CartItem[], totals: CartTotals | null) {
  const byId = new Map(totals?.items.map(i => [String(i.item_id), i]) ?? []);
  const lines = items.map(i => {
    const t = byId.get(String(i.item_id));
    return {
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      price_incl_tax: t?.price_incl_tax ?? round2(i.price_excl_tax * 1.24),
      row_total: t?.row_total_incl_tax ?? round2(i.price_excl_tax * 1.24 * i.qty),
    };
  });
  return {
    item_count: lines.length,
    items: lines,
    subtotal: totals?.subtotal_incl_tax ?? round2(lines.reduce((s, l) => s + l.row_total, 0)),
    discount: totals?.discount_amount ?? 0,
    packaging_fee: totals?.packaging_fee ?? null,
    grand_total: totals?.grand_total ?? null,
    note: totals ? 'grand_total includes VAT and the shop\'s bag/packaging fee; delivery is chosen at checkout.' : 'Totals endpoint unavailable; subtotal estimated from net prices.',
  };
}

async function fullCart(store: ServerStore, token: string) {
  const [items, totals] = await Promise.all([store.cart.getItems(token), store.cart.getTotals(token)]);
  return cartView(items ?? [], totals);
}

// ---------- browser-cart helpers (Rimi, Barbora model) ----------

async function resolveOps(store: BrowserStore, items: Array<{ sku: string; qty: number }>) {
  const products = await store.getProducts(items.map(i => i.sku));
  const bySku = new Map<string, Product>(products.map(p => [p.sku, p]));
  const ops: BrowserCartOp[] = [];
  const resolved: Array<{ sku: string; name: string; qty: number; requested_qty: number; qty_adjusted?: true; line_total: number }> = [];
  const failed: Array<{ sku: string; requested_qty: number; error: string }> = [];
  for (const it of items) {
    const p = bySku.get(it.sku);
    if (!p) { failed.push({ sku: it.sku, requested_qty: it.qty, error: `Unknown SKU (not found in ${store.name})` }); continue; }
    if (p.in_stock === false) { failed.push({ sku: it.sku, requested_qty: it.qty, error: 'Not available in the e-shop' }); continue; }
    const snapped = snapQty(it.qty, p.qty_step, p.min_qty);
    ops.push({ sku: p.sku, qty: snapped.qty, name: p.name, meta: store.opMeta?.(p.sku) });
    resolved.push({ sku: p.sku, name: p.name, qty: snapped.qty, requested_qty: it.qty, ...(snapped.adjusted ? { qty_adjusted: true as const } : {}), line_total: round2(p.price * snapped.qty) });
  }
  return { ops, resolved, failed };
}

export function registerCartTools(server: McpServer): void {
  server.registerTool(
    'add_to_cart',
    {
      title: 'Add or set items in a store cart',
      description: [
        'Put products in one store\'s cart by SKU.',
        'Selver: the cart is built server-side immediately (guest cart; created if needed).',
        'Rimi and Barbora: the cart lives in the browser session, so the tool resolves products and quantities and returns a script to run in that store\'s tab (Barbora needs the user logged in).',
        'mode "set" (default) makes each line exactly qty; mode "add" increases an existing line (Selver only; browser stores treat it as set).',
        'Quantities are snapped up to the product\'s qty_step/min_qty (weight goods are in kg, e.g. 0.3).',
      ].join(' '),
      inputSchema: {
        store: storeEnum.default('selver'),
        items: z.array(z.object({
          sku: z.string().min(1).describe('Product SKU from search_products of the same store'),
          qty: z.number().positive().describe('Pieces for unit goods, kg for sold_by_weight goods'),
        })).min(1).max(50),
        mode: z.enum(['set', 'add']).default('set'),
      },
    },
    async ({ store: storeId, items, mode }) => {
      const store = getStore(storeId);

      if (!isServer(store)) {
        const bstore = store as BrowserStore;
        const { ops, resolved, failed } = await resolveOps(bstore, items);
        const script = bstore.cart.applyScript(ops);
        return json({
          store: storeId,
          kind: 'browser',
          resolved,
          failed,
          estimated_total: round2(resolved.reduce((s, r) => s + r.line_total, 0)),
          browser: bstore.cart.instructions(script, `Set ${ops.length} line(s) in the ${store.name} cart`),
          next_step: BROWSER_HINT,
        });
      }

      let token: string;
      try {
        token = await getOrCreateCart(store);
      } catch (e) {
        return json({ store: storeId, error: (e as Error).message });
      }

      const run = async (tok: string) => {
        const [products, cart] = await Promise.all([store.getProducts(items.map(i => i.sku)), store.cart.getItems(tok)]);
        if (cart === null) return { expired: true as const, results: [] as PutCartItemResult[] };
        const bySku = new Map<string, Product>(products.map(p => [p.sku, p]));
        const results: PutCartItemResult[] = [];
        let current: CartItem[] = cart;
        for (const it of items) {
          const product = bySku.get(it.sku);
          if (!product) {
            results.push({ ok: false, sku: it.sku, requested_qty: it.qty, error: `Unknown SKU (not in ${store.name} catalog)` });
            continue;
          }
          if (product.in_stock === false) {
            results.push({ ok: false, sku: it.sku, name: product.name, requested_qty: it.qty, error: 'Out of stock in the e-shop' });
            continue;
          }
          const existing = current.find(c => c.sku === it.sku);
          const r = await store.cart.putItem(tok, it.sku, it.qty, mode as PutMode, product, existing);
          results.push(r);
          if (r.expired_token) return { expired: true as const, results };
          if (r.ok) current = (await store.cart.getItems(tok)) ?? current;
        }
        return { expired: false as const, results };
      };

      let outcome = await run(token);
      let recreated = false;
      if (outcome.expired) {
        token = await newCart(store);
        recreated = true;
        outcome = await run(token);
      }

      return json({
        store: storeId,
        kind: 'server',
        cart_token: token,
        cart_recreated: recreated || undefined,
        added: outcome.results.filter(r => r.ok).map(r => ({ sku: r.sku, name: r.name, qty: r.qty, requested_qty: r.requested_qty, qty_adjusted: r.qty_adjusted || undefined })),
        failed: outcome.results.filter(r => !r.ok).map(r => ({ sku: r.sku, name: r.name, requested_qty: r.requested_qty, error: r.error })),
        cart: await fullCart(store, token),
        next_step: SERVER_SYNC_HINT,
      });
    },
  );

  server.registerTool(
    'view_cart',
    {
      title: 'View store carts',
      description: 'Selver: current cart lines with prices incl. VAT and the real grand total. Rimi/Barbora: returns a script that reads the cart from the store\'s browser tab. store "all" lists every store.',
      inputSchema: {
        store: z.union([storeEnum, z.literal('all')]).default('all'),
      },
    },
    async ({ store: which }) => {
      const ids: StoreId[] = which === 'all' ? [...STORE_IDS] : [which];
      const carts: unknown[] = [];
      for (const id of ids) {
        const store = getStore(id);
        if (!isServer(store)) {
          const bstore = store as BrowserStore;
          if (which === 'all') {
            carts.push({ store: id, kind: 'browser', note: `Cart lives in the ${store.name} browser tab. Call view_cart with store="${id}" for the read script.` });
          } else {
            carts.push({ store: id, kind: 'browser', browser: bstore.cart.instructions(bstore.cart.readScript(), `Read the ${store.name} cart`), next_step: BROWSER_HINT });
          }
          continue;
        }
        const token = await readCartToken(id);
        if (!token) { carts.push({ store: id, kind: 'server', items: [], item_count: 0, grand_total: 0, note: 'No cart yet. add_to_cart creates one.' }); continue; }
        const items = await store.cart.getItems(token);
        if (items === null) {
          await clearCartToken(id);
          carts.push({ store: id, kind: 'server', items: [], item_count: 0, grand_total: 0, note: 'Previous cart expired on the shop\'s side; a new one is created on the next add_to_cart.' });
          continue;
        }
        const totals = await store.cart.getTotals(token);
        carts.push({ store: id, kind: 'server', cart_token: token, ...cartView(items, totals) });
      }
      return json(carts.length === 1 ? carts[0] : { carts });
    },
  );

  server.registerTool(
    'remove_from_cart',
    {
      title: 'Remove items from a store cart',
      description: 'Remove lines from one store\'s cart by SKU. Selver: done server-side (then run get_browser_sync_script if a tab is open). Rimi/Barbora: returns a script to run in the store\'s tab.',
      inputSchema: {
        store: storeEnum.default('selver'),
        skus: z.array(z.string().min(1)).min(1).max(50),
      },
    },
    async ({ store: storeId, skus }) => {
      const store = getStore(storeId);
      if (!isServer(store)) {
        const bstore = store as BrowserStore;
        const ops: BrowserCartOp[] = skus.map(sku => ({ sku, qty: null }));
        return json({ store: storeId, kind: 'browser', browser: bstore.cart.instructions(bstore.cart.applyScript(ops), `Remove ${skus.length} line(s) from the ${store.name} cart`), next_step: BROWSER_HINT });
      }
      const token = await readCartToken(storeId);
      if (!token) return json({ store: storeId, error: 'No active cart.' });
      const cartItems = (await store.cart.getItems(token)) ?? [];
      const removed: string[] = [];
      const failed: Array<{ sku: string; error: string }> = [];
      for (const sku of skus) {
        const match = cartItems.find(ci => ci.sku === sku);
        if (!match) { failed.push({ sku, error: 'Not in cart' }); continue; }
        (await store.cart.deleteItem(token, sku, match.item_id)) ? removed.push(sku) : failed.push({ sku, error: 'Delete failed' });
      }
      return json({ store: storeId, kind: 'server', removed, failed, cart: await fullCart(store, token), browser_remove_script: removed.length ? store.cart.removeScript(removed) : undefined });
    },
  );

  server.registerTool(
    'clear_cart',
    {
      title: 'Empty a store cart',
      description: 'Remove every line from one store\'s cart. Selver: server-side. Rimi/Barbora: returns a script to run in the store\'s tab.',
      inputSchema: {
        store: storeEnum.default('selver'),
      },
    },
    async ({ store: storeId }) => {
      const store = getStore(storeId);
      if (!isServer(store)) {
        const bstore = store as BrowserStore;
        return json({ store: storeId, kind: 'browser', browser: bstore.cart.instructions(bstore.cart.clearScript(), `Empty the ${store.name} cart`), next_step: BROWSER_HINT });
      }
      const token = await readCartToken(storeId);
      if (!token) return json({ store: storeId, removed: [], note: 'No active cart.' });
      const items = (await store.cart.getItems(token)) ?? [];
      const removed: string[] = [];
      const failed: string[] = [];
      for (const it of items) {
        (await store.cart.deleteItem(token, it.sku, it.item_id)) ? removed.push(it.sku) : failed.push(it.sku);
      }
      return json({ store: storeId, kind: 'server', removed, failed, browser_remove_script: removed.length ? store.cart.removeScript(removed) : undefined });
    },
  );

  server.registerTool(
    'get_browser_sync_script',
    {
      title: 'Get the browser steps that make a cart visible',
      description: [
        'Returns the exact chrome-devtools-mcp steps and JavaScript needed to show one store\'s current cart in a real browser.',
        'Selver: replays the server cart into the selver.ee tab. Rimi/Barbora: opens the store tab and reads the cart there.',
        'Call this after add_to_cart or remove_from_cart whenever the user should see or check out the cart.',
      ].join(' '),
      inputSchema: {
        store: storeEnum.default('selver'),
      },
    },
    async ({ store: storeId }) => {
      const store = getStore(storeId);
      if (!isServer(store)) {
        const bstore = store as BrowserStore;
        return json(bstore.cart.instructions(bstore.cart.readScript(), `Show the ${store.name} cart`));
      }
      const token = await readCartToken(storeId);
      if (!token) return json({ store: storeId, error: 'No active cart. Use add_to_cart first.' });
      return json(store.cart.browserSync(token));
    },
  );
}
