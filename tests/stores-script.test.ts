import { describe, it, expect } from 'vitest';
import { rimiScript } from '../src/stores/rimi/client.js';
import { barboraScript } from '../src/stores/barbora/client.js';
import { replayScript } from '../src/stores/selver/sync-script.js';

// Browser scripts are built with template literals; a lost backslash silently breaks a regex.
describe('generated browser scripts keep their regex escapes', () => {
  it('rimi', () => {
    const js = rimiScript([{ sku: '1', qty: 1 }], false);
    expect(js).toContain('/\\s+/g');
    expect(js).toContain('(\\d+(?:[.,]\\d+)?)\\s*€');
  });
  it('barbora', () => {
    const js = barboraScript([{ sku: '1', qty: 1 }], false);
    expect(js).toContain('v=([\\d.]+)');
  });
  it('selver', () => {
    expect(() => new Function('return (' + replayScript('tok') + ')')).not.toThrow();
  });
});
