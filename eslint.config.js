import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * RecBay dependency law (see docs/architecture.md):
 *
 *   kernel    → nothing inside src/
 *   ui        → nothing inside src/ (dumb, dependency-free)
 *   adapters  → kernel only
 *   state     → kernel only
 *   features  → kernel, state, ui — never another feature, never an adapter
 *   layout    → feature barrels ONLY (features/<name>, never deeper)
 *   app/main  → public barrels ONLY
 *
 * Convention: cross-section imports ALWAYS use the '@/' alias; imports
 * within the same section are relative. That makes this config able to
 * fence every section by specifier pattern, while src/__tests__/architecture.test.ts
 * additionally resolves relative imports so nothing can sneak past.
 *
 * Section isolation is lint-enforced so changing one section never
 * requires touching another.
 */

const ban = (paths) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: paths.map((p) => ({ group: [p], message: 'section boundary violation' })),
    },
  ],
})

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // kernel → nothing inside src/ (the alias bans all cross-section imports)
  {
    files: ['src/kernel/**/*.ts'],
    rules: ban(['@/*']),
  },
  // ui → nothing inside src/
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: ban(['@/*']),
  },
  // adapters → kernel only
  {
    files: ['src/adapters/**/*.ts'],
    rules: ban(['@/app/**', '@/features/**', '@/layout/**', '@/state/**', '@/ui/**']),
  },
  // state → kernel only (wiring of adapters happens in app/)
  {
    files: ['src/state/**/*.ts'],
    rules: ban(['@/adapters/**', '@/features/**', '@/layout/**', '@/app/**', '@/ui/**']),
  },
  // media (shared asset pipeline) → kernel, state, ui — never a feature or adapter
  {
    files: ['src/media/**/*.{ts,tsx}'],
    rules: ban(['@/features/**', '@/adapters/**', '@/layout/**', '@/app/**']),
  },
  // features → kernel, state, ui — never a sibling feature, never an adapter
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: ban([
      '@/features',
      '@/features/**',
      '@/adapters/**',
      '@/layout/**',
      '@/app/**',
      '../canvas/**',
      '../checklist/**',
      '../parser/**',
      '../assets/**',
      '../settings/**',
      '../../features/**',
    ]),
  },
  // layout → feature barrels only
  {
    files: ['src/layout/**/*.{ts,tsx}'],
    rules: ban(['@/features/*/*', '@/features/*/*/**', '@/adapters/**', '../features/*/*']),
  },
  // app + main → public barrels only
  {
    files: ['src/app/**', 'src/main.tsx'],
    rules: ban(['@/features/*/*', '@/features/*/*/**', '@/*/index.ts']),
  },
  // tests may import anything
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
