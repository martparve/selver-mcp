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
});
