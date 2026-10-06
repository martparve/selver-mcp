import type { StoreAdapter, StoreId } from '../core/types.js';
import { STORE_IDS } from '../core/types.js';
import { SelverClient } from './selver/client.js';
import { RimiClient } from './rimi/client.js';
import { BarboraClient } from './barbora/client.js';

const adapters: Record<StoreId, StoreAdapter> = {
  selver: new SelverClient(),
  rimi: new RimiClient(),
  barbora: new BarboraClient(),
};

export { STORE_IDS };

export function getStore(id: StoreId): StoreAdapter {
  const a = adapters[id];
  if (!a) throw new Error(`Unknown store: ${id}`);
  return a;
}

export function allStores(): StoreAdapter[] {
  return STORE_IDS.map(id => adapters[id]);
}
