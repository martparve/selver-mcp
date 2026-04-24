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
    // File doesn't exist - no-op
  }
}
