/**
 * A seeded artwork listing for specs.
 *
 * The outfits now come from the host half rather than from imported constants, so
 * a spec has to publish a listing before the modules under test can resolve a
 * sprite. Seeding through the real seam (`seedArtwork`) rather than stubbing the
 * modules keeps the tests on the same path the browser takes.
 */

import { seedArtwork, type ArtworkManifest } from '../src/client/artwork-source.ts'

/** Every work state, so a seeded outfit is always complete. */
const STATES = ['idle', 'think', 'tool', 'write', 'error'] as const

/** The outfits the repository ships, as folder names. */
export const COMMITTED_OUTFITS = ['swimsuit', 'winter', 'yukata'] as const

/**
 * Publish a listing shaped like the host's.
 * @param ids - outfit folder names to publish; defaults to the committed three.
 * @param rightSlots - extra `maid-right/` file names keyed by the slot their name
 *   encodes. The default listing ships none, so specs that do not ask for a
 *   file-backed right maid keep resolving the bundled portraits.
 * @returns the listing that was seeded.
 */
export function seedTestArtwork(
  ids: readonly string[] = COMMITTED_OUTFITS,
  rightSlots: Partial<Record<'thinking' | 'done' | 'failed' | 'winter', string>> = {},
): ArtworkManifest {
  const outfits = ids.map((id) => ({
    id,
    states: Object.fromEntries(
      STATES.map((state) => [state, `maid-left/${id}/${id}-${state}.webp`]),
    ),
  }))
  const manifest: ArtworkManifest = {
    schema: 1,
    outfits,
    files: [
      ...outfits.flatMap((outfit) => Object.values(outfit.states).map((path) => ({ path }))),
      { path: 'maid-left/maid/maid-atelier-maid-left-v5.webp' },
      { path: 'maid-right/maid-atelier-maid-right-v7.webp' },
      { path: 'maid-right/maid-atelier-maid-right-vision-v1.webp' },
      ...Object.values(rightSlots).map((name) => ({ path: `maid-right/${name}` })),
    ],
  }
  seedArtwork(manifest)
  return manifest
}

/**
 * The URL a seeded outfit + state resolves to.
 * @param id - outfit folder name.
 * @param state - work state.
 */
export function testSprite(id: string, state: string): string {
  return `/maid-atelier/art/maid-left/${id}/${id}-${state}.webp`
}

/**
 * The URL a seeded right-maid file resolves to.
 * @param name - file name inside `maid-right/`.
 */
export function testRightArt(name: string): string {
  return `/maid-atelier/art/maid-right/${name}`
}
