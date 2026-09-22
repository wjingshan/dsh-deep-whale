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
 * Three outfits ship inside the package, five sprites each (see
 * `left-state-art.generated.ts`); the `leftArtworkVariant` setting picks which
 * one she wears, and a host may override any sprite of the active outfit by
 * setting `window.__dshMaidAtelierLeftArtwork` before the skin activates.
 *
 * @module
 */
import {
  MAID_ATELIER_LEFT_SWIM_ERROR,
  MAID_ATELIER_LEFT_SWIM_IDLE,
  MAID_ATELIER_LEFT_SWIM_THINK,
  MAID_ATELIER_LEFT_SWIM_TOOL,
  MAID_ATELIER_LEFT_SWIM_WRITE,
  MAID_ATELIER_LEFT_WINTER_ERROR,
  MAID_ATELIER_LEFT_WINTER_IDLE,
  MAID_ATELIER_LEFT_WINTER_THINK,
  MAID_ATELIER_LEFT_WINTER_TOOL,
  MAID_ATELIER_LEFT_WINTER_WRITE,
  MAID_ATELIER_LEFT_YUKATA_ERROR,
  MAID_ATELIER_LEFT_YUKATA_IDLE,
  MAID_ATELIER_LEFT_YUKATA_THINK,
  MAID_ATELIER_LEFT_YUKATA_TOOL,
  MAID_ATELIER_LEFT_YUKATA_WRITE,
} from './left-state-art.generated.ts'

/** The work states the left maid can wear. */
export type LeftArtworkState = 'idle' | 'think' | 'tool' | 'write' | 'error'

/** One sprite per state; every value is a webp data URL. */
export type LeftArtworkMap = Record<LeftArtworkState, string>

/** Outfits the `leftArtworkVariant` setting can select. */
export type LeftArtworkVariant = 'swimsuit' | 'winter' | 'yukata'

declare global {
  interface Window {
    /** Optional per-state overrides for the LEFT maid, read once per install. */
    __dshMaidAtelierLeftArtwork?: Partial<LeftArtworkMap>
  }
}

/** Swimsuit set — the default outfit. */
export const MAID_LEFT_ARTWORK: LeftArtworkMap = {
  idle: MAID_ATELIER_LEFT_SWIM_IDLE,
  think: MAID_ATELIER_LEFT_SWIM_THINK,
  tool: MAID_ATELIER_LEFT_SWIM_TOOL,
  write: MAID_ATELIER_LEFT_SWIM_WRITE,
  error: MAID_ATELIER_LEFT_SWIM_ERROR,
}

/** Winter dress set — the same coat the right maid wears in her winter portrait. */
export const MAID_LEFT_ARTWORK_WINTER: LeftArtworkMap = {
  idle: MAID_ATELIER_LEFT_WINTER_IDLE,
  think: MAID_ATELIER_LEFT_WINTER_THINK,
  tool: MAID_ATELIER_LEFT_WINTER_TOOL,
  write: MAID_ATELIER_LEFT_WINTER_WRITE,
  error: MAID_ATELIER_LEFT_WINTER_ERROR,
}

/** Summer festival yukata set. */
export const MAID_LEFT_ARTWORK_YUKATA: LeftArtworkMap = {
  idle: MAID_ATELIER_LEFT_YUKATA_IDLE,
  think: MAID_ATELIER_LEFT_YUKATA_THINK,
  tool: MAID_ATELIER_LEFT_YUKATA_TOOL,
  write: MAID_ATELIER_LEFT_YUKATA_WRITE,
  error: MAID_ATELIER_LEFT_YUKATA_ERROR,
}

/** Every outfit by variant key; the dropdown order is this order. */
export const LEFT_ARTWORK_SETS: Record<LeftArtworkVariant, LeftArtworkMap> = {
  swimsuit: MAID_LEFT_ARTWORK,
  winter: MAID_LEFT_ARTWORK_WINTER,
  yukata: MAID_LEFT_ARTWORK_YUKATA,
}

/**
 * Resolve the outfit a setting value asks for. An unknown value (a manager that
 * stores something this build does not ship, or a value the user typed) falls
 * back to the default outfit instead of leaving the maid without artwork.
 */
export function leftArtworkFor(variant: unknown): LeftArtworkMap {
  return typeof variant === 'string' && variant in LEFT_ARTWORK_SETS
    ? LEFT_ARTWORK_SETS[variant as LeftArtworkVariant]
    : MAID_LEFT_ARTWORK
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
  const map: LeftArtworkMap = { ...leftArtworkFor(options.variant), ...supplied, ...options.map }
  const enabled = options.enabled ?? true
  if (!enabled) {
    // Nothing to do: the stage already carries the idle sprite, so a disabled
    // deployment pays for no observer at all.
    return () => { /* nothing was observed or written */ }
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

  const portrait = (): HTMLImageElement | null =>
    document.querySelector<HTMLImageElement>(PORTRAIT_SELECTOR)

  const paint = (): void => {
    const image = portrait()
    if (image === null) return
    const state = live ?? held ?? 'idle'
    if (originalSrc === null) originalSrc = image.getAttribute('src')
    if (image.getAttribute(STATE_ATTRIBUTE) !== state) image.setAttribute(STATE_ATTRIBUTE, state)
    const next = map[state]
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

  return () => {
    disposed = true
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
