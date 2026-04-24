---
name: selver-cart
description: Use this skill when the user wants to shop at Selver.ee - search products, build a cart, and open it in the browser for checkout. Handles weight-based goods (kg products with weight_step) and coordinates selver-mcp + chrome-devtools-mcp so the cart actually appears in the browser ready for checkout.
---

# Selver Cart Workflow

The user is shopping at Selver.ee (Estonian grocery chain). Two MCPs work together:
- **`selver-mcp`** - builds the server-side guest cart via Selver's API
- **`chrome-devtools-mcp`** - opens the cart in a real browser so the user can log in and check out

Neither MCP alone is enough. Always orchestrate both.

## When to use

Trigger on any request like:
- "Add X to my Selver cart"
- "Find me some Y at Selver and buy them"
- "Open my Selver cart"
- "Osta Selverist..." (Estonian: shop from Selver)

## Workflow

### 1. Search

Call `mcp__selver-mcp__search_products` with an Estonian query when possible (`leib`, `kana`, `kurk`, `piim`, `muna`).

Inspect the results. Note especially: `weight_step`.

### 2. Handle weight-based products

**If `weight_step` is not null** (e.g. cucumbers, tomatoes, meat sold by kg):
- `qty` MUST be a multiple of `weight_step` (e.g. `weight_step: 0.3` → valid qty: 0.3, 0.6, 0.9, ...)
- Integer qty will fail with "Toote samm on muutunud"
- When the user says "one cucumber", translate to the smallest reasonable multiple (usually 1 * weight_step, or ask if a typical single item is larger)

**If `weight_step` is null**: product is sold per-unit, use integer qty.

### 3. Add to cart

Call `mcp__selver-mcp__add_to_cart` with the SKUs and correct qty.

Check the response:
- Any items in `failed`? Read `error` - it now contains Selver's actual server message (e.g. step violations, stock issues).
- If weight-step violation, retry with the correct multiple.
- Save the `cart_token` - you'll need it to open the cart in the browser.

### 4. Open the cart in the browser (REQUIRED after any cart change)

The user wants to SEE the cart. Server-side cart is not enough. Orchestrate via chrome-devtools-mcp:

**Step A:** Open selver.ee (establishes the origin):
```
mcp__chrome-devtools__new_page url="https://www.selver.ee"
```

**Step B:** Set the cart token in localStorage:
```js
localStorage.setItem('shop/cart/current-cart-token', JSON.stringify('<CART_TOKEN>'));
```
(via `mcp__chrome-devtools__evaluate_script`)

**Step C:** Navigate to the cart page:
```
mcp__chrome-devtools__navigate_page type=url url="https://www.selver.ee/cart"
```

**Step D:** Replay server items through the SPA's own add-to-cart flow (this is the critical step - without it, the SPA shows an empty cart even though the server has items):

```js
async () => {
  const store = document.getElementById('app').__vue__.$store;
  const token = JSON.parse(localStorage.getItem('shop/cart/current-cart-token'));
  const res = await fetch(`/api/cart/pull?cartId=${token}&storeCode=et`);
  const serverItems = (await res.json()).result;

  for (const serverItem of serverItems) {
    const variant = await store.dispatch('cart/getProductVariant', { serverItem });
    if (variant) {
      await store.dispatch('cart/addItem', {
        productToAdd: variant,
        forceServerSilence: true,
      });
    }
  }
  await store.dispatch('cart/syncTotals', { forceServerSync: true });
  return { count: store.state.cart.cartItems.length };
}
```

Confirm the cart shows real products with correct prices. Tell the user to log in and check out.

### 5. Keeping an open browser in sync

If the browser is already open with items shown:

**After calling `add_to_cart`** - replay only the newly added items through the snippet above.

**After calling `remove_from_cart`** - also dispatch the SPA's removeItem in the browser, otherwise the removed items stay visible:

```js
async () => {
  const store = document.getElementById('app').__vue__.$store;
  const skusToRemove = ['<SKU1>', '<SKU2>'];
  for (const sku of skusToRemove) {
    const item = store.state.cart.cartItems.find(i => i.sku === sku);
    if (item) await store.dispatch('cart/removeItem', { product: item });
  }
  return { remaining: store.state.cart.cartItems.length };
}
```

## Common pitfalls

- **"Toote samm on muutunud"** - qty is not a multiple of weight_step. Read the step from the error message (e.g. "(0.3)") and retry.
- **Cart looks empty in browser** - Step D wasn't run, or was run too early (before the cart page loaded). Wait for the page to settle before the fetch.
- **Cart shows items but qty controls spin** - items weren't added via `getProductVariant` + `addItem {forceServerSilence: true}`. Internal flags missing. Always use the canonical snippet.
- **Chrome already running error** - if chrome-devtools-mcp complains about an existing browser instance, use `list_pages` to find the selver.ee tab and use `select_page` to work with it; don't call `new_page` again.

## Example: full session

User: "Add 2 loaves of bread and half a kg of cucumber to my Selver cart and open it."

1. `search_products(query="leib")` - pick 2 loaves, note their SKUs.
2. `search_products(query="kurk")` - pick a cucumber sold by kg, note `weight_step: 0.3`.
3. `add_to_cart(items=[{sku: bread1, qty: 1}, {sku: bread2, qty: 1}, {sku: cucumber, qty: 0.6}])` - note `cart_token`.
4. chrome-devtools-mcp: open selver.ee, set token in localStorage, navigate to /cart, run the replay snippet.
5. Tell user: "Your Selver cart has 2 loaves of bread and 0.6 kg of cucumber (€X.XX total). The cart is open in your browser - log in to complete checkout."
