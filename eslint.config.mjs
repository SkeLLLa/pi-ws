import eslintConfig from '@skellla/lint-config/eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/logs/',
      '**/coverage/',
      '**/node_modules/',
      '**/.vscode/',
      '**/dist/',
    ],
  },
  {
    files: ['examples/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['examples/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'import-x/no-unresolved': 'off',
    },
  },
  ...eslintConfig,
];
