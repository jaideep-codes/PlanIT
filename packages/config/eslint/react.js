import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from './base.js';

/**
 * @param {{ tsconfigRootDir: string }} options
 */
export function createReactConfig(options) {
  return tseslint.config(...createBaseConfig(options), reactHooks.configs.flat.recommended, {
    languageOptions: {
      globals: { ...globals.browser },
    },
  });
}
