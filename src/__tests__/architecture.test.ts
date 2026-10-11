import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The dependency law (docs/architecture.md), enforced as a test:
 *
 *   kernel    → kernel only
 *   ui        → ui only (dumb, dependency-free)
 *   adapters  → kernel, adapters
 *   state     → kernel, state
 *   media     → kernel, state, ui (shared asset pipeline used by both layouts)
 *   features  → kernel, state, ui, media, and itself — NEVER another feature
 *   layout    → kernel, state, ui, feature BARRELS only
 *   app/dev   → anything, but features only via barrels
 *
 * ESLint fences alias imports at authoring time; this test additionally
 * RESOLVES relative imports, so nothing can sneak past the boundaries.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function specifiersOf(code: string): string[] {
  const out: string[] = []
  const fromRe = /(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g
  const sideRe = /import\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = fromRe.exec(code)) !== null) out.push(m[1])
  while ((m = sideRe.exec(code)) !== null) out.push(m[1])
  return [...new Set(out)]
}

function sectionOf(absPath: string): string {
  const rel = relative(SRC, absPath)
  const parts = rel.split(sep)
  if (parts.length === 1) {
    // a file directly under src/ (main.tsx) vs a top-level folder
    return /\.(ts|tsx)$/.test(parts[0]) ? 'root' : parts[0]
  }
  // Cross-section integration tests (two app instances, adapter + engine)
  // live beside the app and follow the root rule: anything, features only
  // via their barrels.
  if (parts[0] === '__tests__') return 'root'
  return parts[0]
}

function featureOf(absPath: string): string | null {
  const parts = relative(SRC, absPath).split(sep)
  return parts[0] === 'features' ? (parts[1] ?? null) : null
}

function resolveSpec(importer: string, spec: string): string | null {
  if (spec.startsWith('@/')) return resolve(SRC, spec.slice(2))
  if (spec.startsWith('.')) return resolve(dirname(importer), spec)
  return null // external package
}

const ALLOWED: Record<string, string[] | '*'> = {
  kernel: ['kernel'],
  ui: ['ui'],
  adapters: ['kernel', 'adapters'],
  state: ['kernel', 'state'],
  media: ['kernel', 'state', 'ui', 'media'],
  layout: ['kernel', 'state', 'ui', 'layout', 'features'],
  app: '*',
  dev: '*',
  root: '*',
  styles: '*',
}

function isFeatureBarrel(target: string): boolean {
  const rel = relative(SRC, target).split(sep)
  if (rel[0] !== 'features') return false
  if (rel.length <= 2) return true // features/<name> directory (its index.ts)
  if (rel.length === 3 && (rel[2] === 'index' || rel[2] === 'index.ts')) return true
  return false
}

function check(importer: string, target: string): string | null {
  const importerSection = sectionOf(importer)
  const targetSection = sectionOf(target)
  const imp = relative(SRC, importer)
  const tgt = relative(SRC, target)

  if (targetSection === 'styles') return null // css tokens/global are shared
  if (target.endsWith('.css') && targetSection !== importerSection) {
    // feature styles are private; shared styles live in src/styles
    if (!(targetSection === 'styles')) return `${imp} → ${tgt}: css must be section-private`
  }

  if (importerSection === 'features') {
    const self = featureOf(importer)
    if (targetSection === 'features') {
      const other = featureOf(target)
      if (other !== self) return `${imp} → ${tgt}: features must never import each other`
      return null
    }
    const allowed = ['kernel', 'state', 'ui', 'features', 'media']
    if (!allowed.includes(targetSection)) {
      return `${imp} → ${tgt}: features may depend only on kernel/state/ui/media`
    }
    return null
  }

  const rule = ALLOWED[importerSection]
  if (rule === undefined) return `${imp}: unknown section "${importerSection}"`
  if (rule === '*') {
    if (targetSection === 'features' && !isFeatureBarrel(target)) {
      return `${imp} → ${tgt}: features are reachable only via their index.ts barrel`
    }
    return null
  }
  if (!rule.includes(targetSection)) {
    return `${imp} → ${tgt}: ${importerSection} may only import [${rule.join(', ')}]`
  }
  if (targetSection === 'features' && !isFeatureBarrel(target)) {
    return `${imp} → ${tgt}: features are reachable only via their index.ts barrel`
  }
  return null
}

describe('section boundaries (dependency law)', () => {
  const files = walk(SRC)

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('every import respects the dependency law', () => {
    const violations: string[] = []
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
      for (const spec of specifiersOf(code)) {
        const target = resolveSpec(file, spec)
        if (!target) continue // external package
        const violation = check(file, target)
        if (violation) violations.push(violation)
      }
    }
    expect(violations).toEqual([])
  })

  it('layout and app import only feature barrels', () => {
    const importers = files.filter((f) => {
      const s = sectionOf(f)
      return s === 'layout' || s === 'app' || s === 'root'
    })
    const violations: string[] = []
    for (const file of importers) {
      const code = readFileSync(file, 'utf8')
      for (const spec of specifiersOf(code)) {
        const target = resolveSpec(file, spec)
        if (!target || sectionOf(target) !== 'features') continue
        if (!isFeatureBarrel(target)) {
          violations.push(`${relative(SRC, file)} → ${relative(SRC, target)}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
