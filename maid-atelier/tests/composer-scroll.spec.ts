// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMaidComposerScroll } from '../src/client/composer-scroll.ts'

const SCROLLPORT_HEIGHT = 300
const SCROLLPORT_CONTENT_HEIGHT = 800
const SWITCH = 'data-maid-composer-mode'
const BOTTOM_ONLY = 'data-maid-composer-bottom-only'

interface Fixture {
  root: HTMLElement
  scrollport: HTMLElement
  seat: HTMLElement
  input: HTMLElement
  dispose: () => void
}

function overflowBox(height: number, contentHeight: number): HTMLElement {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  Object.defineProperties(box, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: contentHeight },
  })
  return box
}

function mount(mode: string = 'scroll'): Fixture {
  const root = document.createElement('div')
  root.dataset.phase = 'active'
  const scrollport = document.createElement('div')
  scrollport.dataset.conversationScroll = ''
  const phaseBody = document.createElement('div')
  Object.defineProperties(scrollport, {
    clientHeight: { configurable: true, value: SCROLLPORT_HEIGHT },
    scrollHeight: { configurable: true, value: SCROLLPORT_CONTENT_HEIGHT },
  })
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  const seat = document.createElement('div')
  seat.dataset.composerSeat = ''
  const input = document.createElement('div')
  input.dataset.composerInput = ''
  input.setAttribute('contenteditable', 'true')
  seat.append(input)
  scrollport.append(flow, seat)
  phaseBody.append(scrollport)
  root.append(phaseBody)
  document.body.append(root)
  document.documentElement.setAttribute(SWITCH, mode)
  return { root, scrollport, seat, input, dispose: installMaidComposerScroll(document.body) }
}

/** Seat 内挂一个溢出的草稿滚动盒（宿主 InputBar 的 capped `.scroll`）。 */
function mountWithDraft(mode: string = 'scroll'): Fixture & { draft: HTMLElement } {
  const fixture = mount(mode)
  const draft = overflowBox(300, 700)
  fixture.input.remove()
  draft.append(fixture.input)
  fixture.seat.append(draft)
  return { ...fixture, draft }
}

function scrollTo(scrollport: HTMLElement, top: number): void {
  scrollport.scrollTop = top
  scrollport.dispatchEvent(new Event('scroll'))
}

function wheel(scrollport: HTMLElement, deltaY: number): void {
  scrollport.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
}

function nextMicrotask(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(SWITCH)
  document.documentElement.removeAttribute(BOTTOM_ONLY)
})

afterEach(() => {
  document.documentElement.removeAttribute(SWITCH)
  document.documentElement.removeAttribute(BOTTOM_ONLY)
})

