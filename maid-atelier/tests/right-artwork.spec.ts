// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RIGHT_THEME,
  artworkLayers,
  artworkRightStates,
  onArtworkChange,
  rightTheme,
  rightThemes,
  seedArtwork,
  setRightTheme,
} from '../src/client/artwork-source.ts'
import { leftArtworkVariants, rebuildLeftArtwork } from '../src/client/left-artwork.ts'
import { installSessionArtwork } from '../src/client/session-artwork.ts'
import { COMMITTED_OUTFITS, seedTestArtwork, testRightArt } from './artwork-fixture.ts'

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
  setRightTheme(DEFAULT_RIGHT_THEME)
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

    // The held portrait gives way to the theme's own base portrait.
    await settle(4300)
    expect(image.getAttribute('src')).toBe(testRightArt('maid-atelier-maid-right-v7.webp'))
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

  it('leaves the theme base portrait alone when no expression file matches', async () => {
    vi.useFakeTimers()
    seedTestArtwork()
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: true })

    running()
    await settle()
    // Nothing in the listing names `think`, so she keeps the theme's base portrait
    // rather than blanking the node.
    expect(image.getAttribute('src')).toBe(testRightArt('maid-atelier-maid-right-v7.webp'))
    dispose()
  })
})

describe('right-maid themes', () => {
  /** Two theme folders, the second one deliberately partial. */
  const THEMES = {
    和服: FILES,
    泳装: { thinking: 'think-b.webp', failed: 'failed-b.webp' },
  }

  it('lists the flat default first and every theme folder after it', () => {
    seedTestArtwork(undefined, {}, THEMES)
    expect(rightThemes()).toEqual([DEFAULT_RIGHT_THEME, '和服', '泳装'])
  })

  it('resolves against the selected theme and falls back to default for an unknown one', () => {
    seedTestArtwork(undefined, {}, THEMES)

    setRightTheme('和服')
    expect(rightTheme()).toBe('和服')
    expect(artworkRightStates().thinking).toBe(testRightArt(FILES.thinking, '和服'))

    setRightTheme('nope')
    // The value is kept as the manager stored it...
    expect(rightTheme()).toBe('nope')
    // ...but a folder the listing does not carry resolves against `default`,
    // which in this listing ships no expression of its own.
    expect(artworkRightStates().thinking).toBeUndefined()
  })

  it('notifies subscribers on a real switch only', () => {
    seedTestArtwork(undefined, {}, THEMES)
    const seen = vi.fn()
    const off = onArtworkChange(seen)

    setRightTheme(DEFAULT_RIGHT_THEME)
    expect(seen).not.toHaveBeenCalled()

    setRightTheme('泳装')
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })

  it('uses the active theme expression while a turn runs', async () => {
    vi.useFakeTimers()
    seedTestArtwork(undefined, {}, THEMES)
    setRightTheme('和服')
    const image = stage()
    const dispose = installSessionArtwork({ stateEnabled: true })

    running()
    await settle()
    expect(image.getAttribute('src')).toBe(testRightArt(FILES.thinking, '和服'))
    dispose()
  })

  it('keeps theme folders out of the left outfit dropdown', () => {
    seedTestArtwork(undefined, {}, THEMES)
    rebuildLeftArtwork()
    expect(leftArtworkVariants()).toEqual([...COMMITTED_OUTFITS])
  })
})
