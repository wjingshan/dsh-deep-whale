// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installLeftArtwork,
  LEFT_ARTWORK_SETS,
  leftArtworkFor,
  MAID_LEFT_ARTWORK,
  MAID_LEFT_ARTWORK_WINTER,
  MAID_LEFT_ARTWORK_YUKATA,
  readLeftArtworkState,
  type LeftArtworkState,
} from '../src/client/left-artwork.ts'

const IDLE = 'data:image/webp;base64,IDLE'
const THINK = 'data:image/webp;base64,THINK'
const TOOL = 'data:image/webp;base64,TOOL'
const WRITE = 'data:image/webp;base64,WRITE'
const ERROR = 'data:image/webp;base64,ERROR'

/** The sprite node this module borrows, exactly as `createCharacterStage` builds it. */
function portrait(): HTMLImageElement {
  document.body.innerHTML = `<img data-maid-character="left" alt="" src="${IDLE}">`
  return document.querySelector<HTMLImageElement>('img')!
}

/** Reasoning row whose tail is still streaming. */
function thinking(): string {
  document.body.insertAdjacentHTML('beforeend', '<div data-variant="think" data-state="running"></div>')
  return 'think'
}

/** Settled reasoning row: the turn moved on to something else. */
function settleThinking(): void {
  document.querySelector('[data-variant="think"]')!.setAttribute('data-state', 'ok')
}

/** A tool / command row the harness has not settled yet. */
function toolRunning(): void {
  document.body.insertAdjacentHTML('beforeend', '<div data-variant="others" data-state="running"></div>')
}

/** Assistant text still arriving. */
function streaming(): void {
  document.body.insertAdjacentHTML('beforeend', '<div data-streaming="true"></div>')
}

function settleRunning(): void {
  document.querySelectorAll('[data-state="running"]').forEach((node) => node.setAttribute('data-state', 'ok'))
}

function failed(): void {
  document.body.insertAdjacentHTML('beforeend', '<div data-variant="others" data-state="error"></div>')
}

/** Let the observer callback and the coalescing timer both run. */
async function settle(ms = 400): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function useFakeArt(map: Record<string, string> = {}): void {
  window.__dshMaidAtelierLeftArtwork = { idle: IDLE, think: THINK, tool: TOOL, write: WRITE, error: ERROR, ...map }
}

