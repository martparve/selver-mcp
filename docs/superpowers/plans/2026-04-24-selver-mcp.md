# selver-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone MCP server exposing Selver.ee product search and cart management as 5 tools for Claude Code / Claude Desktop.

**Architecture:** Thin MCP wrapper around a `SelverClient` that handles all HTTP calls to selver.ee's product search and guest cart APIs. Cart token persisted to `~/.selver-mcp/cart.json`. No Puppeteer, no browser process management - checkout uses fire-and-forget OS `open` command.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Zod 4, Vitest

**Source project to port from:** `/Users/martparve/Code/Selver/src/`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | npm-ready config with `bin` entry for `selver-mcp` |
| `tsconfig.json` | ES2022 + Node16 modules |
| `src/selver/types.ts` | `Product`, `NutritionPer100g`, `CartItem`, `SelverRawProduct`, `SelverSearchResponse` |
| `src/selver/parser.ts` | Parse nutrition strings from Selver API (Estonian comma decimals, kJ/kcal) |
| `src/selver/client.ts` | `SelverClient` class - all HTTP calls: product search + cart CRUD |
| `src/storage/cart-token.ts` | Read/write/clear cart token from `~/.selver-mcp/cart.json` |
| `src/tools/search.ts` | `search_products` tool registration |
| `src/tools/cart.ts` | `add_to_cart`, `view_cart`, `remove_from_cart`, `open_cart` tool registration |
| `src/index.ts` | MCP server entry point, wires tools to client |
| `tests/parser.test.ts` | Nutrition parsing unit tests |
| `tests/client.test.ts` | SelverClient tests with mocked fetch |
| `tests/cart-token.test.ts` | Cart token storage tests using temp directory |
| `README.md` | Install instructions for Claude Code + Claude Desktop |

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "selver-mcp",
  "version": "0.1.0",
  "description": "MCP server for Selver.ee product search and cart management",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "selver-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 4: Create directory structure**

Run: `mkdir -p src/selver src/storage src/tools tests`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "feat: project scaffolding"
```

---

### Task 2: Types and parser (TDD)

**Files:**
- Create: `src/selver/types.ts`
- Create: `src/selver/parser.ts`
- Create: `tests/parser.test.ts`

- [ ] **Step 1: Write parser tests**

Port from `/Users/martparve/Code/Selver/tests/selver/parser.test.ts`, trimmed to 4-field `NutritionPer100g`:

```typescript
// tests/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseNutrition, parseEnergyKcal, parseNutrientValue } from '../src/selver/parser.js';

describe('parseNutrientValue', () => {
  it('parses decimal with dot', () => {
    expect(parseNutrientValue('9.10')).toBe(9.1);
  });
  it('parses decimal with comma (Estonian format)', () => {
    expect(parseNutrientValue('9,10')).toBe(9.1);
  });
  it('returns 0 for null', () => {
    expect(parseNutrientValue(null)).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(parseNutrientValue('')).toBe(0);
  });
  it('parses integer string', () => {
    expect(parseNutrientValue('24')).toBe(24);
  });
});

describe('parseEnergyKcal', () => {
  it('parses combined kJ/kcal string', () => {
    expect(parseEnergyKcal('811.7kJ/194kcal')).toBe(194);
  });
  it('parses kcal-only string', () => {
    expect(parseEnergyKcal('194kcal')).toBe(194);
  });
  it('parses with spaces', () => {
    expect(parseEnergyKcal('811.7 kJ / 194 kcal')).toBe(194);
  });
  it('parses with comma decimal', () => {
    expect(parseEnergyKcal('811,7kJ/194,5kcal')).toBe(194.5);
  });
  it('returns 0 for null', () => {
    expect(parseEnergyKcal(null)).toBe(0);
  });
});

