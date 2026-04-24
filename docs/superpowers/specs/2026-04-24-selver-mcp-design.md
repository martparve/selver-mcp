# selver-mcp Design Spec

## Overview

Standalone MCP server that exposes Selver.ee (Estonian grocery chain) product search and cart management as tools for Claude Code, Claude Desktop, and any MCP-compatible client. Extracted from the broader Selver nutrition project, scoped to what requires actual API access - product discovery and cart operations. Nutrition calculation, recipe management, and meal planning are left to Claude's native capabilities via prompt-level guidance.

## Tools

### search_products

**Input:** `{ query: string, limit?: number }` (default limit: 20)

**Behavior:** Hits `https://www.selver.ee/api/catalog/vue_storefront_catalog_et/product/_search?q={query}&size={limit}`. Parses raw Selver response into clean product objects.

**Returns:** Array of:
```typescript
{
  sku: string
  name: string
  slug: string
  price: number          // EUR incl. tax
  unit_price: number     // per kg/L/unit
  volume: string | null  // "1kg", "500ml", etc.
  in_stock: boolean
  nutrition: {
    energy_kcal: number
    protein_g: number
    carbs_g: number
    fat_g: number
  } | null
}
```

Nutrition is parsed from Selver's raw string fields (e.g. `"1,5g"` -> `1.5`). Returns `null` for nutrition if data is missing or unparseable.

### add_to_cart

**Input:** `{ items: { sku: string, qty: number }[] }`

**Behavior:**
1. Reads cart token from `~/.selver-mcp/cart.json`
2. If no token exists, calls `POST /api/cart/create` to get one
3. For each item: `POST /api/cart/update?token={token}&cartId={token}` with `{ cartItem: { sku, qty, quoteId: token } }`
4. Persists token to `~/.selver-mcp/cart.json`
5. If token is expired/invalid (API returns error), creates a new cart and retries

**Returns:**
```typescript
{
  added: string[]              // SKUs successfully added
  failed: { sku: string, error: string }[]
  cart_token: string
}
```

### view_cart

**Input:** none

**Behavior:** Reads token from `~/.selver-mcp/cart.json`, calls `GET /api/cart/pull?token={token}`.

**Returns:**
```typescript
{
  items: { sku: string, name: string, qty: number, price: number }[]
  total: number
}
```

Returns error if no active cart.

### remove_from_cart

**Input:** `{ items: { sku: string }[] }`

**Behavior:** Reads token, calls `POST /api/cart/delete?token={token}` for each item.

**Returns:**
```typescript
{
  removed: string[]            // SKUs successfully removed
  failed: { sku: string, error: string }[]
}
```

### open_cart

**Input:** none

**Behavior:** Opens `https://www.selver.ee/cart` in the user's default browser using OS-native command:
- macOS: `open`
- Linux: `xdg-open`
- Windows: `start`

**Returns:** `{ message: "Opened Selver cart in your browser - log in to complete checkout" }`

## Architecture

### Project structure

```
selver-mcp/
├── src/
│   ├── index.ts            # MCP server setup, tool registration, stdio transport
│   ├── tools/
│   │   ├── search.ts       # search_products handler
│   │   └── cart.ts         # add_to_cart, view_cart, remove_from_cart, open_cart
│   ├── selver/
│   │   ├── client.ts       # SelverClient - all HTTP calls to selver.ee
│   │   ├── parser.ts       # Nutrition string parsing
│   │   └── types.ts        # Product, CartItem, API response types
│   └── storage/
│       └── cart-token.ts   # Read/write ~/.selver-mcp/cart.json
├── tests/
│   ├── parser.test.ts
│   ├── client.test.ts
│   └── cart.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Layer separation

- **`tools/`** - MCP concern: Zod input schemas, response formatting, tool registration callbacks. Depends on `selver/` and `storage/`.
- **`selver/`** - HTTP concern: raw API calls, response parsing, type definitions. No MCP dependency. Independently testable.
- **`storage/`** - Persistence concern: cart token read/write. Thin wrapper around `~/.selver-mcp/cart.json`.

### Key type definitions

```typescript
// selver/types.ts

