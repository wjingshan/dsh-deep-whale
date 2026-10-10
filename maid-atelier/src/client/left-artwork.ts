/**
 * Left-maid work-state artwork (WJ edition).
 *
 * The harness already publishes what it is doing through its own DOM contract,
 * and this module reads exactly the three signals the host writes:
 *
 * - a reasoning row still streaming its tail   -> `[data-variant='think'][data-state='running']`
 * - a tool / command row still unsettled       -> `[data-state='running']`
 * - assistant text still arriving              -> `[data-streaming]`
 *
 * plus the settled-bad rows `[data-state='error']` / `[data-state='stopped']`
 * that mark a turn as not landing. Anything else is idle, so a host that
 * renames every one of these selectors simply keeps the idle sprite — this
 * module never writes unless a signal actually matches.
 *
 * Outfits are folders, not source. The host half lists `assets/maid-left/*` and
 * this module turns that listing into the sprite table, so a new outfit is a new
 * folder and nothing else; `leftArtworkVariant` picks which one she wears, and a
 * host may still override any sprite of the active outfit by setting
 * `window.__dshMaidAtelierLeftArtwork` before the skin activates.
 *
 * @module
 */
import { artworkManifest, artworkUrl, onArtworkChange } from './artwork-source.ts'

/** The work states the left maid can wear. */
export type LeftArtworkState = 'idle' | 'think' | 'tool' | 'write' | 'error'

/**
 * One sprite per state, as a URL the host half serves.
 *
 * Partial because a discovered outfit may supply fewer than every state: a set
 * that omits one simply keeps the previous sprite for it rather than breaking.
 */
export type LeftArtworkMap = Partial<Record<LeftArtworkState, string>>

/**
 * Outfits the `leftArtworkVariant` setting can select.
 *
 * Deliberately `string` and not a union: the ids are folder names discovered at
 * runtime, so a union would re-introduce exactly the source edit that dropping a
 * folder is meant to avoid.
 */
export type LeftArtworkVariant = string

/** Every work state, in the order a set is expected to supply them. */
const WORK_STATES: readonly LeftArtworkState[] = ['idle', 'think', 'tool', 'write', 'error']

declare global {
  interface Window {
    /** Optional per-state overrides for the LEFT maid, read once per install. */
    __dshMaidAtelierLeftArtwork?: Partial<LeftArtworkMap>
  }
}

/**
 * The outfit worn when nothing selects one.
 *
 * Still a plain id rather than a live lookup: it is the setting's declared
 * `defaultValue`, so it has to be knowable before any listing has arrived. When
 * the listing does not carry it, {@link leftArtworkFor} falls back to the first
 * outfit that was discovered, which is what keeps a renamed folder working
 * instead of leaving her undressed.
 */
export const DEFAULT_LEFT_ARTWORK_VARIANT: LeftArtworkVariant = 'winter'

/** Sprite table per outfit id, rebuilt whenever the listing changes. */
let registry: Record<string, LeftArtworkMap> = {}

/** Outfit ids in listing order; the settings dropdown offers them in this order. */
let registryOrder: string[] = []

/**
 * Rebuild the sprite table from the current listing.
 *
 * Called on activation and again whenever the listing changes, so the ids the
 * dropdown advertises and the sprites actually painted cannot drift apart.
 * @returns true when an id or a sprite URL differed from the last build.
 */
export function rebuildLeftArtwork(): boolean {
  const manifest = artworkManifest()
  const next: Record<string, LeftArtworkMap> = {}
  for (const outfit of manifest?.outfits ?? []) {
    // Right-maid theme folders are listed in the same array; they are not outfits.
    if ((outfit.group ?? 'maid-left') !== 'maid-left') continue
    const sprites: LeftArtworkMap = {}
    for (const state of WORK_STATES) {
      const relative = outfit.states[state]
      if (typeof relative === 'string') sprites[state] = artworkUrl(relative)
    }
    next[outfit.id] = sprites
  }
  const order = Object.keys(next)
  const changed = order.join('\u0000') !== registryOrder.join('\u0000')
    || JSON.stringify(next) !== JSON.stringify(registry)
  registry = next
  registryOrder = order
  return changed
}

/** Every outfit by id. */
export function leftArtworkSets(): Record<string, LeftArtworkMap> {
  return registry
}

/** Outfit ids the settings dropdown offers, in listing order. */
export function leftArtworkVariants(): string[] {
  return registryOrder
}

/** The outfit the stage starts from, before any setting has been applied. */
export function defaultLeftArtwork(): LeftArtworkMap {
  return leftArtworkFor(DEFAULT_LEFT_ARTWORK_VARIANT)
}

