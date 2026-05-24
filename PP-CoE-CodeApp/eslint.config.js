import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'
import { defineConfig, globalIgnores } from 'eslint/config'

// ---------------------------------------------------------------------------
// Architecture boundary rules
//
// Pin the feature-slice layout described in .github/copilot-instructions.md.
// CI fails when a feature reaches into a sibling feature or when shared/
// imports from features.
//
// Element types — each src directory maps to a role:
//   - app      → src/app/**           (shell only: AppShell, HomeRedirect)
//   - feature  → src/features/<name>/**
//   - shared   → src/shared/**        (currently empty; will host rehomed UI)
//   - shared-legacy → src/components/**, src/hooks/**, src/services/**,
//                     src/data/**, src/utils/**, src/featureFlags/**
//                     (legacy locations during the migration; treated as
//                     shared for now so existing imports keep working)
//   - generated → src/generated/**
//
// Allow rules:
//   - features → shared, shared-legacy, app, generated, themselves
//   - shared   → generated, themselves
//   - shared-legacy → shared-legacy, shared, generated, themselves
//   - app      → shared, shared-legacy, features, generated
//   - generated → nothing (leaf)
//
// Each feature is its own "element" instance keyed by the folder name, so
// `from-feature-X → to-feature-Y` is forbidden unless X === Y.
// ---------------------------------------------------------------------------
const boundariesElements = [
  // NOTE: with the default `mode: 'folder'`, the plugin auto-appends
  // `/**/*` to each pattern when matching files. So use the FOLDER
  // pattern here (no trailing wildcards), not the file pattern.
  { type: 'generated', pattern: 'src/generated' },
  { type: 'app', pattern: 'src/app' },
  { type: 'app', mode: 'file', pattern: 'src/App.tsx' },
  { type: 'app', mode: 'file', pattern: 'src/main.tsx' },
  {
    type: 'feature',
    pattern: 'src/features/*',
    capture: ['name'],
  },
  { type: 'shared', pattern: 'src/shared' },
  // Legacy locations that still hold cross-cutting code during the
  // migration. Once these folders are rehomed under src/shared/<x>/ they
  // can be dropped from this list.
  { type: 'shared-legacy', pattern: 'src/components' },
  { type: 'shared-legacy', pattern: 'src/hooks' },
  { type: 'shared-legacy', pattern: 'src/services' },
  { type: 'shared-legacy', pattern: 'src/data' },
  { type: 'shared-legacy', pattern: 'src/utils' },
  { type: 'shared-legacy', pattern: 'src/featureFlags' },
  { type: 'shared-legacy', pattern: 'src/test' },
]

export default defineConfig([
  globalIgnores(['dist', 'src/generated/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Boundary rules — applied only to files we own; do NOT recurse into
  // src/generated (leaf-only, fully managed by the connector generator)
  // or test files (vi.mock can legitimately import any module).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/generated/**', 'src/**/*.test.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': boundariesElements,
      'boundaries/include': ['src/**/*'],
      // Default is just 'import' — but we also want to catch
      // `export { x } from 'sibling-feature'` style re-exports.
      'boundaries/dependency-nodes': ['import', 'export', 'dynamic-import', 'require'],
      // Make the import resolver aware of TypeScript so .ts/.tsx
      // extension-less imports get resolved before boundary checks run.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            "${file.type} is not allowed to import ${dependency.type} (${dependency.source}). See .github/copilot-instructions.md > Rules.",
          rules: [
            // app shell composes everything
            {
              from: ['app'],
              allow: ['app', 'feature', 'shared', 'shared-legacy', 'generated'],
            },
            // features can import shared, shared-legacy, app types,
            // generated, and themselves — but never a sibling feature.
            {
              from: ['feature'],
              allow: [
                ['feature', { name: '${from.name}' }],
                'shared',
                'shared-legacy',
                'app',
                'generated',
              ],
            },
            // shared/ may only depend on generated and itself
            { from: ['shared'], allow: ['shared', 'generated'] },
            // shared-legacy/ (transitional) may depend on itself + shared + generated
            {
              from: ['shared-legacy'],
              allow: ['shared-legacy', 'shared', 'generated'],
            },
          ],
        },
      ],
    },
  },
])
