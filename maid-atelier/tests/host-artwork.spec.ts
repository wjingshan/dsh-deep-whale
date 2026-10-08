/**
 * Host-half artwork discovery.
 *
 * The contract these cover is the one the feature exists for: a folder under
 * `assets/maid-left/` *is* an outfit, and its name *is* the id the settings panel
 * lists. So the tests both read the committed tree and create a folder at
 * runtime to prove no source change is involved.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { MANIFEST_ROUTE, apply, resolveArtwork, scanArtwork, stateOf } from '../src/index.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEFT_DIR = join(PACKAGE_ROOT, 'assets', 'maid-left')

/** Folders created by a test, removed afterwards even when the test fails. */
const temporary: string[] = []

afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('stateOf', () => {
  it('reads the state out of the committed verbose names', () => {
    expect(stateOf('maid-atelier-maid-left-swim-idle-v1.webp')).toBe('idle')
    expect(stateOf('maid-atelier-maid-left-winter-tool-v1.webp')).toBe('tool')
    expect(stateOf('maid-atelier-maid-left-yukata-error-v1.webp')).toBe('error')
  })

  it('accepts a bare state name so a dropped folder can be minimal', () => {
    expect(stateOf('think.webp')).toBe('think')
    expect(stateOf('write.png')).toBe('write')
  })

  it('does not read a state out of a name that merely contains one', () => {
    // `maid` contains no state token; `toolbox` must not match `tool`.
    expect(stateOf('maid-atelier-maid-left-v5.webp')).toBeUndefined()
    expect(stateOf('toolbox.webp')).toBeUndefined()
    expect(stateOf('maid-atelier-maid-right-vision-v1.webp')).toBeUndefined()
  })
})

describe('resolveArtwork', () => {
  it('accepts a path inside the artwork root', () => {
    expect(resolveArtwork('/maid-atelier/art/maid-left/winter/maid-atelier-maid-left-winter-idle-v1.webp'))
      .toBe(join(PACKAGE_ROOT, 'assets', 'maid-left', 'winter', 'maid-atelier-maid-left-winter-idle-v1.webp'))
  })

  it('ignores a query string', () => {
    expect(resolveArtwork('/maid-atelier/art/maid-left/maid/maid-atelier-maid-left-v5.webp?v=2'))
      .toBe(join(PACKAGE_ROOT, 'assets', 'maid-left', 'maid', 'maid-atelier-maid-left-v5.webp'))
  })

  it('refuses traversal, absolute paths, NUL bytes and non-images', () => {
    expect(resolveArtwork('/maid-atelier/art/../../../../etc/passwd')).toBeUndefined()
    expect(resolveArtwork('/maid-atelier/art/..%2f..%2f..%2fetc%2fpasswd')).toBeUndefined()
    expect(resolveArtwork('/maid-atelier/art/%2Fetc%2Fpasswd')).toBeUndefined()
    expect(resolveArtwork('/maid-atelier/art/maid-left%00.webp')).toBeUndefined()
    expect(resolveArtwork('/maid-atelier/art/maid-left/winter/notes.txt')).toBeUndefined()
  })

  it('refuses a path outside its own route', () => {
    expect(resolveArtwork(MANIFEST_ROUTE)).toBeUndefined()
    expect(resolveArtwork(undefined)).toBeUndefined()
  })

  it('confines a sibling directory that shares the root name prefix', () => {
    // `assets-evil` starts with `assets` but is not inside the artwork root.
    expect(resolveArtwork('/maid-atelier/art/../../assets-evil/secret.webp')).toBeUndefined()
  })
})

