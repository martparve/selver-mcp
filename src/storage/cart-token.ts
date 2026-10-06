import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { StoreId } from '../core/types.js';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.selver-mcp');

interface StoredToken {
  token: string;
  created_at: string;
}

type CartsFile = Partial<Record<StoreId, StoredToken>>;

function cartsPath(dataDir: string): string {
  return path.join(dataDir, 'carts.json');
}

async function readAll(dataDir: string): Promise<CartsFile> {
  try {
    const raw = await fs.readFile(cartsPath(dataDir), 'utf-8');
    return JSON.parse(raw) as CartsFile;
  } catch {
    // v0.1/v0.2 kept a single Selver token in cart.json; migrate it once.
    try {
      const legacy = JSON.parse(await fs.readFile(path.join(dataDir, 'cart.json'), 'utf-8')) as StoredToken;
      if (legacy?.token) {
        const data: CartsFile = { selver: legacy };
        await writeAll(data, dataDir);
        await fs.unlink(path.join(dataDir, 'cart.json')).catch(() => undefined);
        return data;
      }
    } catch {
      // nothing to migrate
    }
    return {};
  }
}

async function writeAll(data: CartsFile, dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(cartsPath(dataDir), JSON.stringify(data, null, 2));
}

export async function readCartToken(store: StoreId, dataDir = DEFAULT_DATA_DIR): Promise<string | null> {
  const all = await readAll(dataDir);
  return all[store]?.token ?? null;
}

export async function writeCartToken(store: StoreId, token: string, dataDir = DEFAULT_DATA_DIR): Promise<void> {
  const all = await readAll(dataDir);
  all[store] = { token, created_at: new Date().toISOString() };
  await writeAll(all, dataDir);
}

export async function clearCartToken(store: StoreId, dataDir = DEFAULT_DATA_DIR): Promise<void> {
  const all = await readAll(dataDir);
  if (!(store in all)) return;
  delete all[store];
  await writeAll(all, dataDir);
}
