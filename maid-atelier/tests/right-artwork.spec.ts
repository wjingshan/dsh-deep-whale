// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artworkLayers, artworkRightStates, seedArtwork } from '../src/client/artwork-source.ts'
import { installSessionArtwork } from '../src/client/session-artwork.ts'
import { seedTestArtwork, testRightArt } from './artwork-fixture.ts'

const BASE = 'data:image/webp;base64,BASE'
const OVERRIDE = 'data:image/webp;base64,OVERRIDE'

/** One right-maid file per named slot, named the way the repository names them. */
const FILES = {
  thinking: 'maid-atelier-maid-right-think-v1.webp',
  done: 'maid-atelier-maid-right-done-v1.webp',
  failed: 'maid-atelier-maid-right-failed-v1.webp',
  winter: 'maid-atelier-maid-right-winter-v1.webp',
} as const

/** The stage node this module borrows, exactly as `createCharacterStage` builds it. */
function stage(): HTMLImageElement {
  document.body.innerHTML = `<img data-maid-character="right" alt="" src="${BASE}">`
  return document.querySelector<HTMLImageElement>('img')!
}

/** Let the observer callback and the coalescing timer both run. */
async function settle(ms = 300): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function running(): void {
  document.body.insertAdjacentHTML('beforeend', '<div data-state="running"></div>')
}

afterEach(() => {
  delete window.__dshMaidAtelierArtwork
  seedArtwork(undefined)
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('right-maid artwork from the listing', () => {
  it('maps state-named files to their slots and leaves the portrait alone', () => {
    seedTestArtwork(undefined, FILES)

    const layers = artworkLayers()
    expect(layers.rightStates).toEqual({
      thinking: testRightArt(FILES.thinking),
      done: testRightArt(FILES.done),
      failed: testRightArt(FILES.failed),
      winter: testRightArt(FILES.winter),
    })
    // The slot files must not steal the portrait or the vision layer.
    expect(layers.rightPortrait).toBe(testRightArt('maid-atelier-maid-right-v7.webp'))
    expect(layers.rightVision).toBe(testRightArt('maid-atelier-maid-right-vision-v1.webp'))
    expect(artworkRightStates().done).toBe(testRightArt(FILES.done))
  })

  it('prefers the listing portrait over the bundled one while a turn runs', async () => {
    vi.useFakeTimers()
    seedTestArtwork(undefined, FILES)
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: true })

    running()
    await settle()
    expect(image.getAttribute('src')).toBe(testRightArt(FILES.thinking))

    document.querySelector('[data-state="running"]')!.remove()
    await settle()
    expect(image.getAttribute('src')).toBe(testRightArt(FILES.done))

    // The held portrait still gives way to the baseline the stage painted.
    await settle(4300)
    expect(image.getAttribute('src')).toBe(BASE)
    dispose()
  })

  it('lets the window override win over the listing', async () => {
    vi.useFakeTimers()
    seedTestArtwork(undefined, FILES)
    window.__dshMaidAtelierArtwork = { thinking: OVERRIDE }
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: true })

    running()
    await settle()
    expect(image.getAttribute('src')).toBe(OVERRIDE)
    dispose()
  })

  it('uses the listing portrait for the winter idle variant', () => {
    seedTestArtwork(undefined, FILES)
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: false, variant: 'winter' })

    expect(image.getAttribute('src')).toBe(testRightArt(FILES.winter))
    dispose()
  })

  it('falls back to the bundled portrait when the listing names no state file', async () => {
    vi.useFakeTimers()
    seedTestArtwork()
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: true })

    running()
    await settle()
    // Nothing in the listing names `think`, so the bundled data URL answers.
    expect(image.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
    dispose()
  })
})
