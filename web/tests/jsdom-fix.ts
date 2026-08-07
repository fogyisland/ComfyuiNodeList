// Vitest setupFile: runs before each test that uses the jsdom environment.
// Workaround for jsdom 22+/30+ where `global.localStorage` exposed via
// `populateGlobal`'s getter loses its Storage prototype chain, leaving
// `localStorage.clear` / `setItem` / etc. undefined. The real working
// Storage is still accessible at `globalThis.jsdom.window.localStorage`,
// so we copy it onto the global directly.
import { afterEach } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var jsdom: { window: { localStorage: Storage } } | undefined;
}

if (typeof globalThis !== 'undefined' && (globalThis as any).jsdom?.window?.localStorage) {
  const real = (globalThis as any).jsdom.window.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: real,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  // Reset between tests for component tests that mutate storage
  try {
    (globalThis as any).jsdom?.window?.localStorage?.clear();
  } catch {}
});