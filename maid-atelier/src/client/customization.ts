import {
  exposeSkinCustomization,
  SKIN_CUSTOMIZATION_PROTOCOL,
  SkinAttributeProjector,
  type SkinCustomizationState,
} from '../../../skin-manager/src/protocol.ts'
import { installSessionArtwork } from './session-artwork.ts'
import { installLeftArtwork, DEFAULT_LEFT_ARTWORK_VARIANT, LEFT_ARTWORK_SETS } from './left-artwork.ts'
import { MAID_ATELIER_BUILD_ID } from './build-id.generated.ts'

const ATTR_ART = 'data-dsh-whale-maid-art'
const ATTR_FONT = 'data-dsh-whale-maid-font'
const ATTR_MODEL_EXIT = 'data-dsh-whale-maid-model-exit'
const ATTR_MODEL = 'data-dsh-whale-model'
const ATTR_FLASH_GLASSES = 'data-dsh-whale-maid-flash-glasses'
const ATTR_COMPOSER_MODE = 'data-maid-composer-mode'
const ATTR_NAV_MODE = 'data-maid-nav-mode'
/** Navigation layouts the stylesheet implements; anything else falls back to the default. */
const NAV_MODES = new Set(['corner', 'topbar', 'rail'])

/**
 * The lineup is DeepSeek Flash and DeepSeek Pro, so the display name only
 * decides which side the artwork sits on. Both families carry vision now: the
 * glasses artwork is a separate switch (`flashGlasses`) instead of a `vision`
 * substring match, which used to split an older V4 name into a third family.
 */
export function modelFamily(name: string): 'pro' | 'flash' | null {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!compact.includes('deepseek')) return null
  if (compact.includes('pro')) return 'pro'
  if (compact.includes('flash')) return 'flash'
  return null
}

