/**
 * Session-state portraits for the right maid.
 *
 * The harness already publishes what it is doing through its own DOM contract:
 * the reasoning row and the tool row both carry `data-state`, so the skin can
 * tell "she is working", "this turn just finished" and "this turn failed"
 * without touching a service, emitting an event, or reaching a model request.
 *
 * Four variant portraits ship as files rather than inside this bundle: the active
 * theme under `assets/maid-right/` fills `thinking` / `done` / `failed` / `winter`
 * from `think.webp` / `done.webp` / `failed.webp` / `winter.webp`, and the
 * `artworkVariant` setting picks which of them the right maid wears while idle.
 * A slot the listing does not fill leaves the portrait on screen alone, so a theme
 * without expressions degrades to her base art instead of an empty node. A host
 * may override any state portrait by setting `window.__dshMaidAtelierArtwork`
 * before the skin activates; that override wins over the listing.
 *
 * @module
 */

import { artworkRightBase, artworkRightStates, type RightArtworkSlot } from './artwork-source.ts'

export type SessionArtworkState = 'thinking' | 'done' | 'failed'

export type SessionArtworkMap = Partial<Record<SessionArtworkState, string>>

/** Keys accepted by the `artworkVariant` dropdown; `default` keeps the base art. */
export type SessionArtworkVariant = 'default' | 'thinking' | 'done' | 'failed' | 'winter'

declare global {
  interface Window {
    /**
     * Optional per-state portrait overrides, read once per install. Keys not
     * present here fall back to the artwork listing.
     */
    __dshMaidAtelierArtwork?: SessionArtworkMap
  }
}


/** Rows the harness marks as actively working (reasoning or a running tool). */
const RUNNING_SELECTOR = '[data-state="running"]'

/**
 * Rows that already ended badly. `stopped` is an interrupted tool call, which
 * reads as "this turn did not land" exactly as `error` does.
 */
const FAILED_SELECTOR = '[data-state="error"], [data-state="stopped"]'

/**
 * The node this module borrows while a variant portrait is on screen. The skin
 * owns every `[data-maid-character]` node, so this selector cannot drift with
 * the host.
 */
const PORTRAIT_SELECTOR = '[data-maid-character="right"]'

/** How long a finished or failed portrait stays up before the idle art returns. */
const HOLD_MS = 4200

/**
 * A streaming transcript mutates constantly; coalescing the resulting bursts
 * keeps one turn at a handful of recounts instead of thousands.
 */
const TICK_MS = 280

/** The slot a variant name selects, or undefined for `default`. */
function slotOfVariant(variant: unknown): RightArtworkSlot | undefined {
  if (variant === 'thinking' || variant === 'done' || variant === 'failed' || variant === 'winter') {
    return variant
  }
  return undefined
}

export interface SessionArtworkOptions {
  /** The `stateArtwork` switch: follow the session and swap while it runs. */
  stateEnabled?: boolean
  /** The `artworkVariant` dropdown value, used while the session is idle. */
  variant?: unknown
}

/**
 * Install the idle artwork and, when enabled, the session-state swap.
 *
 * @returns A disposer that disconnects the observer, clears both timers, and
 *   restores the portrait this module replaced. Idempotent, so a repeated
 *   disposal cannot remove another activation's writes.
 */
export function installSessionArtwork(options: SessionArtworkOptions = {}): () => void {
  const supplied = window.__dshMaidAtelierArtwork

  /**
   * Resolve one portrait at the moment it is written: the window override wins,
   * then whatever the active theme under `assets/maid-right/` offers. Resolving
   * per write means a listing that arrives after install is picked up on the next
   * swap, and a slot nothing fills resolves to `undefined`, which leaves the node
   * as it is instead of blanking it.
   */
  const portraitFor = (slot: RightArtworkSlot): string | undefined =>
    (slot === 'winter' ? undefined : supplied?.[slot]) ?? artworkRightStates()[slot]

  const idle = slotOfVariant(options.variant)
  // 显式传入以开关为准；未传时按“宿主是否提供了立绘”推断（保持旧调用语义）。
  const stateEnabled =
    options.stateEnabled ?? (supplied !== undefined || Object.keys(artworkRightStates()).length > 0)
  if (!stateEnabled && idle === undefined) {
    // Nothing to show: never observe, so a deployment that wants the stock
    // artwork pays nothing at all.
    return () => { /* nothing was observed or written */ }
  }

  /** The value found before this module first wrote, restored verbatim. */
  let originalSrc: string | null = null
  let observer: MutationObserver | undefined
  let tick: ReturnType<typeof setTimeout> | undefined
  let hold: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  /** True between the first running row appearing and the last one settling. */
  let working = false
  /** Failure rows already on the page when the current turn started. */
  let errorBaseline = 0
  /** Portrait for the state the session is in right now, if any. */
  let live: string | undefined
  /** Portrait for the finished/failed state, held for {@link HOLD_MS}. */
  let held: string | undefined

  const portrait = (): HTMLImageElement | null =>
    document.querySelector<HTMLImageElement>(PORTRAIT_SELECTOR)

  const paint = (): void => {
    const image = portrait()
    if (image === null) return
    if (originalSrc === null) originalSrc = image.getAttribute('src')
    // Idle is the variant the setting names, or the active theme's own base
    // portrait; `originalSrc` stays the last resort for an empty listing.
    const next =
      live ?? held ?? (idle === undefined ? artworkRightBase() : portraitFor(idle)) ?? originalSrc
    if (next === null || image.getAttribute('src') === next) return
    image.setAttribute('src', next)
  }

  const recount = (): void => {
    if (disposed || !stateEnabled) return
    const failures = document.querySelectorAll(FAILED_SELECTOR).length
    const busy = document.querySelectorAll(RUNNING_SELECTOR).length > 0
    if (busy) {
      // A new turn starts here: whatever failed earlier is history, not a
      // verdict on this turn, so the baseline is taken at this moment.
      if (!working) {
        working = true
        errorBaseline = failures
      }
      if (hold !== undefined) clearTimeout(hold)
      hold = undefined
      held = undefined
      live = failures > errorBaseline ? portraitFor('failed') : portraitFor('thinking')
    } else {
      live = undefined
      if (working) {
        working = false
        held = failures > errorBaseline ? portraitFor('failed') : portraitFor('done')
        if (hold !== undefined) clearTimeout(hold)
        hold = setTimeout(() => {
          hold = undefined
          held = undefined
          paint()
        }, HOLD_MS)
      }
    }
    paint()
  }

  if (stateEnabled) {
    observer = new MutationObserver(() => {
      if (disposed || tick !== undefined) return
      tick = setTimeout(() => {
        tick = undefined
        recount()
      }, TICK_MS)
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true,
    })
    recount()
  } else {
    paint()
  }

  return () => {
    disposed = true
    observer?.disconnect()
    observer = undefined
    if (tick !== undefined) clearTimeout(tick)
    if (hold !== undefined) clearTimeout(hold)
    tick = undefined
    hold = undefined
    working = false
    live = undefined
    held = undefined
    const image = portrait()
    if (image !== null && originalSrc !== null && image.getAttribute('src') !== originalSrc) {
      image.setAttribute('src', originalSrc)
    }
  }
}