afterEach(() => {
  delete window.__dshMaidAtelierLeftArtwork
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('left artwork reader', () => {  it('answers idle when the host writes none of its signals', () => {
    document.body.innerHTML = '<div data-state="ongoing"></div>'
    expect(readLeftArtworkState()).toBe('idle')
  })

  it('separates thinking, tool running and answering', () => {
    thinking()
    expect(readLeftArtworkState()).toBe('think')

    settleThinking()
    expect(readLeftArtworkState()).toBe('idle')

    toolRunning()
    expect(readLeftArtworkState()).toBe('tool')

    settleRunning()
    streaming()
    // A text-only turn keeps no running row: streaming is the live signal.
    expect(readLeftArtworkState()).toBe('write')

    document.querySelector('[data-streaming]')!.remove()
    expect(readLeftArtworkState()).toBe('idle')
  })

  it('reads a caller-supplied subtree', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div data-state="running"></div>'
    expect(readLeftArtworkState(scope)).toBe('tool')
  })
})

describe('left artwork swap', () => {
  it('walks the turn through thinking, tool, writing and back to idle', async () => {
    vi.useFakeTimers()
    useFakeArt()
    const image = portrait()
    const dispose = installLeftArtwork()
    expect(image.getAttribute('src')).toBe(IDLE)

    thinking()
    await settle()
    expect(image.getAttribute('src')).toBe(THINK)
    expect(image.getAttribute('data-maid-left-state')).toBe('think')

    settleThinking()
    toolRunning()
    await settle()
    expect(image.getAttribute('src')).toBe(TOOL)

    settleRunning()
    streaming()
    await settle()
    expect(image.getAttribute('src')).toBe(WRITE)
    expect(image.getAttribute('data-maid-left-state')).toBe('write')

    document.querySelector('[data-streaming]')!.remove()
    await settle()
    expect(image.getAttribute('src')).toBe(IDLE)
    expect(image.getAttribute('data-maid-left-state')).toBe('idle')
    dispose()
  })

  it('holds the startled sprite after a turn that failed', async () => {
    vi.useFakeTimers()
    useFakeArt()
    const image = portrait()
    const dispose = installLeftArtwork()

    toolRunning()
    await settle()
    expect(image.getAttribute('src')).toBe(TOOL)

    failed()
    await settle()
    expect(image.getAttribute('src')).toBe(ERROR)

    settleRunning()
    await settle()
    expect(image.getAttribute('src')).toBe(ERROR)

    // The hold expires on its own and the idle sprite returns.
    await settle(4400)
    expect(image.getAttribute('src')).toBe(IDLE)
    dispose()
  })

  it('ignores a failure that predates the current turn', async () => {
    vi.useFakeTimers()
    useFakeArt()
    const image = portrait()
    const dispose = installLeftArtwork()

    failed()
    await settle()
    expect(image.getAttribute('src')).toBe(IDLE)

    toolRunning()
    await settle()
    settleRunning()
    await settle()
    // The turn ended without a new failure: no startled sprite, no hold.
    expect(image.getAttribute('src')).toBe(IDLE)
    dispose()
  })

  it('restores the sprite it replaced when disposed, and tolerates a second disposal', async () => {
    vi.useFakeTimers()
    useFakeArt()
    const image = portrait()
    const dispose = installLeftArtwork()

    thinking()
    await settle()
    expect(image.getAttribute('src')).toBe(THINK)

    dispose()
    expect(image.getAttribute('src')).toBe(IDLE)
    expect(image.hasAttribute('data-maid-left-state')).toBe(false)

    dispose()
    expect(image.getAttribute('src')).toBe(IDLE)
  })

  it('observes nothing while switched off', async () => {
    vi.useFakeTimers()
    const image = portrait()
    const dispose = installLeftArtwork({ enabled: false })
    thinking()
    toolRunning()
    await settle()
    expect(image.getAttribute('src')).toBe(IDLE)
    expect(image.hasAttribute('data-maid-left-state')).toBe(false)
    dispose()
  })

  it('leaves the sprite alone when a state has no art, while still reporting the state', async () => {
    vi.useFakeTimers()
    useFakeArt({ think: undefined } as never)
    const image = portrait()
    const dispose = installLeftArtwork()
    thinking()
    await settle()
    // Nothing to swap to, but the state still reaches the stylesheet.
    expect(image.getAttribute('src')).toBe(IDLE)
    expect(image.getAttribute('data-maid-left-state')).toBe('think')
    dispose()
  })
})

describe('left artwork outfits', () => {
  /** Every state a sprite set has to cover. */
  const STATES: LeftArtworkState[] = ['idle', 'think', 'tool', 'write', 'error']

  it('ships every outfit with all five states, and no two outfits share a sprite', () => {
    const seen = new Map<string, string>()
    for (const [outfit, sprites] of Object.entries(LEFT_ARTWORK_SETS)) {
      for (const state of STATES) {
        const sprite = sprites[state]
        // A missing or mistyped constant would leave the maid blank, and a
        // copy-paste slip would silently reuse another outfit's pose.
        expect(sprite, `${outfit}.${state}`).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/)
        const owner = seen.get(sprite)
        expect(owner, `${outfit}.${state} duplicates ${owner}`).toBeUndefined()
        seen.set(sprite, `${outfit}.${state}`)
      }
    }
    expect(seen.size).toBe(Object.keys(LEFT_ARTWORK_SETS).length * STATES.length)
  })

  it('resolves the outfit the setting asks for, falling back to the default', () => {
    expect(leftArtworkFor('swimsuit')).toBe(MAID_LEFT_ARTWORK)
    expect(leftArtworkFor('winter')).toBe(MAID_LEFT_ARTWORK_WINTER)
    expect(leftArtworkFor('yukata')).toBe(MAID_LEFT_ARTWORK_YUKATA)
    // An unknown value leaves her dressed rather than blank.
    expect(leftArtworkFor('nonsense')).toBe(MAID_LEFT_ARTWORK)
    expect(leftArtworkFor(undefined)).toBe(MAID_LEFT_ARTWORK)
  })

  it('wears the selected outfit and keeps the work states inside it', async () => {
    vi.useFakeTimers()
    const image = portrait()

    const swimsuit = installLeftArtwork({ variant: 'swimsuit' })
    expect(image.getAttribute('src')).toBe(MAID_LEFT_ARTWORK.idle)
    swimsuit()
    expect(image.getAttribute('src')).toBe(IDLE)

    const winter = installLeftArtwork({ variant: 'winter' })
    expect(image.getAttribute('src')).toBe(MAID_LEFT_ARTWORK_WINTER.idle)

    thinking()
    await settle()
    expect(image.getAttribute('src')).toBe(MAID_LEFT_ARTWORK_WINTER.think)

    settleThinking()
    toolRunning()
    await settle()
    expect(image.getAttribute('src')).toBe(MAID_LEFT_ARTWORK_WINTER.tool)

    winter()
    expect(image.getAttribute('src')).toBe(IDLE)
  })
})