interface SelverRawProduct {
  sku: string
  name: string
  slug: string
  price_incl_tax: number
  final_price_incl_tax: number
  unit_price: number
  product_volume: string | null
  image: string
  stock: { is_in_stock: boolean }
  product_nutr_energy: string
  product_nutr_proteins: string
  product_nutr_carbohydrates: string
  product_nutr_fats: string
}

interface Product {
  sku: string
  name: string
  slug: string
  price: number
  unit_price: number
  volume: string | null
  in_stock: boolean
  nutrition: NutritionPer100g | null
}

interface NutritionPer100g {
  energy_kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

interface CartItem {
  item_id: number
  sku: string
  name: string
  qty: number
  price: number
}
```

### Selver.ee API endpoints used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/catalog/vue_storefront_catalog_et/product/_search` | GET | Product search |
| `/api/cart/create` | POST | Create guest cart, returns token |
| `/api/cart/update?token={t}&cartId={t}` | POST | Add/update cart item |
| `/api/cart/pull?token={t}` | GET | Fetch cart contents |
| `/api/cart/delete?token={t}` | POST | Remove cart item |

No authentication needed. All endpoints are unauthenticated guest APIs.

### Cart token lifecycle

1. First `add_to_cart` call creates token via `POST /api/cart/create`
2. Token persisted to `~/.selver-mcp/cart.json` as `{ "token": "abc123", "created_at": "ISO-timestamp" }`
3. Subsequent calls reuse token
4. If API returns error indicating expired/invalid token, delete old token, create new cart, retry
5. `open_cart` sends user to browser where they log in - cart transfers to their Selver account at that point

### Error handling

- **Cart token expired**: Auto-recreate and retry. Replace token in `cart.json`.
- **Selver API unreachable**: Return error with product URL (`https://www.selver.ee/?q={query}`) so user can search manually.
- **Product out of stock**: Report in `failed` array of `add_to_cart` response. Don't block other items.
- **No active cart**: `view_cart` and `remove_from_cart` return clear "no active cart" error.

## Configuration & installation

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

### Future npm publish

If published, both simplify to:
```json
{ "command": "npx", "args": ["selver-mcp"] }
```

### Build commands

- `npm run build` - compile TypeScript to `dist/`
- `npm run dev` - watch mode
- `npm test` - vitest

### Runtime requirements

- Node.js 18+
- No API keys or environment variables
- Internet access to selver.ee

## What gets ported from Selver project

| Source file | Action |
|---|---|
| `selver/client.ts` | Port search + cart API methods. Drop catalog refresh. |
| `selver/parser.ts` | Port as-is. Nutrition parsing logic is solid. |
| `selver/types.ts` | Port Product, NutritionPer100g, CartItem. Drop Recipe, MealPlan, UserProfile. |
| `browser/cart.ts` | Rewrite. API calls only. Replace Puppeteer with OS `open` command. |
| `storage/base.ts` | Simplify to single-purpose cart token store. |
| `index.ts` | Rewrite. 5 tools instead of 11+. |
| `nutrition/` | Drop. |
| `grocery/` | Drop. |
| `storage/recipes.ts` | Drop. |
| `storage/plans.ts` | Drop. |

## Testing strategy

- **`parser.test.ts`** - Unit tests for nutrition string parsing (comma decimals, missing fields, edge cases). Ported from existing tests.
- **`client.test.ts`** - Tests for SelverClient with mocked HTTP responses. Verifies query construction and response mapping.
- **`cart.test.ts`** - Tests for cart token lifecycle (create, reuse, expire-and-recreate). Mocked API.

No integration tests against live Selver.ee API in CI - those are manual/local only.

## Out of scope

- Nutrition calculation (Claude handles this natively)
- Recipe storage and meal plan management (prompt-level concern)
- Product catalog caching (live search only)
- Puppeteer browser automation (replaced by OS `open`)
- User authentication or credential storage
- Multiple store support (Rimi, Coop, etc.)
