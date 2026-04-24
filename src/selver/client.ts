import type { SelverRawProduct, SelverSearchResponse, Product, CartItem, AddToCartResult } from './types.js';
import { parseNutrition } from './parser.js';

const BASE_URL = 'https://www.selver.ee';
const CATALOG_URL = `${BASE_URL}/api/catalog/vue_storefront_catalog_et`;
const CART_API = `${BASE_URL}/api/cart`;

function toProduct(raw: SelverRawProduct): Product {
  const step = typeof raw.product_weight_step === 'number' && raw.product_weight_step > 0
    ? raw.product_weight_step
    : null;
  return {
    sku: raw.sku,
    name: raw.name,
    slug: raw.slug,
    price: raw.final_price_incl_tax ?? raw.price_incl_tax,
    unit_price: raw.unit_price,
    volume: raw.product_volume,
    weight_step: step,
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

  async addToCart(token: string, sku: string, qty: number): Promise<AddToCartResult> {
    const attempt = async (): Promise<AddToCartResult> => {
      try {
        const res = await fetch(cartUrl('update', token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cartItem: { sku, qty, quoteId: token } }),
        });
        const data = await res.json();
        if (data.code === 200) return { ok: true };
        const msg = typeof data.result === 'string' ? data.result : `HTTP ${data.code}`;
        return { ok: false, error: msg };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    };

    const verify = async (): Promise<boolean> => {
      const items = await this.getCart(token);
      return items.some(i => i.sku === sku && i.qty >= qty - 1e-4);
    };

    // Selver's cart service has a race condition when add follows closely on
    // remove (or another mutation): the server returns 200 but silently fails
    // to persist the write. Verify by reading back the cart; retry once if the
    // item is missing.
    const first = await attempt();
    if (!first.ok) return first;
    if (await verify()) return { ok: true };

    const retry = await attempt();
    if (!retry.ok) return retry;
    if (await verify()) return { ok: true };

    return { ok: false, error: 'Item accepted by server but not persisted after retry (possible cart race condition)' };
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
}
