# selver-mcp

Let Claude shop at [Selver.ee](https://www.selver.ee) for you. Search products, build a shopping cart, and open it in your browser ready for checkout - all from a conversation with Claude.

**Works with:** Claude Desktop, Claude Code, and any MCP-compatible client.

## What you get

You tell Claude something like *"add two loaves of bread and half a kg of cucumber to my Selver cart and open it"* and Claude:

1. Searches Selver.ee for matching products
2. Picks the best options (handles weight-based goods correctly)
3. Builds a guest cart on selver.ee
4. Opens Chrome with the cart visible, ready for you to log in and pay

No credentials leave your machine. selver-mcp never sees your Selver.ee password.

## Easiest install: let your AI agent do it

If you already have an AI coding agent with shell and filesystem access - **Claude Code** works out of the box, Claude Desktop works if you have a filesystem or shell MCP installed - the fastest install is to paste this prompt:

> Please install selver-mcp from https://github.com/martparve/selver-mcp following its README. Set up both MCPs (selver-mcp and chrome-devtools) and configure the CLAUDE.md workflow section for me. Then restart yourself.

The agent will clone the repo, run `npm install && npm run build`, wire up the MCPs in your config file, copy the skill (Claude Code) or append to `~/.claude/CLAUDE.md` (Claude Desktop), and tell you to restart.

If your agent doesn't have those permissions (browser-only ChatGPT, Claude.ai web, etc.), fall back to the manual steps below.

## Prerequisites

You need **Node.js 18 or newer**. Check if you have it:

```bash
node --version
```

If you see `v18.x.x` or higher, you're set. Otherwise:

- **macOS**: easiest is [Homebrew](https://brew.sh) → `brew install node`
- **Windows / Linux / any OS**: download from [nodejs.org](https://nodejs.org) (pick the LTS version)

## Install - Claude Code

### 1. Download selver-mcp

Open a terminal and run:

```bash
git clone https://github.com/martparve/selver-mcp.git ~/selver-mcp
cd ~/selver-mcp
npm install
npm run build
```

This downloads the code, installs dependencies, and compiles it. Takes about a minute.

### 2. Connect it to Claude Code

```bash
claude mcp add selver-mcp node ~/selver-mcp/dist/index.js
```

### 3. Install the browser helper

selver-mcp builds your cart on Selver's servers, but to actually **see and check out** the cart, Claude needs a browser-control helper called `chrome-devtools-mcp`. One command:

```bash
claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest
```

### 4. Install the skill (optional but recommended)

A skill tells Claude how to use both MCPs together automatically. Without it, you'd need to remind Claude to open the browser after building the cart.

```bash
mkdir -p ~/.claude/skills/selver-cart
cp ~/selver-mcp/skills/selver-cart/SKILL.md ~/.claude/skills/selver-cart/SKILL.md
```

### 5. Restart Claude Code

Close any running Claude Code session and start a new one. The MCPs are now available.

### 6. Try it

In a new Claude Code chat, type:

> Lisa mulle Selverist 2 pätsi musta leiba ja ava cart

or in English:

> Add 2 black breads from Selver to my cart and open it in the browser

Claude should search, add, open a Chrome window showing your cart, and tell you to log in.

## Install - Claude Desktop

### 1. Download selver-mcp

Same as Claude Code step 1:

```bash
git clone https://github.com/martparve/selver-mcp.git ~/selver-mcp
cd ~/selver-mcp
npm install
npm run build
```

### 2. Find your Claude Desktop config file

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist, create it.

### 3. Add both MCPs to the config

Open the config file in any text editor and paste this (if you already have other MCPs, merge the `mcpServers` section):

```json
{
  "mcpServers": {
    "selver-mcp": {
      "command": "node",
      "args": ["/Users/YOUR_NAME/selver-mcp/dist/index.js"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

**Important:** replace `/Users/YOUR_NAME/selver-mcp` with the actual path where you cloned the repo. On Windows this might be something like `C:\\Users\\YourName\\selver-mcp` - note the double backslashes.

### 4. Save the workflow as a Claude Desktop memory

Claude Desktop doesn't read `~/.claude/CLAUDE.md` or auto-discover `~/.claude/skills/` the way Claude Code does. Without the workflow in context, Claude Desktop will open an empty cart page instead of the real cart.

The fix is Claude Desktop's **memory** feature: you paste the instructions into a chat and ask Claude to save them. Memories persist across all future conversations.

**Restart Claude Desktop first** (so the new MCPs are loaded), then in a new chat paste:

> Please save the following as a memory so you always follow it when I shop at Selver.ee:
>
> ---
>
> When the user wants to shop at Selver.ee, always use BOTH `selver-mcp` (server-side cart) and `chrome-devtools` (browser) together. Neither alone is enough.
>
> After `add_to_cart` returns a `cart_token`, do all four steps in the browser:
>
> 1. Open `https://www.selver.ee` via `mcp__chrome-devtools__new_page`
> 2. Run `evaluate_script`: `localStorage.setItem('shop/cart/current-cart-token', JSON.stringify('<CART_TOKEN>'))`
> 3. Navigate to `https://www.selver.ee/cart`
> 4. Run this replay snippet (skip items already in `cartItems` to avoid doubled qty):
>
> ```js
> async () => {
>   const store = document.getElementById('app').__vue__.$store;
>   const token = JSON.parse(localStorage.getItem('shop/cart/current-cart-token'));
>   const serverItems = (await fetch(`/api/cart/pull?cartId=${token}&storeCode=et`).then(r => r.json())).result;
>   for (const it of serverItems) {
>     if (store.state.cart.cartItems.find(i => i.sku === it.sku)) continue;
>     const variant = await store.dispatch('cart/getProductVariant', { serverItem: it });
>     if (variant) await store.dispatch('cart/addItem', { productToAdd: variant, forceServerSilence: true });
>   }
>   await store.dispatch('cart/syncTotals', { forceServerSync: true });
> }
> ```
>
> For weight-based products (`weight_step` not null), `qty` must be a multiple of `weight_step` (e.g. 0.3, 0.6, 0.9...). Integer qty on weight goods fails with "Toote samm on muutunud".

Claude Desktop will confirm the memory was saved. From the next message onwards, it will follow this workflow automatically for any Selver request.

Full reference including pitfalls is in `skills/selver-cart/SKILL.md` in this repo.

### 5. Try it

In a new chat:

> Lisa mulle Selverist 2 pätsi leiba ja ava cart

Claude Desktop should search, add, open Chrome with the cart populated, and tell you to log in. The first time MCP tools are used, Claude Desktop will ask permission - click Allow.

## How to verify it works

Ask Claude in a new chat:

> What Selver tools do you have available?

Claude should list four tools: `search_products`, `add_to_cart`, `view_cart`, `remove_from_cart`. Plus a bunch of `chrome-devtools` tools.

## Usage examples

**Build a shopping cart and open the browser:**
> Leia mulle Selverist 5 erinevat juustu ja ava cart brauseris.

**Just search, don't commit:**
> Mis on praegu Selveris odavaim kuivtoit?

**Remove items:**
> Võta kurk ostukorvist välja.

**Start fresh:**
> Tühjenda mu Selveri cart.

### Tips

- Use Estonian search terms for best results: `leib` (bread), `piim` (milk), `muna` (egg), `kana` (chicken)
- Cart persists between conversations - pick up tomorrow where you left off
- For weight-based goods (cucumber, meat, vegetables sold by kg), Claude will automatically figure out valid quantities (e.g. 0.3 kg increments)

## Troubleshooting

**"The browser is already running" error**

Left over from a previous session. Close any orphan Chrome windows manually, or run:

```bash
pkill -f 'chrome-devtools-mcp/chrome-profile'
```

**Cart is empty in the browser even though Claude added items**

The skill handles this automatically. If you skipped the skill install, remind Claude: *"use chrome-devtools to replay the server cart items via cart/getProductVariant and cart/addItem with forceServerSilence: true"*.

**"Toote samm on muutunud" error when adding weight goods**

The product is sold in fixed kg increments (e.g. 0.3 kg). Use valid multiples: 0.3, 0.6, 0.9... Claude should handle this automatically; if not, tell it the product's `weight_step`.

**npm command not found**

You haven't installed Node.js. See the Prerequisites section above.

**claude command not found**

Claude Code CLI isn't installed or isn't on your PATH. Check the [Claude Code docs](https://docs.claude.com/en/docs/claude-code) for installation.

## Updating

When there's a new version:

```bash
cd ~/selver-mcp
git pull
npm install
npm run build
```

Then restart Claude Code or Claude Desktop.

## Uninstall

**Claude Code:**

```bash
claude mcp remove selver-mcp
claude mcp remove chrome-devtools
rm -rf ~/selver-mcp
rm -rf ~/.claude/skills/selver-cart
```

**Claude Desktop:** remove the `selver-mcp` and `chrome-devtools` entries from `claude_desktop_config.json` and delete `~/selver-mcp`.

Your guest cart token lives at `~/.selver-mcp/cart.json`. Delete that to start completely fresh.

---

## For developers

Everything below is for people who want to understand the internals or contribute.

### Tools

| Tool | Description |
|------|-------------|
| `search_products` | Search Selver.ee by query. Returns products with prices, nutrition, stock status, and `weight_step` for weight-based goods. |
| `add_to_cart` | Add products to a guest cart by SKU. Returns server error messages verbatim (e.g. `"Toote samm on muutunud (0.3)"`). |
| `view_cart` | View cart contents and total. |
| `remove_from_cart` | Remove products from cart by SKU. |

### Checkout in a real browser - the technical reality

selver-mcp builds a Selver guest cart via the server API, but viewing and checking out that cart in the browser requires more than just opening `selver.ee/cart`. Selver's Vue Storefront SPA:

1. Isolates `localStorage` per origin, so the cart token can't be injected from outside the selver.ee page
2. In default guest mode, treats the local (empty) cart as authoritative and ignores the server's items - even though its own API call returns them

### Orchestration pattern

After `add_to_cart` returns a `cart_token`, instruct Claude to run these steps via chrome-devtools-mcp:

**Step 1:** Navigate to `https://www.selver.ee` (establishes the origin), then run:

```js
localStorage.setItem('shop/cart/current-cart-token', JSON.stringify('<CART_TOKEN>'));
```

**Step 2:** Navigate to `https://www.selver.ee/cart`.

**Step 3:** Run this snippet (pulls server items and replays them through the SPA's own add-to-cart flow with `forceServerSilence: true`, so no duplicate API calls). Note the SKU-existence check before each `addItem` - without it, items already in `cartItems` get their qty added (e.g. 0.6 kg cucumber becomes 1.2 kg) because `cart/addItem` is a merge-qty operation, not replace:

```js
const store = document.getElementById('app').__vue__.$store;
const token = JSON.parse(localStorage.getItem('shop/cart/current-cart-token'));
const serverItems = (await fetch(`/api/cart/pull?cartId=${token}&storeCode=et`).then(r => r.json())).result;

const added = [], skipped = [], mismatched = [];
for (const serverItem of serverItems) {
  const existing = store.state.cart.cartItems.find(i => i.sku === serverItem.sku);
  if (existing) {
    if (Math.abs(existing.qty - serverItem.qty) > 1e-4) {
      mismatched.push({ sku: serverItem.sku, client_qty: existing.qty, server_qty: serverItem.qty });
    } else {
      skipped.push(serverItem.sku);
    }
    continue;
  }
  const variant = await store.dispatch('cart/getProductVariant', { serverItem });
  if (variant) {
    await store.dispatch('cart/addItem', {
      productToAdd: variant,
      forceServerSilence: true,
    });
    added.push(serverItem.sku);
  }
}
await store.dispatch('cart/syncTotals', { forceServerSync: true });
```

Returns `{added, skipped, mismatched}`. If `mismatched` is non-empty, client and server disagree on qty for some SKU - call `cart/updateItem` with the server qty or ask the user.

**Why this works:** `getProductVariant` fetches the full product record and merges in the server's `item_id` / `quote_id`. `addItem` with `forceServerSilence: true` runs the SPA's full client-side add logic (setting internal flags, triggering reactivity) without calling the server add endpoint - since the items are already there.

### Keeping an open browser in sync

`add_to_cart` / `remove_from_cart` mutate the server cart only. A browser already open on `selver.ee/cart` has its own Vuex state that won't update automatically.

**After `add_to_cart`** - run the orchestration snippet above (replays new server items through `cart/addItem`).

**After `remove_from_cart`** - run:

```js
const store = document.getElementById('app').__vue__.$store;
const skusToRemove = ['<SKU1>', '<SKU2>'];
for (const sku of skusToRemove) {
  const item = store.state.cart.cartItems.find(i => i.sku === sku);
  if (item) await store.dispatch('cart/removeItem', { product: item });
}
```

### Build from source

```bash
npm install      # install dependencies
npm run build    # compile TypeScript to dist/
npm test         # run unit tests (36 tests)
npm run dev      # watch mode
```

### Architecture

```
src/
├── index.ts            # MCP server entry point (stdio transport)
├── tools/              # MCP tool handlers (Zod schemas, response formatting)
│   ├── search.ts       # search_products
│   └── cart.ts         # add_to_cart, view_cart, remove_from_cart
├── selver/             # Selver.ee HTTP layer (reusable, no MCP deps)
│   ├── client.ts       # SelverClient: search + guest cart API
│   ├── parser.ts       # Nutrition string parsing (Estonian comma decimals)
│   └── types.ts        # Product, CartItem, etc.
└── storage/
    └── cart-token.ts   # Read/write ~/.selver-mcp/cart.json
```
