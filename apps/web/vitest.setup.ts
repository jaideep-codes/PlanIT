import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement matchMedia; default every test to a light-mode system preference.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) satisfies MediaQueryList;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = '';
});