/** Expose controls and keep every resulting DOM mutation skin-owned. */
export function installMaidCustomization(root: HTMLElement = document.documentElement): () => void {
  const projector = new SkinAttributeProjector(root)
  let observer: MutationObserver | undefined
  let frame: number | undefined
  let activeState: SkinCustomizationState | null = null
  let mobile = window.innerWidth <= 700
  /** Live session-state portrait swap; present only while its setting is on. */
  let disposeSessionArtwork: (() => void) | undefined
  /** Live work-state swimsuit swap for the left maid; on unless switched off. */
  let disposeLeftArtwork: (() => void) | undefined

  const synchronizeModel = (): void => {
    let family: ReturnType<typeof modelFamily> = null
    for (const trigger of document.querySelectorAll<HTMLElement>("[data-composer-card] button[aria-haspopup='menu']")) {
      family = modelFamily(`${trigger.title} ${trigger.getAttribute('aria-label') ?? ''} ${trigger.textContent ?? ''}`)
      if (family !== null) break
    }
    if (family === null) projector.unset(ATTR_MODEL)
    else projector.set(ATTR_MODEL, family)
  }

  const scheduleModelSync = (): void => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      synchronizeModel()
    })
  }

  const startModelObserver = (): void => {
    if (observer !== undefined) return
    observer = new MutationObserver(records => {
      if (records.some(record => {
        const element = record.target instanceof Element ? record.target : undefined
        if (record.type === 'childList' && element?.closest('[data-composer-input]')) return false
        if (record.type === 'attributes') return element?.matches("button[aria-haspopup='menu']") === true
        if (element?.closest("[data-composer-card] button[aria-haspopup='menu']")) return true
        return [...record.addedNodes, ...record.removedNodes].some(node => (
          node instanceof Element
          && (node.matches("[data-composer-card], button[aria-haspopup='menu']")
            || node.querySelector("[data-composer-card], button[aria-haspopup='menu']"))
        ))
      })) scheduleModelSync()
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-label', 'title'],
      childList: true,
      subtree: true,
    })
    synchronizeModel()
  }

  const stopModelObserver = (): void => {
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    projector.release(ATTR_MODEL)
  }

  const synchronizeModelMode = (): void => {
    if (activeState === null) return
    const modelExit = mobile
      ? activeState.values.mobileModelExit !== false
      : activeState.values.modelExit === true
    projector.set(ATTR_MODEL_EXIT, modelExit ? 'enabled' : 'disabled')
    if (modelExit) startModelObserver()
    else stopModelObserver()
  }

  const onResize = (): void => {
    const nextMobile = window.innerWidth <= 700
    if (mobile === nextMobile) return
    mobile = nextMobile
    synchronizeModelMode()
  }

  /**
   * Install or retract the session-state portrait swap. Idempotent, so
   * `apply()` can drive it on every settings change without bookkeeping.
   */
  const synchronizeSessionArtwork = (enabled: boolean, variant: unknown): void => {
    if (disposeSessionArtwork !== undefined) {
      disposeSessionArtwork()
      disposeSessionArtwork = undefined
    }
    if (enabled || (typeof variant === 'string' && variant !== 'default')) {
      disposeSessionArtwork = installSessionArtwork({ stateEnabled: enabled, variant })
    }
  }

  /**
   * Install or retract the left maid's work-state sprite swap. Idempotent, so
   * `apply()` can drive it on every settings change without bookkeeping.
   */
  /** Retract the left maid's sprite swap and put back whatever was there. */
  const releaseLeftArtwork = (): void => {
    if (disposeLeftArtwork !== undefined) {
      disposeLeftArtwork()
      disposeLeftArtwork = undefined
    }
  }

  /**
   * Install or retract the left maid's outfit and work-state sprite swap.
   *
   * Always installs, even with the switch off: the switch decides whether she
   * *follows the work state*, not whether she wears the chosen outfit. Gating the
   * whole installation on the switch is what made the outfit dropdown do nothing
   * -- she kept whatever sprite the stage was created with, which read as "the
   * outfit setting is broken". The module handles the switched-off case by
   * painting the chosen outfit's idle sprite and observing nothing.
   */
  const synchronizeLeftArtwork = (enabled: boolean, variant: unknown): void => {
    releaseLeftArtwork()
    disposeLeftArtwork = installLeftArtwork({ enabled, variant })
  }

  const apply = (state: SkinCustomizationState | null): void => {
    if (state === null) {
      window.removeEventListener('resize', onResize)
      activeState = null
      stopModelObserver()
      synchronizeSessionArtwork(false)
      releaseLeftArtwork()
      projector.release()
      return
    }
    if (activeState === null) window.addEventListener('resize', onResize)
    activeState = state
    mobile = window.innerWidth <= 700
    const artwork = state.values.artwork === true
    const scheduleVisible = state.visibility.sfwMode !== false
    projector.set(ATTR_ART, artwork && scheduleVisible ? 'visible' : 'hidden')
    projector.set(ATTR_FONT, state.values.font === 'serif' ? 'serif' : 'system')
    projector.set(ATTR_FLASH_GLASSES, state.values.flashGlasses === true ? 'on' : 'off')
    synchronizeModelMode()
    projector.set(ATTR_COMPOSER_MODE, typeof state.values.composerMode === 'string' ? state.values.composerMode : 'persistent')
    const navMode = state.values.mobileNav
    projector.set(ATTR_NAV_MODE, typeof navMode === 'string' && NAV_MODES.has(navMode) ? navMode : 'corner')
    synchronizeSessionArtwork(state.values.stateArtwork === true, state.values.artworkVariant)
    // The outfits are the left maid's own artwork, so the swap is on unless the
    // manager explicitly stores it off (an older manager has no key at all).
    synchronizeLeftArtwork(state.values.leftStateArtwork !== false, state.values.leftArtworkVariant)
  }

  // Derived rather than hard-coded, so the badge cannot drift from the outfits
  // this bundle actually ships.
  const outfitCount = Object.keys(LEFT_ARTWORK_SETS).length

  return exposeSkinCustomization({
    protocol: SKIN_CUSTOMIZATION_PROTOCOL,
    skinId: 'maid-atelier-wj',
    // The build badge rides the panel heading. A window running an older, still
    // cached revision cannot be told apart from a current one by looking at it —
    // the skin renders fine either way — so both the source id and the number of
    // outfits this build actually carries are shown where a user already looks.
    // An old build reads e.g. "1 套造型" / a stale id; instructions in the README.
    title: `深海女仆工坊 · ${outfitCount} 套造型 · ${MAID_ATELIER_BUILD_ID}`,
    titleEn: `Abyssal Maid Atelier · ${outfitCount} outfits · ${MAID_ATELIER_BUILD_ID}`,
    settings: [
      {
        key: 'artwork',
        type: 'boolean',
        label: '显示双女仆立绘',
        labelEn: 'Show the twin maid artwork',
        defaultValue: true,
      },
      {
        key: 'sfwMode',
        type: 'visibility-schedule',
        label: '不那么二次元模式',
        labelEn: 'Not-so-anime mode',
        description: '按本机时间控制大幅立绘；可设置工作时段隐藏、其他时间显示，也可反向设置。',
        descriptionEn: 'Control the large artwork by local time; hide it during work hours and show it otherwise, or the reverse.',
        defaultValue: { enabled: false, outside: 'visible', ranges: [] },
      },
      {
        key: 'font',
        type: 'select',
        label: '对话区字体',
        labelEn: 'Conversation font',
        defaultValue: 'system',
        options: [
          { value: 'system', label: '系统默认无衬线', labelEn: 'System default sans' },
          { value: 'serif', label: 'Georgia 衬线（#22）', labelEn: 'Georgia serif (#22)' },
        ],
      },
      {
        key: 'modelExit',
        type: 'boolean',
        label: '桌面端根据所选模型显示立绘',
        labelEn: 'Show artwork based on the selected model on desktop',
        defaultValue: false,
      },
      {
        key: 'mobileModelExit',
        type: 'boolean',
        label: '移动端根据所选模型显示立绘',
        labelEn: 'Show artwork based on the selected model on mobile',
        defaultValue: true,
      },
      {
        key: 'flashGlasses',
        type: 'boolean',
        label: 'flash🧐 带眼镜立绘',
        labelEn: 'flash 🧐 glasses artwork',
        description: 'flash 模型改用带眼镜的立绘。',
        descriptionEn: 'Use the glasses artwork for the flash model.',
        defaultValue: false,
        visibleWhen: {
          // The top-level single-key form is what a manager that predates
          // `anyOf` reads; it lands on the mobile switch (on by default), so
          // the control still renders there instead of throwing on an absent
          // `values`.
          key: 'mobileModelExit',
          values: [true],
          anyOf: [
            { key: 'modelExit', values: [true] },
            { key: 'mobileModelExit', values: [true] },
          ],
        },
      },
      {
        key: 'artworkVariant',
        type: 'select',
        label: '右女仆立绘造型',
        labelEn: 'Right maid artwork variant',
        description: '空闲状态下右女仆使用的造型；状态联动开启时，工作中与轮次结束时仍会临时换成对应立绘。',
        descriptionEn: 'Artwork the right maid wears while idle. With the session-state switch on, she still switches to the matching portrait while working and when a turn ends.',
        defaultValue: 'default',
        options: [
          { value: 'default', label: '默认', labelEn: 'Default' },
          { value: 'thinking', label: '思考中', labelEn: 'Thinking' },
          { value: 'done', label: '完成 / 开心', labelEn: 'Delighted' },
          { value: 'failed', label: '出错 / 泄气', labelEn: 'Dejected' },
          { value: 'winter', label: '冬日洋装', labelEn: 'Winter dress' },
        ],
      },
      {
        key: 'leftStateArtwork',
        type: 'boolean',
        label: '左女仆按工作状态切换立绘',
        labelEn: 'Left maid artwork follows the work state',
        description: '左女仆按会话此刻在做什么换姿势与表情：思考、工具执行、回答中、出错。关闭后固定为待机立绘。',
        descriptionEn: 'The left maid changes pose and expression with the work state: thinking, running a tool, answering, or startled after an error. Switched off she keeps the idle sprite.',
        defaultValue: true,
      },
      {
        key: 'leftArtworkVariant',
        type: 'select',
        label: '左女仆造型',
        labelEn: 'Left maid outfit',
        description: '左女仆当前穿的整套造型；每套都带上述五种工作状态立绘。默认冬日洋装（与右女仆同套）。',
        descriptionEn: 'The outfit the left maid wears; every outfit carries the five work-state sprites above. Defaults to the winter dress that matches the right maid.',
        // Same constant the resolver falls back to, so the advertised default and
        // the outfit actually worn for a missing/unknown value cannot drift apart.
        defaultValue: DEFAULT_LEFT_ARTWORK_VARIANT,
        options: [
          { value: 'winter', label: '冬日洋装（与右女仆同套）', labelEn: 'Winter dress (matches the right maid)' },
          { value: 'swimsuit', label: '泳装（分体）', labelEn: 'Swimsuit (two-piece)' },
          { value: 'yukata', label: '浴衣（夏日祭）', labelEn: 'Yukata (summer festival)' },
        ],
      },
      {
        key: 'stateArtwork',
        type: 'boolean',
        label: '按会话状态切换立绘',
        labelEn: 'Switch artwork with session state',
        description: '右女仆在思考或工具运行时换成思考造型，一轮结束换成完成造型，本轮出错或被中断换成泄气造型。三种造型随包内置；也可由 window.__dshMaidAtelierArtwork 覆盖。',
        descriptionEn: 'Swap the right maid for a thinking portrait while she works, a finished one after a turn, and a dejected one when a turn fails or is interrupted. All three portraits ship with the skin, and a host may override them through window.__dshMaidAtelierArtwork.',
        defaultValue: true,
      },
      {
        key: 'mobileNav',
        type: 'select',
        label: '移动端导航方式',
        labelEn: 'Phone navigation layout',
        description: '仅影响竖屏手机（宽度 ≤700px）：左上角品牌图标（默认）、横向顶栏，或宿主原本的纵向侧栏。桌面与横屏不受影响。',
        descriptionEn: 'Portrait phones only (≤700px wide): a brand mark in the top-left corner (default), a horizontal top bar, or the host\u2019s own vertical column. Desktop and landscape are untouched.',
        defaultValue: 'corner',
        options: [
          { value: 'corner', label: '左上角品牌图标', labelEn: 'Brand mark · top-left corner' },
          { value: 'topbar', label: '横向顶栏', labelEn: 'Horizontal top bar' },
          { value: 'rail', label: '纵向侧栏（宿主默认）', labelEn: 'Vertical column (host default)' },
        ],
      },
      {
        key: 'composerMode',
        type: 'select',
        label: '输入框显示方式',
        labelEn: 'Composer visibility mode',
        description: '始终显示；空态胶囊在输入框为空且未聚焦时收起为简约胶囊；滚动显隐在上滚回顾时隐去、下滚渐现。',
        descriptionEn: 'Always visible; the idle capsule collapses to a slim capsule while the composer is empty and unfocused; scroll mode hides it when scrolling up to review and reveals it when scrolling down.',
        defaultValue: 'persistent',
        options: [
          { value: 'persistent', label: '始终显示', labelEn: 'Always visible' },
          { value: 'capsule', label: '空态胶囊（点击展开）', labelEn: 'Idle capsule (click to expand)' },
          { value: 'scroll', label: '上滚隐去 · 下滚渐现', labelEn: 'Hide on scroll up · show on scroll down' },
        ],
      },
    ],
    apply,
  })
}
