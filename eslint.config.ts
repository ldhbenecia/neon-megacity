import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
  {
    ignores: [
      'dist/',
      'screenshots/',
      'test-results/',
      'playwright-report/',
      'node_modules/',
      '.claude/worktrees/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
    },
  },
  // The app runs in the browser only; Node globals are for tests, scripts and configs.
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.browser } },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  // Playwright page callbacks run in the browser.
  {
    files: ['tests/e2e/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tests index into fixtures whose shape is asserted by the test itself.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
