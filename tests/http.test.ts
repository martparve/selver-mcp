import { describe, it, expect, vi, beforeEach } from 'vitest';
import { politeGetText, looksLikeChallenge } from '../src/core/http.js';

describe('politeGetText', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('retries an empty 200 body and returns the next good page', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('<html>window.b_productList = []</html>', { status: 200 }));
    const text = await politeGetText('https://example.test/otsing?q=x', { backoffMs: 1, validate: t => t.includes('b_productList') });
    expect(text).toContain('b_productList');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('retries 429 and gives up with a descriptive error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('slow down', { status: 429 }));
    await expect(politeGetText('https://example.test/x', { retries: 1, backoffMs: 1 })).rejects.toThrow(/HTTP 429/);
  });

  it('treats a Cloudflare challenge as retryable', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<title>Just a moment...</title>', { status: 200 }))
      .mockResolvedValueOnce(new Response('ok page', { status: 200 }));
    expect(await politeGetText('https://example.test/y', { backoffMs: 1 })).toBe('ok page');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(looksLikeChallenge('<title>Just a moment...</title>')).toBe(true);
  });

  it('limits concurrency per host', async () => {
    let active = 0, peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; return new Response('ok', { status: 200 }); });
    await Promise.all(Array.from({ length: 8 }, (_, i) => politeGetText(`https://limit.test/${i}`, { concurrency: 2 })));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
