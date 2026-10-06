import type { BrowserSyncInstructions } from '../../core/types.js';

/**
 * Scripts the agent runs inside selver.ee via a browser MCP (chrome-devtools-mcp evaluate_script).
 * Selver's Vue Storefront SPA keeps its own cart state and, for guests, ignores the server cart
 * unless items are replayed through its own store actions. These helpers produce that code.
 */

export const CART_TOKEN_STORAGE_KEY = 'shop/cart/current-cart-token';
export const SELVER_HOME = 'https://www.selver.ee';
export const SELVER_CART = 'https://www.selver.ee/cart';

export function setTokenScript(token: string): string {
  return `() => { localStorage.setItem(${JSON.stringify(CART_TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(token)})); return localStorage.getItem(${JSON.stringify(CART_TOKEN_STORAGE_KEY)}); }`;
}

export function replayScript(token: string): string {
  return `async () => {
  const token = ${JSON.stringify(token)};
  localStorage.setItem(${JSON.stringify(CART_TOKEN_STORAGE_KEY)}, JSON.stringify(token));
  const store = document.getElementById('app').__vue__.$store;
  if (store.state.cart.cartServerToken !== token) {
    const m = Object.keys(store._mutations || {}).find(k => k.startsWith('cart/') && /(SRV_TOKEN|SERVER_TOKEN|CART_TOKEN)/i.test(k));
    if (m) store.commit(m, token);
    if (store.state.cart.cartServerToken !== token) {
      return { token_loaded: false, hint: 'The SPA booted without this cart token. Reload https://www.selver.ee/cart (token is now in localStorage) and run this script again.' };
    }
  }
  const res = await fetch('/api/cart/pull?cartId=' + token + '&storeCode=et');
  const serverItems = (await res.json()).result || [];
  const added = [], skipped = [], mismatched = [], failed = [];
  for (const serverItem of serverItems) {
    const existing = store.state.cart.cartItems.find(i => i.sku === serverItem.sku);
    if (existing) {
      if (Math.abs(existing.qty - serverItem.qty) > 1e-4) {
        try {
          await store.dispatch('cart/updateQuantity', { product: existing, qty: serverItem.qty, forceServerSilence: true });
          mismatched.push({ sku: serverItem.sku, from: existing.qty, to: serverItem.qty });
        } catch (e) { failed.push({ sku: serverItem.sku, error: String(e) }); }
      } else {
        skipped.push(serverItem.sku);
      }
      continue;
    }
    try {
      const variant = await store.dispatch('cart/getProductVariant', { serverItem });
      if (!variant) { failed.push({ sku: serverItem.sku, error: 'no variant' }); continue; }
      await store.dispatch('cart/addItem', { productToAdd: variant, forceServerSilence: true });
      added.push(serverItem.sku);
    } catch (e) { failed.push({ sku: serverItem.sku, error: String(e) }); }
  }
  const serverSkus = new Set(serverItems.map(i => i.sku));
  const removed = [];
  for (const item of [...store.state.cart.cartItems]) {
    if (!serverSkus.has(item.sku)) {
      try { await store.dispatch('cart/removeItem', { product: item }); removed.push(item.sku); } catch (e) { failed.push({ sku: item.sku, error: String(e) }); }
    }
  }
  await store.dispatch('cart/syncTotals', { forceServerSync: true });
  await new Promise(r => setTimeout(r, 800));
  const totals = store.state.cart.platformTotals || {};
  return { added, skipped, mismatched, removed, failed, items: store.state.cart.cartItems.map(i => ({ sku: i.sku, name: i.name, qty: i.qty })), grand_total: totals.grand_total };
}`;
}

export function removeScript(skus: string[]): string {
  return `async () => {
  const store = document.getElementById('app').__vue__.$store;
  const skus = ${JSON.stringify(skus)};
  const removed = [];
  for (const sku of skus) {
    const item = store.state.cart.cartItems.find(i => i.sku === sku);
    if (item) { await store.dispatch('cart/removeItem', { product: item }); removed.push(sku); }
  }
  await store.dispatch('cart/syncTotals', { forceServerSync: true });
  return { removed, remaining: store.state.cart.cartItems.map(i => ({ sku: i.sku, qty: i.qty })) };
}`;
}

export function browserSyncInstructions(token: string): BrowserSyncInstructions {
  return {
    store: 'selver',
    cart_token: token,
    why: 'Selver\'s SPA ignores the server-side guest cart until its items are replayed through the page\'s own store. Run these steps with a browser MCP (chrome-devtools-mcp).',
    steps: [
      { step: 1, tool: 'mcp__chrome-devtools__new_page', args: { url: SELVER_CART }, note: 'If a selver.ee tab is already open, use list_pages + select_page instead of opening another.' },
      { step: 2, tool: 'mcp__chrome-devtools__evaluate_script', args: { function: '<replay_script below>' }, note: 'Run once the page has rendered. The script stores the token, replays server items through the SPA store, removes stale lines, and returns the resulting cart with grand_total.' },
      { step: 3, tool: 'mcp__chrome-devtools__take_screenshot', note: 'Optional: confirm the cart, then tell the user to log in and check out in that window.' },
    ],
    replay_script: replayScript(token),
    if_token_loaded_false: 'Rare: the script could not attach the token to the store. Run set_token_script, navigate to https://www.selver.ee/cart again, and rerun replay_script.',
    set_token_script: setTokenScript(token),
    after_remove_from_cart: 'Rerun replay_script (it removes lines that are gone on the server), or use remove_from_cart\'s browser_remove_script.',
  };
}
