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