/**
 * Resolve the outfit a setting value asks for.
 *
 * Three steps, because a stored value can outlive what it named: the requested
 * id when the listing carries it, then the declared default, then whatever was
 * discovered first. A manager holding an id from a folder that has since been
 * renamed therefore lands on a real outfit instead of on no artwork at all.
 */
export function leftArtworkFor(variant: unknown): LeftArtworkMap {
  if (typeof variant === 'string' && variant in registry) return registry[variant]
  if (DEFAULT_LEFT_ARTWORK_VARIANT in registry) return registry[DEFAULT_LEFT_ARTWORK_VARIANT]
  const first = registryOrder[0]
  return first === undefined ? {} : registry[first]
}

/** The node this module borrows; the skin owns every `[data-maid-character]`. */
const PORTRAIT_SELECTOR = '[data-maid-character="left"]'

/** Marks the state on the sprite so the stylesheet can add state motion. */
const STATE_ATTRIBUTE = 'data-maid-left-state'

/** A row the harness is still working on (reasoning tail or a running tool). */
const RUNNING_SELECTOR = '[data-state="running"]'

/** The reasoning row specifically, so "thinking" is distinguishable. */
const THINKING_SELECTOR = '[data-variant="think"][data-state="running"]'

/** Assistant text that is still streaming in. */
const STREAMING_SELECTOR = '[data-streaming]'

/** Rows that already ended badly; `stopped` is an interrupted tool call. */
const FAILED_SELECTOR = '[data-state="error"], [data-state="stopped"]'

/** How long the startled sprite stays up after a turn ends badly. */
const HOLD_MS = 4200

/** A streaming transcript mutates constantly; coalesce the bursts. */
const TICK_MS = 280

/**
 * Read the work state the conversation is in right now.
 *
 * Pure and side-effect free: the caller decides what to do with it, and a
 * missing / renamed signal answers `idle` instead of throwing. Streaming counts
 * on its own, because a turn that only writes text (no tool call) settles its
 * reasoning row and leaves `data-streaming` as the single live signal.
 *
 * @param root - Subtree to search; the document by default.
 */
export function readLeftArtworkState(root: ParentNode = document): LeftArtworkState {
  if (root.querySelector(THINKING_SELECTOR) !== null) return 'think'
  if (root.querySelector(RUNNING_SELECTOR) !== null) return 'tool'
  if (root.querySelector(STREAMING_SELECTOR) !== null) return 'write'
  return 'idle'
}

export interface LeftArtworkOptions {
  /** When false the module never observes and never writes. Defaults to true. */
  enabled?: boolean
  /** Outfit to wear; unknown values fall back to the default set. */
  variant?: unknown
  /** Subtree to observe; the document body by default. */
  root?: ParentNode
  /** Sprite overrides merged over the chosen outfit. */
  map?: Partial<LeftArtworkMap>
}

/**
 * Install the left maid's work-state sprite swap.
 *
 * @returns A disposer that disconnects the observer, clears both timers, drops
 *   the state attribute and restores the sprite this module replaced.
 *   Idempotent, so a repeated disposal cannot remove another activation's work.
 */
