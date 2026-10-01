import { createBaseConfig } from '@planit/config/eslint/base';
import globals from 'globals';

const DATABASE_IMPORTS = ['**/infrastructure/database/**', '**/generated/prisma/**', '@prisma/*'];

export default [
  { ignores: ['src/generated/**'] },
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Nest modules are intentionally empty decorated classes.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  // Architecture boundaries (docs/architecture.md). Persistence is reached only through a
  // module's repository/data-access layer.
  {
    files: ['src/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: DATABASE_IMPORTS,
              message: 'Controllers handle transport only; call a service instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: DATABASE_IMPORTS,
              message:
                'The AI layer never accesses the database. Use AIToolService, which calls owner-scoped domain services.',
            },
          ],
        },
      ],
    },
  },
];
