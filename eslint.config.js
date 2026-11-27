// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const HEX = '/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/';
const COLOUR_FN = '/(rgba?|hsla?)\\s*\\(/';
const ARBITRARY_TAILWIND_COLOUR = '/\\[#/';

const noColourLiteral = [
  {
    selector: `Literal[value=${HEX}]`,
    message: 'No colour literal outside web/src/styles/tokens.css (DESIGN.md §15).',
  },
  {
    selector: `Literal[value=${COLOUR_FN}]`,
    message: 'No colour literal outside web/src/styles/tokens.css (DESIGN.md §15).',
  },
  {
    selector: `TemplateElement[value.raw=${COLOUR_FN}]`,
    message: 'No colour literal outside web/src/styles/tokens.css (DESIGN.md §15).',
  },
  {
    selector: `Literal[value=${ARBITRARY_TAILWIND_COLOUR}]`,
    message: 'No Tailwind arbitrary colour. Map the token in tokens.css and use the named class.',
  },
];

const noLiteralString = [
  {
    selector: 'JSXText[value=/[A-Za-z]{2}/]',
    message: 'User-facing text comes from the i18n catalogs, never a JSX literal (i18n.md).',
  },
  {
    selector:
      'JSXAttribute[name.name=/^(title|aria-label|aria-description|placeholder|alt|label)$/] > Literal[value!=/^\\s*$/]',
    message: 'User-facing attribute strings come from the i18n catalogs (i18n.md).',
  },
];

const noOwnerComparison = [
  {
    selector: `BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='ownerId']`,
    message:
      'Permission decisions belong in server/src/lib/authz.ts only (docs/permissions.md §1).',
  },
  {
    selector: `BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='owner_id']`,
    message:
      'Permission decisions belong in server/src/lib/authz.ts only (docs/permissions.md §1).',
  },
];

const dependencyBoundary = [
  'error',
  {
    paths: [],
    patterns: [
      {
        group: ['@tanstack/db', '@tanstack/db/*'],
        message: 'TanStack DB is imported only from web/src/data/ (D-48).',
      },
      {
        group: ['@tanstack/react-hotkeys', '@tanstack/react-hotkeys/*'],
        message: 'Beta dependency: imported only from web/src/lib/hotkeys.ts (D-49).',
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'server/prisma/migrations/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server/src/**/*.ts'],
    ignores: ['server/src/og/palette.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noColourLiteral, ...noOwnerComparison],
    },
  },
  {
    files: ['server/test/**/*.ts', 'web/test/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['web/src/**/*.ts', 'web/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...noColourLiteral, ...noLiteralString],
      'no-restricted-imports': dependencyBoundary,
    },
  },
  {
    // Vendored MIT code (laurentpayot/minidenticons): its `hsl()` fill is the
    // hue its hash picks, not a design colour. The string rule still applies.
    files: ['web/src/lib/identicon.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noLiteralString],
    },
  },
  {
    files: ['web/src/data/**/*.ts', 'web/src/data/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [],
          patterns: [
            {
              group: ['@tanstack/react-hotkeys', '@tanstack/react-hotkeys/*'],
              message: 'Beta dependency: imported only from web/src/lib/hotkeys.ts (D-49).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['web/src/lib/hotkeys.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