export function installLeftArtwork(options: LeftArtworkOptions = {}): () => void {
  const root = options.root ?? document.body
  const supplied = typeof window === 'undefined' ? undefined : window.__dshMaidAtelierLeftArtwork
  // A live view rather than a snapshot. The listing is fetched asynchronously, so
  // at install time the registry may still be empty; reading through the accessor
  // means the first paint after the listing lands already has real URLs. Host
  // overrides stay merged on top of whatever the listing supplies.
  const overrides: Partial<LeftArtworkMap> = { ...supplied, ...options.map }
  const map = (): LeftArtworkMap => ({ ...leftArtworkFor(options.variant), ...overrides })
  const enabled = options.enabled ?? true
  const portrait = (): HTMLImageElement | null =>
    document.querySelector<HTMLImageElement>(PORTRAIT_SELECTOR)

  if (!enabled) {
    // The switch means "stop following the work state", not "ignore the outfit".
    // She still has to wear the outfit the user picked -- otherwise turning the
    // switch off silently pins her to whatever sprite the stage was born with and
    // the outfit dropdown stops doing anything at all.
    let image: HTMLImageElement | null = null
    let originalSrc: string | null = null
    let originalState: string | null = null
    let stageWatch: MutationObserver | undefined
    let unwatchArtwork: (() => void) | undefined

    const dress = (): boolean => {
      const found = portrait()
      if (found === null) return false
      const idle = map().idle
      // No listing yet: leave the stage untouched and let the artwork listener
      // retry, rather than writing the string "undefined" into `src`.
      if (typeof idle !== 'string') return false
      if (image !== found) {
        // First (or a replacement) stage: remember what to restore verbatim.
        image = found
        originalSrc = found.getAttribute('src')
        originalState = found.getAttribute(STATE_ATTRIBUTE)
      }
      if (found.getAttribute(STATE_ATTRIBUTE) !== 'idle') found.setAttribute(STATE_ATTRIBUTE, 'idle')
      if (found.getAttribute('src') !== idle) found.setAttribute('src', idle)
      return true
    }

    const settle = (): void => {
      if (!dress()) return
      stageWatch?.disconnect()
      stageWatch = undefined
      unwatchArtwork?.()
      unwatchArtwork = undefined
    }

    if (!dress()) {
      // Two things can be missing and they arrive in either order: the stage is
      // created after the settings first apply, and the listing is fetched
      // asynchronously. Watch for both -- childList only, never the work-state
      // attributes, so she still cannot follow the session -- and stop the moment
      // she is dressed.
      stageWatch = new MutationObserver(() => settle())
      stageWatch.observe(root, { childList: true, subtree: true })
      unwatchArtwork = onArtworkChange(() => {
        rebuildLeftArtwork()
        settle()
      })
    }

    return () => {
      stageWatch?.disconnect()
      stageWatch = undefined
      unwatchArtwork?.()
      unwatchArtwork = undefined
      if (image === null) return
      if (originalState === null) image.removeAttribute(STATE_ATTRIBUTE)
      else image.setAttribute(STATE_ATTRIBUTE, originalState)
      if (originalSrc === null) image.removeAttribute('src')
      else image.setAttribute('src', originalSrc)
    }
  }

  let observer: MutationObserver | undefined
  let tick: ReturnType<typeof setTimeout> | undefined
  let hold: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  /** True between the first running row appearing and the last one settling. */
  let working = false
  /** Bad rows already on the page when the current turn started. */
  let errorBaseline = 0
  /** State the conversation is in while a turn runs. */
  let live: LeftArtworkState | undefined
  /** State held for {@link HOLD_MS} after a turn ended badly. */
  let held: 'error' | undefined
  /** The sprite value found before this module first wrote, restored verbatim. */
  let originalSrc: string | null = null

  const paint = (): void => {
    const image = portrait()
    if (image === null) return
    const state = live ?? held ?? 'idle'
    if (originalSrc === null) originalSrc = image.getAttribute('src')
    if (image.getAttribute(STATE_ATTRIBUTE) !== state) image.setAttribute(STATE_ATTRIBUTE, state)
    const next = map()[state]
    if (typeof next !== 'string' || image.getAttribute('src') === next) return
    image.setAttribute('src', next)
  }

  const clearHold = (): void => {
    if (hold !== undefined) clearTimeout(hold)
    hold = undefined
    held = undefined
  }

  const recount = (): void => {
    if (disposed) return
    const failures = root.querySelectorAll(FAILED_SELECTOR).length
    const busy = root.querySelector(RUNNING_SELECTOR) !== null
      || root.querySelector(STREAMING_SELECTOR) !== null
    if (busy) {
      // A new turn starts here: whatever failed earlier is history, not a
      // verdict on this turn, so the baseline is taken at this moment.
      if (!working) {
        working = true
        errorBaseline = failures
      }
      clearHold()
      // Busy is already known, so the reader answers think / tool / write here.
      live = failures > errorBaseline ? 'error' : readLeftArtworkState(root)
    } else {
      live = undefined
      if (working) {
        working = false
        if (failures > errorBaseline) {
          held = 'error'
          hold = setTimeout(() => {
            hold = undefined
            held = undefined
            paint()
          }, HOLD_MS)
        }
      }
    }
    paint()
  }

  observer = new MutationObserver(() => {
    if (disposed || tick !== undefined) return
    tick = setTimeout(() => {
      tick = undefined
      recount()
    }, TICK_MS)
  })
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-state', 'data-variant', 'data-streaming'],
    childList: true,
    subtree: true,
  })
  recount()

  // The listing arrives after the first paint, and an outfit can be added while
  // the window is open. Neither shows up unless we repaint, so re-read the
  // registry and paint whenever it changes.
  const unwatchArtwork = onArtworkChange(() => {
    rebuildLeftArtwork()
    paint()
  })

  return () => {
    disposed = true
    unwatchArtwork()
    observer?.disconnect()
    observer = undefined
    if (tick !== undefined) clearTimeout(tick)
    tick = undefined
    clearHold()
    working = false
    live = undefined
    const image = portrait()
    if (image !== null) {
      image.removeAttribute(STATE_ATTRIBUTE)
      if (originalSrc !== null && image.getAttribute('src') !== originalSrc) {
        image.setAttribute('src', originalSrc)
      }
    }
  }
}
