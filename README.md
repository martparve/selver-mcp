# selver-mcp

MCP server for searching [Selver.ee](https://www.selver.ee) products and managing your shopping cart. Works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Setup

```bash
git clone <repo-url>
cd selver-mcp
npm install
npm run build
```

## Install

### Claude Code

```bash
claude mcp add selver-mcp node /absolute/path/to/selver-mcp/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "selver-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/selver-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `search_products` | Search Selver.ee by query. Returns products with prices, nutrition, stock status. |
| `add_to_cart` | Add products to a guest cart by SKU. |
| `view_cart` | View cart contents and total. |
| `remove_from_cart` | Remove products from cart by SKU. |

## Checkout in a real browser

selver-mcp builds a Selver guest cart via the server API, but viewing and checking out that cart in the browser requires more than just opening `selver.ee/cart`. Selver's SPA:

1. Isolates `localStorage` per origin, so the cart token can't be injected from outside the selver.ee page
2. In default guest mode, treats the local (empty) cart as authoritative and ignores the server's items - even though its own API call returns them

The reliable way to restore a server cart in a fresh browser session is to orchestrate via [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp):

```bash
claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest
```

### Orchestration pattern

After `add_to_cart` returns a `cart_token`, instruct Claude to run these steps via chrome-devtools-mcp:

**Step 1:** Navigate to `https://www.selver.ee` (establishes the origin), then run:

```js
localStorage.setItem('shop/cart/current-cart-token', JSON.stringify('<CART_TOKEN>'));
```

**Step 2:** Navigate to `https://www.selver.ee/cart`.

**Step 3:** Run this snippet (pulls server items and replays them through the SPA's own add-to-cart flow with `forceServerSilence: true`, so no duplicate API calls):

```js
const store = document.getElementById('app').__vue_app__._instance.proxy.$store;
const token = JSON.parse(localStorage.getItem('shop/cart/current-cart-token'));
const serverItems = (await fetch(`/api/cart/pull?cartId=${token}&storeCode=et`).then(r => r.json())).result;

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
```

The cart now renders with real product images, working qty controls, correct totals, and a live checkout button. User can log in and complete purchase normally.

**Why this works:** `getProductVariant` fetches the full product record and merges in the server's `item_id` / `quote_id`. `addItem` with `forceServerSilence: true` runs the SPA's full client-side add logic (setting internal flags, triggering reactivity) without calling the server add endpoint - since the items are already there.

## Usage tips

- Use Estonian search terms: "kana" (chicken), "riis" (rice), "lohe" (salmon), "muna" (eggs)
- Cart persists between sessions via `~/.selver-mcp/cart.json`

## Requirements

- Node.js 18+
- No API keys or configuration needed