describe('maid composer scroll-intent', () => {
  it('fades the seat out when scrolling up and back in when scrolling down', () => {
    const { scrollport, seat, dispose } = mount()
    scrollTo(scrollport, 400) // baseline
    scrollTo(scrollport, 200) // scroll up past the threshold
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    scrollTo(scrollport, 320) // scroll down past the threshold
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('always shows the seat when reaching the bottom', () => {
    const { scrollport, seat, dispose } = mount()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    scrollTo(scrollport, SCROLLPORT_CONTENT_HEIGHT - SCROLLPORT_HEIGHT - 8) // distanceToBottom <= 24
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('steers by wheel direction and ignores micro-wheel deltas', () => {
    const { scrollport, seat, dispose } = mount()
    wheel(scrollport, -120)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    wheel(scrollport, 120)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    wheel(scrollport, 6)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('stays inert when the switch is off and clears state on flipping it off', async () => {
    const { scrollport, seat, dispose } = mount()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    document.documentElement.setAttribute(SWITCH, 'persistent')
    await nextMicrotask()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    scrollTo(scrollport, 150)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('does not run on a non-scroll mode from the start', () => {
    const { scrollport, seat, dispose } = mount('persistent')
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('focusing the composer brings it back and marks it interactive', async () => {
    const { scrollport, seat, input, dispose } = mount()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    input.focus()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    expect(seat.hasAttribute('data-maid-composer-interactive')).toBe(true)

    input.blur()
    await nextMicrotask()
    expect(seat.hasAttribute('data-maid-composer-interactive')).toBe(false)
    dispose()
  })

  it('ignores scrollports outside an active conversation root', () => {
    const { root, scrollport, seat, dispose } = mount()
    root.dataset.phase = 'hero'
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    root.dataset.phase = 'active'
    root.querySelector('[data-chat-flow]')!.remove()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('dispose removes every owned seat state', () => {
    const { scrollport, seat, dispose } = mount()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    dispose()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    expect(seat.hasAttribute('data-maid-composer-interactive')).toBe(false)
  })

  it('wheeling a long draft at its edge never hides the seat', () => {
    const { scrollport, seat, input, dispose } = mountWithDraft()
    scrollTo(scrollport, 400) // baseline

    // draft scroller at its edge; the host forwards the delta to the transcript
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
    scrollTo(scrollport, 280) // forwarded transcript scroll within the gesture window
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('the draft gesture window also covers touchpad inertia tails', () => {
    const { scrollport, seat, input, dispose } = mountWithDraft()
    scrollTo(scrollport, 400)

    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -6, bubbles: true }))
    scrollTo(scrollport, 280)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('transcript scrolling steers the seat again once the draft gesture window closes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    try {
      const { scrollport, seat, input, dispose } = mountWithDraft()
      scrollTo(scrollport, 400)

      input.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      vi.advanceTimersByTime(250)
      scrollTo(scrollport, 260) // a real upward transcript scroll, no gesture in flight
      expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('wheel on a short draft (no overflow) still steers by direction', () => {
    const { scrollport, seat, input, dispose } = mount()
    scrollTo(scrollport, 400)

    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    input.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('older disposal cannot clear state owned by a repeated activation', () => {
    const { scrollport, seat, dispose: disposeOlder } = mount()
    scrollTo(scrollport, 400)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    const disposeNewer = installMaidComposerScroll(document.body)
    disposeOlder()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    wheel(scrollport, 120)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    disposeNewer()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
  })
})

describe('maid composer bottom-only visibility', () => {
  function backToBottom(): HTMLElement {
    const control = document.createElement('button')
    control.className = 'toBottomButton'
    return control
  }

  it('shows the seat at the tail and hides it while reading back', () => {
    const { scrollport, seat, dispose } = mount('persistent')
    document.documentElement.setAttribute(BOTTOM_ONLY, 'on')

    scrollTo(scrollport, 500) // distance 0: at the tail
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    // The host renders its back-to-bottom control only after leaving the tail.
    const control = backToBottom()
    scrollport.append(control)
    scrollTo(scrollport, 300)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)

    control.remove()
    scrollTo(scrollport, 500)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('hides as soon as the back-to-bottom control is committed, without a scroll', async () => {
    const { scrollport, seat, dispose } = mount('persistent')
    document.documentElement.setAttribute(BOTTOM_ONLY, 'on')
    scrollTo(scrollport, 400)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    scrollport.append(backToBottom())
    await nextMicrotask()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)
    dispose()
  })

  it('takes over the scroll mode: direction stops driving the seat', () => {
    const { scrollport, seat, dispose } = mount('scroll')
    document.documentElement.setAttribute(BOTTOM_ONLY, 'on')
    scrollTo(scrollport, 300)
    scrollTo(scrollport, 200) // scroll mode would hide on this upward move
    // No back-to-bottom control, so the host still considers this the tail.
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
    dispose()
  })

  it('returns to the scroll mode once the switch is turned off', async () => {
    const { scrollport, seat, dispose } = mount('scroll')
    document.documentElement.setAttribute(BOTTOM_ONLY, 'on')
    scrollTo(scrollport, 300)
    scrollTo(scrollport, 200)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)

    document.documentElement.setAttribute(BOTTOM_ONLY, 'off')
    await nextMicrotask()
    scrollTo(scrollport, 150)
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(true)
    dispose()
  })

  it('dispose releases the back-to-bottom observers', async () => {
    const { scrollport, seat, dispose } = mount('persistent')
    document.documentElement.setAttribute(BOTTOM_ONLY, 'on')
    scrollTo(scrollport, 400)
    dispose()

    scrollport.append(backToBottom())
    await nextMicrotask()
    expect(seat.hasAttribute('data-maid-composer-hidden')).toBe(false)
  })
})
