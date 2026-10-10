/**
 * Client-side view of the host's artwork listing.
 *
 * A browser cannot read the filesystem, so the outfit folders under
 * `assets/maid-left/` are discovered by the host half and published at
 * {@link MANIFEST_ROUTE}. This module fetches that listing, keeps the last good
 * one, and tells its subscribers when it changes.
 *
 * ## Why this polls
 *
 * The manager's customization protocol has a register/unregister handshake but
 * no "the settings panel opened" event, and the panel is the manager's DOM, not
 * ours. Re-declaring the outfit list is therefore the only lever we have, and
 * something has to decide when to pull it.
 *
 * A short interval is the honest choice: the endpoint is local, `no-store`, and
 * a couple of kilobytes, and polling while the document is visible is what makes
 * "drop a folder, watch it appear" true *without* a page reload. The alternatives
 * were worse — a fixed selector into the manager's panel would break on its next
 * UI change, and refreshing only once at activation would mean the entries a
 * user sees are one reload stale.
 *
 * @module
 */

/** Route serving the artwork bytes; mirrors the host half. */
export const ART_ROUTE = '/maid-atelier/art/'

/** Route serving the artwork listing; mirrors the host half. */
export const MANIFEST_ROUTE = '/maid-atelier/outfits.json'

/** How often to re-read the listing while the document is visible. */
const POLL_MS = 5000

/** One outfit folder, keyed by its folder name. */
export interface ArtworkOutfit {
  id: string
  /** Work state -> artwork-root-relative file path. */
  states: Record<string, string>
}

/** One file under the artwork root. */
export interface ArtworkFile {
  /** Artwork-root-relative path, POSIX separators. */
  path: string
  /** Present only when the file names a work state. */
  state?: string
}

/** The listing the host publishes. */
export interface ArtworkManifest {
  schema: 1
  outfits: ArtworkOutfit[]
  files: ArtworkFile[]
}

/** Last listing that parsed, or undefined before the first successful read. */
let current: ArtworkManifest | undefined

/** Identity of the last listing, so a re-registration only happens on a change. */
let signature: string | undefined

const listeners = new Set<() => void>()

/**
 * Absolute URL for an artwork-root-relative path.
 *
 * Each segment is encoded separately so a `#` or `?` inside a file name cannot
 * truncate the request, while the separators stay separators.
 * @param relativePath - path as the listing reports it.
 * @returns the URL to hand an `<img src>`.
 */
export function artworkUrl(relativePath: string): string {
  return ART_ROUTE + relativePath.split('/').map(encodeURIComponent).join('/')
}

/** The last listing that parsed, or undefined before the first successful read. */
export function artworkManifest(): ArtworkManifest | undefined {
  return current
}

/**
 * Subscribe to listing changes.
 * @param listener - called after {@link refreshArtwork} accepts a new listing.
 * @returns the unsubscribe function.
 */
export function onArtworkChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * What makes two listings "the same" for re-registration purposes.
 *
 * Deliberately covers both the outfits and the flat file list: adding an outfit
 * changes the first, and replacing a sprite in place changes neither id nor
 * path — so the signature alone cannot catch a same-named image swap, which is
 * fine, because the served URL is unchanged and the browser is what re-reads it.
 * @param manifest - a parsed listing.
 * @returns a stable string for comparison.
 */
function signatureOf(manifest: ArtworkManifest): string {
  return JSON.stringify([
    manifest.outfits.map((outfit) => [outfit.id, Object.entries(outfit.states).sort()]),
    manifest.files.map((file) => file.path),
  ])
}

/**
 * Fetch the listing and notify subscribers when it differs from the last one.
 *
 * A failed fetch is not an error the skin can act on and never clears the last
 * good listing: the host half is optional in some compositions, and blanking the
 * artwork because one request lost a race would be worse than showing what was
 * already known.
 * @returns the listing when the read succeeded, otherwise the last good one.
 */
export async function refreshArtwork(): Promise<ArtworkManifest | undefined> {
  let fetched: ArtworkManifest
  try {
    const response = await fetch(MANIFEST_ROUTE, { cache: 'no-store' })
    if (!response.ok) {
      // Never silent. This one request is the skin's only source of character
      // art, so a rejected listing reads as "the maids vanished" with nothing to
      // go on. The desktop renderer loads its shell from `dsh-app://app` and
      // proxies other paths to the host, which is exactly the seam that can fail
      // before the server ever sees a request -- so the status is worth printing
      // even when the round trip completed.
      console.warn(`[maid-atelier] artwork listing rejected: HTTP ${response.status} ${MANIFEST_ROUTE}`)
      return current
    }
    fetched = (await response.json()) as ArtworkManifest
  } catch (error) {
    console.warn(`[maid-atelier] artwork listing unavailable: ${MANIFEST_ROUTE}`, error)
    return current
  }
  if (fetched === null || typeof fetched !== 'object' || !Array.isArray(fetched.outfits)) return current

  const next = signatureOf(fetched)
  const changed = next !== signature
  current = fetched
  signature = next
  if (changed) {
    console.info(`[maid-atelier] artwork listing: ${fetched.outfits.length} outfit(s)`)
    for (const listener of [...listeners]) listener()
  }
  return current
}

