// Selver's catalog stores select-type attributes (alcohol type, country, brand, ...) as option ids.
// The labels live in the Vue Storefront attribute index; one request returns every table we need.

export const LABELLED_ATTRIBUTES = [
  'product_alcohol_type',
  'product_dietary_info',
  'product_country_of_origin',
  'product_nutr_unit',
  'product_manufacturer',
  'product_brand',
] as const;

export type LabelledAttribute = typeof LABELLED_ATTRIBUTES[number];

/** attribute code → option id → label */
export type AttributeLabels = Partial<Record<LabelledAttribute, Map<string, string>>>;

interface RawAttributeHit {
  _source?: { attribute_code?: string; optionsPacked?: Array<[string, string | number, ...unknown[]]> };
}

export function parseAttributeLabels(data: { hits?: { hits?: RawAttributeHit[] } }): AttributeLabels {
  const out: AttributeLabels = {};
  for (const h of data.hits?.hits ?? []) {
    const code = h._source?.attribute_code as LabelledAttribute | undefined;
    if (!code || !LABELLED_ATTRIBUTES.includes(code)) continue;
    const map = new Map<string, string>();
    for (const opt of h._source?.optionsPacked ?? []) {
      if (Array.isArray(opt) && typeof opt[0] === 'string' && opt[1] !== undefined) map.set(String(opt[1]), opt[0].trim());
    }
    out[code] = map;
  }
  return out;
}

const TTL_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let cache: { at: number; labels: AttributeLabels; ok: boolean } | null = null;
let inflight: Promise<AttributeLabels> | null = null;

/**
 * Labels for the attribute tables, cached for 12 hours (about 220 kB once per process).
 * Best-effort: on failure returns {} and products simply lack the decoded fields.
 */
export async function getAttributeLabels(catalogUrl: string): Promise<AttributeLabels> {
  const now = Date.now();
  if (cache && now - cache.at < (cache.ok ? TTL_MS : RETRY_AFTER_FAILURE_MS)) return cache.labels;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${catalogUrl}/attribute/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { terms: { attribute_code: [...LABELLED_ATTRIBUTES] } }, size: LABELLED_ATTRIBUTES.length }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const labels = parseAttributeLabels(await res.json() as { hits?: { hits?: RawAttributeHit[] } });
      const ok = Object.keys(labels).length > 0;
      cache = { at: Date.now(), labels, ok };
      return labels;
    } catch {
      cache = { at: Date.now(), labels: {}, ok: false };
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test hook. */
export function resetAttributeLabelCache(): void {
  cache = null;
  inflight = null;
}

export function label(labels: AttributeLabels, code: LabelledAttribute, id: number | string | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null;
  return labels[code]?.get(String(id)) ?? null;
}
