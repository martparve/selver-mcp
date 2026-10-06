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
    const token = await readCartToken('selver', tmpDir);
    expect(token).toBeNull();
  });

  it('writes and reads a token', async () => {
    await writeCartToken('selver', 'test-token-123', tmpDir);
    const token = await readCartToken('selver', tmpDir);
    expect(token).toBe('test-token-123');
  });

  it('overwrites existing token', async () => {
    await writeCartToken('selver', 'old-token', tmpDir);
    await writeCartToken('selver', 'new-token', tmpDir);
    const token = await readCartToken('selver', tmpDir);
    expect(token).toBe('new-token');
  });

  it('clears existing token', async () => {
    await writeCartToken('selver', 'token-to-clear', tmpDir);
    await clearCartToken('selver', tmpDir);
    const token = await readCartToken('selver', tmpDir);
    expect(token).toBeNull();
  });

  it('clear is no-op when no token exists', async () => {
    await clearCartToken('selver', tmpDir);
    const token = await readCartToken('selver', tmpDir);
    expect(token).toBeNull();
  });

  it('persists token as JSON with created_at timestamp', async () => {
    await writeCartToken('selver', 'check-format', tmpDir);
    const raw = await fs.readFile(path.join(tmpDir, 'carts.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.selver.token).toBe('check-format');
    expect(data.selver.created_at).toBeDefined();
    expect(() => new Date(data.selver.created_at)).not.toThrow();
  });

  it('migrates a legacy single-store cart.json', async () => {
    await fs.writeFile(path.join(tmpDir, 'cart.json'), JSON.stringify({ token: 'legacy-token', created_at: '2026-01-01T00:00:00Z' }));
    expect(await readCartToken('selver', tmpDir)).toBe('legacy-token');
    await expect(fs.access(path.join(tmpDir, 'cart.json'))).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(tmpDir, 'carts.json'), 'utf-8')).selver.token).toBe('legacy-token');
  });
});