/**
 * Start keeping the listing fresh.
 *
 * Reads once immediately, then on visibility changes and on an interval that
 * only runs while the document is visible — a hidden tab has no panel to refresh
 * and no reason to hold a timer.
 * @returns the disposer that stops the timer and drops the listeners.
 */
export function watchArtwork(): () => void {
  void refreshArtwork()

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void refreshArtwork()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshArtwork()
  }, POLL_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
  }
}

/**
 * Test seam: install a listing without a host, and reset the change detection so
 * a spec can drive {@link onArtworkChange} deterministically.
 * @param manifest - the listing to adopt, or undefined to clear.
 */
export function seedArtwork(manifest: ArtworkManifest | undefined): void {
  current = manifest
  signature = manifest === undefined ? undefined : signatureOf(manifest)
}

/** A named right-maid portrait the session-state module can swap to. */
export type RightArtworkSlot = 'thinking' | 'done' | 'failed' | 'winter'

/** Named right-maid portraits; a slot is absent until the listing offers one. */
export type RightArtworkStates = Partial<Record<RightArtworkSlot, string>>

/**
 * File-name hints that fill a named right-maid slot, checked in order.
 *
 * The left maid's slots come from the host's own `state` field, but these four
 * are behaviour the skin drives rather than work states the host reports, so the
 * file name is the contract here — the same shape the vision layer already used.
 */
const RIGHT_ARTWORK_SLOTS: readonly (readonly [RightArtworkSlot, RegExp])[] = [
  ['thinking', /think/i],
  ['done', /done|delight/i],
  ['failed', /fail|error|deject/i],
  ['winter', /winter/i],
]

/** The named slot a right-maid file fills, or undefined when it is the portrait. */
function rightSlotOf(path: string): RightArtworkSlot | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return RIGHT_ARTWORK_SLOTS.find(([, pattern]) => pattern.test(name))?.[0]
}

/** The single-layer portraits the stage paints, as URLs. */
export interface ArtworkLayers {
  /** The left maid's identity reference, painted as the backdrop layer. */
  leftIdentity?: string
  /** The right maid's default portrait. */
  rightPortrait?: string
  /** The right maid's Flash-Vision portrait. */
  rightVision?: string
  /** The right maid's named portraits, when the listing carries them. */
  rightStates?: RightArtworkStates
}

/**
 * Resolve the right maid's single-layer portraits and named slots.
 *
 * These carry a *role*, not an outfit, so unlike an outfit folder they cannot be
 * discovered by shape alone and something has to name them. Matching stays
 * tolerant of renames: the vision layer is whichever right-maid file says so, a
 * named slot is whichever file says `think` / `done` / `failed` / `winter`, and
 * the portrait is the first file that says none of those, so dropping in a newer
 * `-v8` keeps working without an edit.
 * @returns whatever the current listing can resolve; fields are absent before the
 *   first successful read.
 */
export function artworkLayers(): ArtworkLayers {
  const files = current?.files.map((file) => file.path) ?? []
  const leftIdentity = files.find((path) => path.startsWith('maid-left/maid/'))
  const right = files.filter((path) => path.startsWith('maid-right/')).sort()
  const rightStates: RightArtworkStates = {}
  let rightPortrait: string | undefined
  let rightVision: string | undefined
  for (const path of right) {
    if (/vision/i.test(path)) {
      if (rightVision === undefined) rightVision = path
      continue
    }
    const slot = rightSlotOf(path)
    if (slot === undefined) {
      if (rightPortrait === undefined) rightPortrait = path
      continue
    }
    if (rightStates[slot] === undefined) rightStates[slot] = artworkUrl(path)
  }
  return {
    ...(leftIdentity === undefined ? {} : { leftIdentity: artworkUrl(leftIdentity) }),
    ...(rightPortrait === undefined ? {} : { rightPortrait: artworkUrl(rightPortrait) }),
    ...(rightVision === undefined ? {} : { rightVision: artworkUrl(rightVision) }),
    ...(Object.keys(rightStates).length === 0 ? {} : { rightStates }),
  }
}

/** The listing's named right-maid portraits; empty before the first successful read. */
export function artworkRightStates(): RightArtworkStates {
  return artworkLayers().rightStates ?? {}
}
