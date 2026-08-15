#!/usr/bin/env node
/**
 * Verifies that a packaged app contains every production dependency that is
 * installed in the project's node_modules.
 *
 * Why: electron-builder's npm collector silently drops packages that only
 * appear as peer dependencies, and a packaged app sitting inside the project
 * directory masks the loss (Node resolution walks up to the project
 * node_modules). This script fails the build if any installed production
 * package is missing from the packaged app.
 *
 * Packages installed in node_modules but absent from the npm production
 * tree (other-platform optional natives staged by install-arch-deps.sh) are
 * ignored; installed + in-tree + missing-from-package = error.
 *
 * Usage: node scripts/verify-package.mjs <path-to-packaged-resources-app>
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const appNodeModules = process.argv[2]
if (!appNodeModules) {
  console.error('usage: node scripts/verify-package.mjs <packaged-app-node_modules>')
  process.exit(2)
}

// Windows: spawning npm/npm.cmd without a shell is rejected by Node
// (ENOENT/EINVAL since the .bat/.cmd security hardening). Use a shell there.
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  })
)

const wanted = new Set()
const walk = (node) => {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!info.extraneous) wanted.add(name)
    walk(info)
  }
}
walk(tree)

const listDirs = (dir) => {
  const out = new Set()
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(path.join(dir, entry))) out.add(`${entry}/${sub}`)
    } else {
      out.add(entry)
    }
  }
  return out
}

const installed = listDirs('node_modules')
const packaged = listDirs(appNodeModules)

const missing = [...wanted].filter((name) => installed.has(name) && !packaged.has(name)).sort()

if (missing.length > 0) {
  console.error(`ERROR: ${missing.length} production package(s) missing from the packaged app:`)
  for (const name of missing) console.error(`  - ${name}`)
  process.exit(1)
}
console.log(`OK: all ${wanted.size} installed production packages are present in the packaged app`)
