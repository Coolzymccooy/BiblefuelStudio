import { describe, it, expect } from 'vitest';
// `?raw` makes Vite hand back the source of whatever the specifier resolves to.
import resolvedSource from 'rvfc-polyfill?raw';

// jassub imports 'rvfc-polyfill' (GPL-3.0). It is aliased to an empty local stub so none of
// that code ships in the client bundle; every browser we support has requestVideoFrameCallback.
describe('rvfc-polyfill alias', () => {
  it('resolves to the local empty stub, not the GPL package', () => {
    // A string that only appears in the real package's source.
    expect(resolvedSource).not.toContain('_rvfcpolyfillmap');
    expect(resolvedSource).not.toContain('requestVideoFrameCallback');
    expect(resolvedSource).toContain('export {}');
  });
});
