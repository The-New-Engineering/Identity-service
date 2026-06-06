/**
 * Contract validation gate.
 *
 * Checks:
 * 1. contract/openapi.yaml exists
 * 2. It is valid YAML
 * 3. It has the required OpenAPI fields (openapi, info, paths)
 * 4. Every path has at least one operation defined
 *
 * Run locally:  npm run validate:contract
 * Run in CI:    same command — exits 1 on failure, blocking the build
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const CONTRACT_PATH = path.resolve(process.cwd(), 'contract/openapi.yaml')

function fail(message: string): never {
  console.error(`\n❌ Contract validation failed: ${message}\n`)
  process.exit(1)
}

function pass(message: string) {
  console.log(`✅ ${message}`)
}

// ── Check 1: File exists ────────────────────────────────────────────
if (!fs.existsSync(CONTRACT_PATH)) {
  fail('contract/openapi.yaml not found. Every service must define its contract.')
}
pass('contract/openapi.yaml found')

// ── Check 2: Valid YAML ─────────────────────────────────────────────
let spec: any
try {
  const raw = fs.readFileSync(CONTRACT_PATH, 'utf8')
  spec = yaml.load(raw)
} catch (err) {
  fail(`contract/openapi.yaml is not valid YAML: ${(err as Error).message}`)
}
pass('contract/openapi.yaml is valid YAML')

// ── Check 3: Required OpenAPI fields ────────────────────────────────
const required = ['openapi', 'info', 'paths']
for (const field of required) {
  if (!spec[field]) {
    fail(`contract/openapi.yaml is missing required field: "${field}"`)
  }
}
pass('Required OpenAPI fields present (openapi, info, paths)')

// ── Check 4: Every path has at least one operation ──────────────────
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const paths = Object.entries(spec.paths ?? {})

if (paths.length === 0) {
  fail('contract/openapi.yaml defines no paths. Add at least one endpoint.')
}

for (const [route, definition] of paths) {
  const ops = HTTP_METHODS.filter((m) => (definition as any)[m])
  if (ops.length === 0) {
    fail(`Path "${route}" has no HTTP operations defined.`)
  }
}
pass(`All ${paths.length} path(s) have operations defined`)

console.log('\n✓ Contract is valid. Build may proceed.\n')
