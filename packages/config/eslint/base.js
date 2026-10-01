// Shared flat ESLint config for TypeScript packages. Type-aware rules are enabled so that
// unsafe `any` flows and floating promises are caught at lint time.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * @param {{ tsconfigRootDir: string }} options
 */
export function createBaseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
      },
      rules: {
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