describe('parseNutrition', () => {
  it('parses full nutrition data', () => {
    const result = parseNutrition({
      product_nutr_energy: '811.7kJ/194kcal',
      product_nutr_proteins: '9.10',
      product_nutr_carbohydrates: '24.10',
      product_nutr_fats: '6.30',
    });
    expect(result).toEqual({
      energy_kcal: 194,
      protein_g: 9.1,
      carbs_g: 24.1,
      fat_g: 6.3,
    });
  });
  it('returns null when proteins field is missing', () => {
    const result = parseNutrition({
      product_nutr_energy: null,
      product_nutr_proteins: null,
      product_nutr_carbohydrates: null,
      product_nutr_fats: null,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL - cannot find module `../src/selver/parser.js`

- [ ] **Step 3: Write types.ts**

```typescript
// src/selver/types.ts
export interface SelverRawProduct {
  sku: string;
  name: string;
  slug: string;
  price_incl_tax: number;
  final_price_incl_tax: number;
  unit_price: number;
  product_volume: string | null;
  image: string;
  stock: {
    is_in_stock: boolean;
    stock_status?: number;
  };
  product_nutr_energy: string | null;
  product_nutr_proteins: string | null;
  product_nutr_carbohydrates: string | null;
  product_nutr_fats: string | null;
}

export interface NutritionPer100g {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Product {
  sku: string;
  name: string;
  slug: string;
  price: number;
  unit_price: number;
  volume: string | null;
  in_stock: boolean;
  nutrition: NutritionPer100g | null;
}

export interface CartItem {
  item_id: number;
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface SelverSearchResponse {
  hits: {
    total: number;
    hits: Array<{ _source: SelverRawProduct }>;
  };
}
```

- [ ] **Step 4: Write parser.ts**

Port from `/Users/martparve/Code/Selver/src/selver/parser.ts`, trimmed to 4 nutrition fields:

```typescript
// src/selver/parser.ts
import type { NutritionPer100g } from './types.js';

export function parseNutrientValue(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export function parseEnergyKcal(value: string | null): number {
  if (!value) return 0;
  const match = value.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*kcal/i);
  return match ? parseFloat(match[1]) : 0;
}

interface RawNutritionFields {
  product_nutr_energy: string | null;
  product_nutr_proteins: string | null;
  product_nutr_carbohydrates: string | null;
  product_nutr_fats: string | null;
}

export function parseNutrition(raw: RawNutritionFields): NutritionPer100g | null {
  if (!raw.product_nutr_proteins) return null;
  return {
    energy_kcal: parseEnergyKcal(raw.product_nutr_energy),
    protein_g: parseNutrientValue(raw.product_nutr_proteins),
    carbs_g: parseNutrientValue(raw.product_nutr_carbohydrates),
    fat_g: parseNutrientValue(raw.product_nutr_fats),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/selver/types.ts src/selver/parser.ts tests/parser.test.ts
git commit -m "feat: types and nutrition parser with tests"
```

---

### Task 3: SelverClient - product search (TDD)

**Files:**
- Create: `src/selver/client.ts`
- Create: `tests/client.test.ts`

- [ ] **Step 1: Write search tests**

Port from `/Users/martparve/Code/Selver/tests/selver/client.test.ts`, keeping search + stock detection tests:

```typescript
// tests/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelverClient } from '../src/selver/client.js';

const mockProduct = {
  sku: 'T000089179',
  name: 'Kanafileerull, Rimi Basic, kg',
  slug: 'kanafileerull-rimi-basic-kg',
  price_incl_tax: 8.99,
  final_price_incl_tax: 8.99,
  unit_price: 8.99,
  product_volume: '1 kg',
  image: '/4/7/4740093824539.jpg',
  stock: { is_in_stock: false, stock_status: 1 },
  product_nutr_energy: '811.7kJ/194kcal',
  product_nutr_proteins: '9.10',
  product_nutr_carbohydrates: '24.10',
  product_nutr_fats: '6.30',
};

describe('SelverClient', () => {
  let client: SelverClient;

  beforeEach(() => {
    client = new SelverClient();
    vi.restoreAllMocks();
  });

  describe('searchProducts', () => {
    it('searches and returns parsed products', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          hits: { total: 1, hits: [{ _source: mockProduct }] },
        }))
      );
      const results = await client.searchProducts('kana');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/product/_search?q=kana&size=20')
      );
      expect(results).toHaveLength(1);
      expect(results[0].sku).toBe('T000089179');
      expect(results[0].name).toBe('Kanafileerull, Rimi Basic, kg');
      expect(results[0].price).toBe(8.99);
      expect(results[0].volume).toBe('1 kg');
      expect(results[0].nutrition).not.toBeNull();
      expect(results[0].nutrition!.protein_g).toBe(9.1);
    });

    it('respects custom limit', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ hits: { total: 0, hits: [] } }))
      );
      await client.searchProducts('kana', 5);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('size=5')
      );
    });

    it('returns empty array on no results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ hits: { total: 0, hits: [] } }))
      );
      const results = await client.searchProducts('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('uses stock_status for in_stock when available', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          hits: { total: 1, hits: [{ _source: {
            ...mockProduct,
            stock: { is_in_stock: false, stock_status: 1 },
          } }] },
        }))
      );
      const results = await client.searchProducts('kana');
      expect(results[0].in_stock).toBe(true);
    });

    it('reports out of stock when stock_status is 0', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          hits: { total: 1, hits: [{ _source: {
            ...mockProduct,
            stock: { is_in_stock: false, stock_status: 0 },
          } }] },
        }))
      );
      const results = await client.searchProducts('kana');
      expect(results[0].in_stock).toBe(false);
    });

    it('falls back to is_in_stock when stock_status absent', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          hits: { total: 1, hits: [{ _source: {
            ...mockProduct,
            stock: { is_in_stock: true },
          } }] },
        }))
      );
      const results = await client.searchProducts('kana');
      expect(results[0].in_stock).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL - cannot find module `../src/selver/client.js`

- [ ] **Step 3: Write client.ts with search method**

Port `searchProducts` and `toProduct` from `/Users/martparve/Code/Selver/src/selver/client.ts`. Drop `searchByCategory`, `searchWithCategoryFilter`, `getProductBySku`, `checkAvailability`. The cart methods will be added in the next task.

```typescript
// src/selver/client.ts
import type { SelverRawProduct, SelverSearchResponse, Product, CartItem } from './types.js';
import { parseNutrition } from './parser.js';

const BASE_URL = 'https://www.selver.ee';
const CATALOG_URL = `${BASE_URL}/api/catalog/vue_storefront_catalog_et`;
const CART_API = `${BASE_URL}/api/cart`;

function toProduct(raw: SelverRawProduct): Product {
  return {
    sku: raw.sku,
    name: raw.name,
    slug: raw.slug,
    price: raw.final_price_incl_tax ?? raw.price_incl_tax,
    unit_price: raw.unit_price,
    volume: raw.product_volume,
    in_stock: raw.stock?.stock_status === 1
      ? true
      : raw.stock?.is_in_stock ?? false,
    nutrition: parseNutrition(raw),
  };
}

function cartUrl(action: string, token: string): string {
  return `${CART_API}/${action}?token=${token}&cartId=${token}`;
}

export class SelverClient {
  async searchProducts(query: string, limit = 20): Promise<Product[]> {
    const url = `${CATALOG_URL}/product/_search?q=${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetch(url);
    const data: SelverSearchResponse = await res.json();
    return (data.hits?.hits ?? []).map(h => toProduct(h._source));
  }
}
```

Note: `CART_API`, `cartUrl`, and `CartItem` import are included now but unused. They'll be used in Task 4 when cart methods are added. The TypeScript compiler won't error on unused imports with `strict: true` (it would require `noUnusedLocals` which isn't set). If it does error, move these to Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/selver/client.ts tests/client.test.ts
git commit -m "feat: SelverClient with product search"
```

---

### Task 4: SelverClient - cart API methods (TDD)

**Files:**
- Modify: `src/selver/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Add cart tests to client.test.ts**

Append these test suites inside the existing `describe('SelverClient')` block, after the `searchProducts` describe:

```typescript
  describe('createCart', () => {
    it('returns cart token on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, result: 'abc123token' }))
      );
      const token = await client.createCart();
      expect(token).toBe('abc123token');
    });

    it('returns null on failure response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 500, result: null }))
      );
      const token = await client.createCart();
      expect(token).toBeNull();
    });

    it('returns null on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
      const token = await client.createCart();
      expect(token).toBeNull();
    });
  });

  describe('addToCart', () => {
    it('sends correct payload and returns true on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200 }))
      );
      const ok = await client.addToCart('token123', 'T000089179', 2);
      expect(ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/cart/update?token=token123&cartId=token123'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ cartItem: { sku: 'T000089179', qty: 2, quoteId: 'token123' } }),
        })
      );
    });

    it('returns false on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 500 }))
      );
      const ok = await client.addToCart('token123', 'T000089179', 1);
      expect(ok).toBe(false);
    });
  });

  describe('getCart', () => {
    it('returns parsed cart items', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: 200,
          result: [{ item_id: 42, sku: 'T001', name: 'Kana', qty: 2, price: 5.99 }],
        }))
      );
      const items = await client.getCart('token123');
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ item_id: 42, sku: 'T001', name: 'Kana', qty: 2, price: 5.99 });
    });

    it('returns empty array on error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
      const items = await client.getCart('token123');
      expect(items).toHaveLength(0);
    });
  });

  describe('deleteCartItem', () => {
    it('sends correct payload and returns true on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200 }))
      );
      const ok = await client.deleteCartItem('token123', 'T001', 42);
      expect(ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/cart/delete?token=token123&cartId=token123'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ cartItem: { sku: 'T001', item_id: 42, quoteId: 'token123' } }),
        })
      );
    });

    it('returns false on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 500 }))
      );
      const ok = await client.deleteCartItem('token123', 'T001', 42);
      expect(ok).toBe(false);
    });
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL - `client.createCart is not a function` (etc.)

- [ ] **Step 3: Add cart methods to client.ts**

Add these methods inside the `SelverClient` class, after `searchProducts`:

```typescript
  async createCart(): Promise<string | null> {
    try {
      const res = await fetch(`${CART_API}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.code === 200 && data.result) return data.result;
      return null;
    } catch {
      return null;
    }
  }

  async addToCart(token: string, sku: string, qty: number): Promise<boolean> {
    try {
      const res = await fetch(cartUrl('update', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItem: { sku, qty, quoteId: token } }),
      });
      const data = await res.json();
      return data.code === 200;
    } catch {
      return false;
    }
  }

  async getCart(token: string): Promise<CartItem[]> {
    try {
      const res = await fetch(cartUrl('pull', token));
      const data = await res.json();
      if (data.code === 200 && Array.isArray(data.result)) {
        return data.result.map((item: Record<string, unknown>) => ({
          item_id: item.item_id as number,
          sku: item.sku as string,
          name: item.name as string,
          qty: item.qty as number,
          price: item.price as number,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  async deleteCartItem(token: string, sku: string, itemId: number): Promise<boolean> {
    try {
      const res = await fetch(cartUrl('delete', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartItem: { sku, item_id: itemId, quoteId: token } }),
      });
      const data = await res.json();
      return data.code === 200;
    } catch {
      return false;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client.test.ts`
Expected: All 15 tests PASS (6 search + 9 cart)

- [ ] **Step 5: Commit**

```bash
git add src/selver/client.ts tests/client.test.ts
git commit -m "feat: cart API methods (create, add, get, delete)"
```

---

### Task 5: Cart token storage (TDD)

**Files:**
- Create: `src/storage/cart-token.ts`
- Create: `tests/cart-token.test.ts`

- [ ] **Step 1: Write cart token tests**

```typescript
// tests/cart-token.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { readCartToken, writeCartToken, clearCartToken } from '../src/storage/cart-token.js';

describe('cart token storage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selver-mcp-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no token exists', async () => {
    const token = await readCartToken(tmpDir);
    expect(token).toBeNull();
  });

  it('writes and reads a token', async () => {
    await writeCartToken('test-token-123', tmpDir);
    const token = await readCartToken(tmpDir);
    expect(token).toBe('test-token-123');
  });

  it('overwrites existing token', async () => {
    await writeCartToken('old-token', tmpDir);
    await writeCartToken('new-token', tmpDir);
    const token = await readCartToken(tmpDir);
    expect(token).toBe('new-token');
  });

  it('clears existing token', async () => {
    await writeCartToken('token-to-clear', tmpDir);
    await clearCartToken(tmpDir);
    const token = await readCartToken(tmpDir);
    expect(token).toBeNull();
  });

  it('clear is no-op when no token exists', async () => {
    await clearCartToken(tmpDir);
    const token = await readCartToken(tmpDir);
    expect(token).toBeNull();
  });

  it('persists token as JSON with created_at timestamp', async () => {
    await writeCartToken('check-format', tmpDir);
    const raw = await fs.readFile(path.join(tmpDir, 'cart.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.token).toBe('check-format');
    expect(data.created_at).toBeDefined();
    expect(() => new Date(data.created_at)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cart-token.test.ts`
Expected: FAIL - cannot find module `../src/storage/cart-token.js`

- [ ] **Step 3: Write cart-token.ts**

```typescript
// src/storage/cart-token.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.selver-mcp');

interface StoredToken {
  token: string;
  created_at: string;
}

function tokenPath(dataDir: string): string {
  return path.join(dataDir, 'cart.json');
}

export async function readCartToken(dataDir = DEFAULT_DATA_DIR): Promise<string | null> {
  try {
    const raw = await fs.readFile(tokenPath(dataDir), 'utf-8');
    const data: StoredToken = JSON.parse(raw);
    return data.token;
  } catch {
    return null;
  }
}

export async function writeCartToken(token: string, dataDir = DEFAULT_DATA_DIR): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const data: StoredToken = { token, created_at: new Date().toISOString() };
  await fs.writeFile(tokenPath(dataDir), JSON.stringify(data, null, 2));
}

export async function clearCartToken(dataDir = DEFAULT_DATA_DIR): Promise<void> {
  try {
    await fs.unlink(tokenPath(dataDir));
  } catch {
    // File doesn't exist
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cart-token.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/cart-token.ts tests/cart-token.test.ts
git commit -m "feat: cart token persistence"
```

---

### Task 6: Search tool handler

**Files:**
- Create: `src/tools/search.ts`

- [ ] **Step 1: Write search tool registration**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/search.ts
git commit -m "feat: search_products tool handler"
```

---

### Task 7: Cart tool handlers

**Files:**
- Create: `src/tools/cart.ts`

**CRITICAL: No Puppeteer, no browser process management.** The `open_cart` tool uses a fire-and-forget OS `open` command that opens a tab in the user's existing browser. The `open` command exits immediately - it does not spawn or manage a browser process.

- [ ] **Step 1: Write cart tool registration**

```typescript
// src/tools/cart.ts
import { z } from 'zod';
import { exec } from 'child_process';
import { platform } from 'os';
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

function openUrl(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
    : platform() === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

export function registerCartTools(server: McpServer, client: SelverClient): void {
  server.tool(
    'add_to_cart',
    'Add products to Selver.ee guest cart by SKU. Creates a new cart if none exists.',
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
    'Remove products from Selver.ee cart by SKU.',
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

  server.tool(
    'open_cart',
    'Open Selver.ee cart page in your default browser for login and checkout.',
    {},
    async () => {
      openUrl('https://www.selver.ee/cart');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Opened Selver cart in your browser - log in to complete checkout' }),
        }],
      };
    }
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cart.ts
git commit -m "feat: cart tool handlers (add, view, remove, open)"
```

---

### Task 8: MCP server entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
#!/usr/bin/env node
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SelverClient } from './selver/client.js';
import { registerSearchTools } from './tools/search.js';
import { registerCartTools } from './tools/cart.js';

const server = new McpServer({
  name: 'selver-mcp',
  version: '0.1.0',
});

const client = new SelverClient();

registerSearchTools(server, client);
registerCartTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: `dist/` directory created with compiled JS files, no errors

- [ ] **Step 3: Verify the shebang and bin entry work**

Run: `head -1 dist/index.js`
Expected: `#!/usr/bin/env node`

If the shebang is missing from the compiled output (TypeScript strips it), add it post-build. Update `package.json` scripts:

```json
"build": "tsc && echo '#!/usr/bin/env node' | cat - dist/index.js > dist/index.tmp.js && mv dist/index.tmp.js dist/index.js"
```

Alternative (cleaner): just keep the shebang comment in `src/index.ts` - TypeScript 5+ preserves shebangs.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass (parser: 10, client: 15, cart-token: 6 = 31 total)

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP server entry point"
```

---

### Task 9: README and final build

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
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
| `open_cart` | Open selver.ee/cart in your default browser for checkout. |

## Usage tips

- Use Estonian search terms: "kana" (chicken), "riis" (rice), "lohe" (salmon), "muna" (eggs)
- Cart persists between sessions via `~/.selver-mcp/cart.json`
- After adding items, use `open_cart` to check out in your browser

## Requirements

- Node.js 18+
- No API keys or configuration needed
```

- [ ] **Step 2: Full build and test**

Run: `npm run build && npm test`
Expected: Build succeeds, all 31 tests pass

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with install instructions"
```
