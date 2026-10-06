/**
 * Polite HTTP for stores that sit behind Cloudflare or similar: a small per-host concurrency
 * limit, retries with backoff on 403/429/5xx, and detection of challenge pages that would
 * otherwise parse as "no results".
 */

const limits = new Map<string, { active: number; queue: Array<() => void> }>();

async function withSlot<T>(key: string, max: number, fn: () => Promise<T>): Promise<T> {
  let slot = limits.get(key);
  if (!slot) { slot = { active: 0, queue: [] }; limits.set(key, slot); }
  if (slot.active >= max) await new Promise<void>(resolve => slot!.queue.push(resolve));
  slot.active++;
  try {
    return await fn();
  } finally {
    slot.active--;
    slot.queue.shift()?.();
  }
}

export function looksLikeChallenge(html: string): boolean {
  return /Just a moment|cf-chl|cf_chl_|challenge-platform|Attention Required|Access denied/i.test(html.slice(0, 20000));
}

export interface PoliteOptions {
  /** Max concurrent requests per host (default 3). */
  concurrency?: number;
  /** Retries on 403/429/5xx or challenge pages (default 2). */
  retries?: number;
  headers?: Record<string, string>;
  /** Return false when the body is not a usable page (e.g. empty 200 from a rate limiter); the request is retried. */
  validate?: (text: string) => boolean;
  /** Base backoff in ms (default 600; doubles per attempt). */
  backoffMs?: number;
}

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** GET a page as text with per-host throttling and retries. Throws a descriptive error when blocked. */
export async function politeGetText(url: string, opts: PoliteOptions = {}): Promise<string> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  return withSlot(host, opts.concurrency ?? 3, async () => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, (opts.backoffMs ?? 600) * 2 ** (attempt - 1) + Math.random() * 300));
      try {
        const res = await fetch(url, { headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'et,en;q=0.8', ...(opts.headers ?? {}) } });
        const text = await res.text();
        if (res.status === 403 || res.status === 429 || res.status >= 500) { lastErr = new Error(`${host} answered HTTP ${res.status}`); continue; }
        if (!res.ok) throw new Error(`${host} answered HTTP ${res.status}`);
        if (looksLikeChallenge(text)) { lastErr = new Error(`${host} returned a bot-protection challenge page`); continue; }
        if (text.trim().length === 0) { lastErr = new Error(`${host} returned an empty page (rate limited)`); continue; }
        if (opts.validate && !opts.validate(text)) { lastErr = new Error(`${host} returned an unexpected page (rate limited or layout change)`); continue; }
        return text;
      } catch (e) {
        if (e instanceof TypeError) { lastErr = e; continue; } // network error
        throw e;
      }
    }
    throw lastErr ?? new Error(`${host}: request failed`);
  });
}