describe('scanArtwork', () => {
  it('reports one outfit per left-maid folder, keyed by folder name', async () => {
    const manifest = await scanArtwork()
    const ids = manifest.outfits.map((outfit) => outfit.id)

    // Membership, not equality. Folders are the contract now, so pinning the
    // exact list would make this test fail every time somebody legitimately drops
    // one in -- which is the one thing the design exists to allow.
    expect(ids).toEqual(expect.arrayContaining(['swimsuit', 'winter', 'yukata']))
    expect(manifest.schema).toBe(1)
  })

  it('gives every outfit all five work states pointing at real files', async () => {
    const manifest = await scanArtwork()

    for (const outfit of manifest.outfits) {
      expect(Object.keys(outfit.states).sort()).toEqual(['error', 'idle', 'think', 'tool', 'write'])
      for (const relative of Object.values(outfit.states)) {
        expect(existsSync(join(PACKAGE_ROOT, 'assets', relative))).toBe(true)
      }
    }
  })

  it('keeps the identity reference out of the outfit list but in the file list', async () => {
    const manifest = await scanArtwork()

    expect(manifest.outfits.map((outfit) => outfit.id)).not.toContain('maid')
    expect(manifest.files.map((file) => file.path))
      .toContain('maid-left/maid/maid-atelier-maid-left-v5.webp')
  })

  it('lists the right-maid artwork as files', async () => {
    const manifest = await scanArtwork()

    expect(manifest.files.map((file) => file.path)).toContain('maid-right/maid-atelier-maid-right-v7.webp')
    expect(manifest.files.map((file) => file.path)).toContain('maid-right/maid-atelier-maid-right-vision-v1.webp')
  })

  it('picks up a folder added at runtime with no source change', async () => {
    const added = await mkdtemp(join(LEFT_DIR, 'zz-tempoutfit-'))
    temporary.push(added)
    await writeFile(join(added, 'idle.webp'), 'not-really-a-webp')

    const manifest = await scanArtwork()
    const outfit = manifest.outfits.find((entry) => entry.id.startsWith('zz-tempoutfit-'))

    expect(outfit).toBeDefined()
    expect(outfit?.states.idle).toContain('idle.webp')
  })

  it('omits a folder that supplies no work states', async () => {
    const added = await mkdtemp(join(LEFT_DIR, 'zz-tempempty-'))
    temporary.push(added)
    await writeFile(join(added, 'notes.txt'), 'ignored')

    const manifest = await scanArtwork()

    expect(manifest.outfits.every((entry) => !entry.id.startsWith('zz-tempempty-'))).toBe(true)
    expect(manifest.files.every((file) => !file.path.includes('notes.txt'))).toBe(true)
  })
})

describe('route seats', () => {
  /** Collect what `apply` claims on a fake web server. */
  function claimSeats(): { kind: string; path: string }[] {
    const seats: { kind: string; path: string }[] = []
    const webServer = {
      register: (route: { kind: string; path: string }) => {
        seats.push({ kind: route.kind, path: route.path })
        return () => {}
      },
    }
    const ctx = {
      inject: (_names: string[], callback: (ctx: { webServer: typeof webServer }) => void) => {
        callback({ webServer })
        return () => {}
      },
      effect: (callback: () => () => void) => {
        callback()
        return () => {}
      },
    }
    apply(ctx as never)
    return seats
  }

  it('claims the artwork prefix without a trailing slash', () => {
    // Regression: registering `/maid-atelier/art/` produced a prefix route that
    // never matched a real request. Every image fell through to the server's own
    // 404 while the listing registered beside it answered 200, which read as "the
    // maids vanished" with nothing in the logs. The shipped prefix route
    // (`/plugins`) carries no trailing slash either.
    const prefix = claimSeats().find((seat) => seat.kind === 'prefix')

    expect(prefix?.path).toBe('/maid-atelier/art')
    expect(prefix?.path.endsWith('/')).toBe(false)
  })

  it('serves the listing and the bytes from two disjoint seats', () => {
    const seats = claimSeats()

    expect(seats.map((seat) => [seat.kind, seat.path])).toEqual([
      ['exact', '/maid-atelier/outfits.json'],
      ['prefix', '/maid-atelier/art'],
    ])
  })
})
