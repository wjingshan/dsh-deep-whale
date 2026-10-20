import {
  exposeSkinCustomization,
  SKIN_CUSTOMIZATION_PROTOCOL,
  SkinAttributeProjector,
  type SkinCustomizationState,
} from '../../../skin-manager/src/protocol.ts'
import { installSessionArtwork } from './session-artwork.ts'
import { installLeftArtwork, DEFAULT_LEFT_ARTWORK_VARIANT, leftArtworkVariants, rebuildLeftArtwork } from './left-artwork.ts'
import { DEFAULT_RIGHT_THEME, onArtworkChange, rightThemes, setRightTheme } from './artwork-source.ts'
import { MAID_ATELIER_BUILD_ID } from './build-id.generated.ts'

const ATTR_ART = 'data-dsh-whale-maid-art'
const ATTR_FONT = 'data-dsh-whale-maid-font'
const ATTR_WORKSPACE_FONT = 'data-dsh-whale-maid-workspace-font'
const ATTR_MODEL_EXIT = 'data-dsh-whale-maid-model-exit'
const ATTR_MODEL = 'data-dsh-whale-model'
const ATTR_FLASH_GLASSES = 'data-dsh-whale-maid-flash-glasses'
const ATTR_COMPOSER_MODE = 'data-maid-composer-mode'
const ATTR_NAV_MODE = 'data-maid-nav-mode'
/** Navigation layouts the stylesheet implements; anything else falls back to the default. */
const NAV_MODES = new Set(['corner', 'topbar', 'rail'])

/**
 * Workspace typography choices. `serif` is the skin's own sidebar stack (the
 * stylesheet default), `system` takes the host family, and `conversation` mirrors
 * the conversation font switch so both surfaces move together. Anything else
 * falls back to the serif default.
 */
const WORKSPACE_FONTS = new Set(['serif', 'system', 'conversation'])

/**
 * Workspace row height control. The 22px default is also the stylesheet's
 * `--maid-workspace-row-height` fallback, so a skin without a manager renders
 * the compact row; the range starts there because the title's own line box sets
 * the floor.
 */
const WORKSPACE_ROW_HEIGHT_DEFAULT = 22
const WORKSPACE_ROW_HEIGHT_MIN = 22
const WORKSPACE_ROW_HEIGHT_MAX = 44
const WORKSPACE_ROW_HEIGHT_PROPERTY = '--maid-workspace-row-height'

/**
 * Style-property twin of {@link SkinAttributeProjector}: a length control cannot
 * ride an attribute — the stylesheet would need one rule per pixel value — so the
 * owned custom property is written inline on the same root and released only
 * while it still holds the value this writer set.
 */
class SkinPropertyProjector {
  private readonly originals = new Map<string, string>()
  private readonly owned = new Map<string, string>()

  constructor(private readonly root: HTMLElement = document.documentElement) {}

  set(name: string, value: string): void {
    if (!this.originals.has(name)) this.originals.set(name, this.root.style.getPropertyValue(name))
    this.root.style.setProperty(name, value)
    this.owned.set(name, value)
  }

  release(): void {
    for (const [name, original] of [...this.originals]) {
      if (this.root.style.getPropertyValue(name) === this.owned.get(name)) {
        if (original === '') this.root.style.removeProperty(name)
        else this.root.style.setProperty(name, original)
      }
      this.originals.delete(name)
      this.owned.delete(name)
    }
  }
}

/**
 * Normalize the row height: a manager that predates the control, a missing value
 * or a forged one all mean the skin default, and the result is rounded so the
 * written length never carries sub-pixel noise.
 */
function workspaceRowHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WORKSPACE_ROW_HEIGHT_DEFAULT
  return Math.min(WORKSPACE_ROW_HEIGHT_MAX, Math.max(WORKSPACE_ROW_HEIGHT_MIN, Math.round(value)))
}

/**
 * Percent of the stage's own opacity while a non-conversation main panel owns
 * the column. The chat keeps the artwork at full strength; a panel page shows it
 * only as far as this value allows. The stylesheet reads the same variable and
 * carries the same fallback, so a window whose manager never applies a value
 * still renders the documented default.
 */
const PANEL_BACKDROP_VAR = '--maid-panel-backdrop'
const PANEL_BACKDROP_DEFAULT = 12
const PANEL_BACKDROP_MAX = 60

/**
 * Percent of the character stage's height each maid draws at, riding a custom
 * property per side so the slider rescales a portrait without repainting the
 * stage. The stylesheet multiplies its own baseline percentages by these, and
 * carries the same `100` fallback, so a window whose manager never applies a
 * value still renders the documented size.
 *
 * The range is deliberately asymmetric: shrinking is always safe, while past
 * 100% the figure grows upward into the stage's `overflow: hidden` and its head
 * gets clipped by the top of the conversation column.
 */
const LEFT_SCALE_VAR = '--maid-left-scale'
const RIGHT_SCALE_VAR = '--maid-right-scale'
const SCALE_DEFAULT = 100
const SCALE_MIN = 40
const SCALE_MAX = 150
const SCALE_STEP = 5

/**
 * Display names for the outfits that ship with the skin.
 *
 * An outfit the host discovers but this table does not know shows its folder
 * name instead. That fallback is the point: adding an outfit is adding a folder,
 * so a missing display name must never be able to hide it from the dropdown.
 */
const OUTFIT_LABELS: Record<string, { label: string; labelEn: string }> = {
  winter: { label: '冬日洋装（与右女仆同套）', labelEn: 'Winter dress (matches the right maid)' },
  swimsuit: { label: '泳装（分体）', labelEn: 'Swimsuit (two-piece)' },
  yukata: { label: '浴衣（夏日祭）', labelEn: 'Yukata (summer festival)' },
  maid: { label: '女仆装', labelEn: 'Maid dress' },
}

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
  const properties = new SkinPropertyProjector(root)
  let observer: MutationObserver | undefined
  let frame: number | undefined
  let activeState: SkinCustomizationState | null = null
  let mobile = window.innerWidth <= 700
  /** Live session-state portrait swap; present only while its setting is on. */
  let disposeSessionArtwork: (() => void) | undefined
  /** Live work-state swimsuit swap for the left maid; on unless switched off. */
  let disposeLeftArtwork: (() => void) | undefined

  /**
   * Publish the panel-backdrop strength as a CSS variable.
   *
   * The projector owns attributes only, and a continuous percentage cannot be
   * expressed as one, so this value rides a custom property on the same root
   * element instead. It is written here and removed on release, so a hot switch
   * cannot leave a stale value behind and no other activation's value is
   * touched.
   */
  const applyPanelBackdrop = (value: unknown): void => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : PANEL_BACKDROP_DEFAULT
    const clamped = Math.min(PANEL_BACKDROP_MAX, Math.max(0, numeric))
    root.style.setProperty(PANEL_BACKDROP_VAR, String(clamped))
  }

  const releasePanelBackdrop = (): void => {
    root.style.removeProperty(PANEL_BACKDROP_VAR)
  }

  /**
   * Publish one maid's size multiplier as a CSS variable.
   *
   * Same mechanism as the panel backdrop: the projector only speaks attributes,
   * and a continuous percentage is not one. Every write is paired with the
   * release below, so a hot switch cannot strand a value from an earlier
   * activation on the root element.
   * @param variable - custom property owning that side's baseline.
   * @param value - stored percentage; anything unusable means the default.
   */
  const applyMaidScale = (variable: string, value: unknown): void => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : SCALE_DEFAULT
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, numeric))
    root.style.setProperty(variable, String(clamped))
  }

  const releaseMaidScales = (): void => {
    root.style.removeProperty(LEFT_SCALE_VAR)
    root.style.removeProperty(RIGHT_SCALE_VAR)
  }

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
      releasePanelBackdrop()
      releaseMaidScales()
      projector.release()
      properties.release()
      return
    }
    if (activeState === null) window.addEventListener('resize', onResize)
    activeState = state
    mobile = window.innerWidth <= 700
    const artwork = state.values.artwork === true
    const scheduleVisible = state.visibility.sfwMode !== false
    projector.set(ATTR_ART, artwork && scheduleVisible ? 'visible' : 'hidden')
    projector.set(ATTR_FONT, state.values.font === 'serif' ? 'serif' : 'system')
    const workspaceFont = state.values.workspaceFont
    projector.set(
      ATTR_WORKSPACE_FONT,
      typeof workspaceFont === 'string' && WORKSPACE_FONTS.has(workspaceFont) ? workspaceFont : 'serif',
    )
    properties.set(
      WORKSPACE_ROW_HEIGHT_PROPERTY,
      `${workspaceRowHeight(state.values.workspaceRowHeight)}px`,
    )
    projector.set(ATTR_FLASH_GLASSES, state.values.flashGlasses === true ? 'on' : 'off')
    synchronizeModelMode()
    projector.set(ATTR_COMPOSER_MODE, typeof state.values.composerMode === 'string' ? state.values.composerMode : 'persistent')
    const navMode = state.values.mobileNav
    projector.set(ATTR_NAV_MODE, typeof navMode === 'string' && NAV_MODES.has(navMode) ? navMode : 'corner')
    // A theme switch repaints the base and vision portraits (the setter notifies
    // the stage), so it has to land before the session module installs on top.
    setRightTheme(state.values.rightTheme)
    synchronizeSessionArtwork(state.values.stateArtwork === true, state.values.artworkVariant)
    // The outfits are the left maid's own artwork, so the swap is on unless the
    // manager explicitly stores it off (an older manager has no key at all).
    synchronizeLeftArtwork(state.values.leftStateArtwork !== false, state.values.leftArtworkVariant)
    applyPanelBackdrop(state.values.panelBackdrop)
    applyMaidScale(LEFT_SCALE_VAR, state.values.leftMaidScale)
    applyMaidScale(RIGHT_SCALE_VAR, state.values.rightMaidScale)
  }

  /**
   * The outfit choices are part of the declaration the manager renders, so they
   * are rebuilt from the listing on every registration rather than being a
   * hard-coded three. The object is mutated in place so the declaration below can
   * keep referencing it while a re-registration picks up the new options.
   */
  const outfitSetting = {
    key: 'leftArtworkVariant',
    type: 'select' as const,
    label: '左女仆造型',
    labelEn: 'Left maid outfit',
    description: '左女仆当前穿的整套造型；每套都带上述五种工作状态立绘。默认冬日洋装（与右女仆同套）。',
    descriptionEn: 'The outfit the left maid wears; every outfit carries the five work-state sprites above. Defaults to the winter dress that matches the right maid.',
    // Same constant the resolver falls back to, so the advertised default and
    // the outfit actually worn for a missing/unknown value cannot drift apart.
    defaultValue: DEFAULT_LEFT_ARTWORK_VARIANT,
    options: [] as { value: string; label: string; labelEn: string }[],
  }

  /**
   * The right maid's theme choices, rebuilt from the listing for the same reason
   * the outfit choices are: a folder is a theme, so the dropdown has to follow
   * what is on disk instead of a list baked into this file.
   */
  const themeSetting = {
    key: 'rightTheme',
    type: 'select' as const,
    label: '右女仆主题',
    labelEn: 'Right maid theme',
    description:
      '右女仆整套立绘（基准图与各状态表情）取自 assets/maid-right/ 下的哪个文件夹；「默认」用平铺在 maid-right/ 里的那几张。',
    descriptionEn:
      'Which folder under assets/maid-right/ supplies the right maid: the base portrait plus her per-state expressions. Default uses the files sitting flat in maid-right/.',
    defaultValue: DEFAULT_RIGHT_THEME,
    options: [] as { value: string; label: string; labelEn: string }[],
  }

  const declaration: Parameters<typeof exposeSkinCustomization>[0] = {
    protocol: SKIN_CUSTOMIZATION_PROTOCOL,
    skinId: 'maid-atelier-wj',
    // The build badge rides the panel heading. A window running an older, still
    // cached revision cannot be told apart from a current one by looking at it —
    // the skin renders fine either way — so both the source id and the number of
    // outfits this build actually carries are shown where a user already looks.
    // An old build reads e.g. "1 套造型" / a stale id; instructions in the README.
    // Replaced by `refreshDeclaration` from the live listing before the first
    // registration, so the count in the badge is the number of outfits the host
    // actually published rather than a number baked into this source file.
    title: '',
    titleEn: '',
    settings: [
      {
        key: 'artwork',
        type: 'boolean',
        label: '显示双女仆立绘',
        labelEn: 'Show the twin maid artwork',
        defaultValue: true,
      },
      {
        key: 'leftMaidScale',
        type: 'range',
        label: '左女仆大小',
        labelEn: 'Left maid size',
        description: '左女仆立绘相对对话区高度的大小。100 = 原始大小；调小可让出更多对话空间。超过 100 时她向上长出对话区，头顶会被上沿裁掉。',
        descriptionEn: 'How tall the left maid draws against the conversation column. 100 is the original size; smaller values free up chat space. Past 100 she grows upward past the column and her head is clipped by its top edge.',
        defaultValue: SCALE_DEFAULT,
        min: SCALE_MIN,
        max: SCALE_MAX,
        step: SCALE_STEP,
        unit: '%',
      },
      {
        key: 'rightMaidScale',
        type: 'range',
        label: '右女仆大小',
        labelEn: 'Right maid size',
        description: '右女仆立绘相对对话区高度的大小。100 = 原始大小；只改高度，宽度按图片自身宽高比跟随，所以各状态立绘观感一致。超过 100 时头顶会被对话区上沿裁掉。',
        descriptionEn: 'How tall the right maid draws against the conversation column. 100 is the original size; only the height is scaled, so the width follows each portrait\u2019s own aspect ratio. Past 100 her head is clipped by the column\u2019s top edge.',
        defaultValue: SCALE_DEFAULT,
        min: SCALE_MIN,
        max: SCALE_MAX,
        step: SCALE_STEP,
        unit: '%',
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
        key: 'workspaceFont',
        type: 'select',
        label: '工作区字体',
        labelEn: 'Workspace font',
        description: '左侧栏工作区与会话列表的字体；可跟随上面的对话区字体设置。',
        descriptionEn: 'Typeface of the sidebar Workspace and Session lists; can follow the conversation font setting above.',
        defaultValue: 'serif',
        options: [
          { value: 'serif', label: 'Georgia 衬线（皮肤默认）', labelEn: 'Georgia serif (skin default)' },
          { value: 'system', label: '系统默认无衬线', labelEn: 'System default sans' },
          { value: 'conversation', label: '跟随对话区字体', labelEn: 'Follow the conversation font' },
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
      themeSetting,
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
      outfitSetting,
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
        key: 'workspaceRowHeight',
        type: 'range',
        label: '工作区条目行高',
        labelEn: 'Workspace row height',
        description: '左侧栏「工作区」分组条目的高度，单位像素；文件夹徽章与当前工作区的缎带按同一比例缩放。',
        descriptionEn: 'Height of the sidebar Workspace group row in pixels; the folder crest and the active Workspace ribbon scale with it.',
        defaultValue: WORKSPACE_ROW_HEIGHT_DEFAULT,
        min: WORKSPACE_ROW_HEIGHT_MIN,
        max: WORKSPACE_ROW_HEIGHT_MAX,
        step: 1,
        unit: 'px',
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
      {
        key: 'panelBackdrop',
        type: 'range',
        label: '插件 / 自动化页的背景浓淡',
        labelEn: 'Backdrop strength on panel pages',
        description: '非会话页面（插件、自动化任务等）背后宫殿与立绘的可见度。0 = 完全看不见，数字越大越明显；聊天区不受影响。',
        descriptionEn: 'How visible the palace and the maids are behind a non-conversation page (Plugins, Automations, \u2026). 0 hides them completely; higher values show more. The chat column is never affected.',
        defaultValue: PANEL_BACKDROP_DEFAULT,
        min: 0,
        max: PANEL_BACKDROP_MAX,
        step: 1,
        unit: '%',
      },
    ],
    apply,
  }

  /** Re-read the listing into the declaration the manager will render. */
  const refreshDeclaration = (): boolean => {
    const changed = rebuildLeftArtwork()
    const ids = leftArtworkVariants()
    // Lead with the declared default, as this dropdown always has: the outfit a
    // user gets without choosing anything should be the first one they read.
    const ordered = [
      ...ids.filter((id) => id === DEFAULT_LEFT_ARTWORK_VARIANT),
      ...ids.filter((id) => id !== DEFAULT_LEFT_ARTWORK_VARIANT),
    ]
    outfitSetting.options = ordered.map((id) => ({
      value: id,
      label: OUTFIT_LABELS[id]?.label ?? id,
      labelEn: OUTFIT_LABELS[id]?.labelEn ?? id,
    }))
    themeSetting.options = rightThemes().map((id) => ({
      value: id,
      label: id === DEFAULT_RIGHT_THEME ? '默认（平铺文件）' : id,
      labelEn: id === DEFAULT_RIGHT_THEME ? 'Default (flat files)' : id,
    }))
    const count = outfitSetting.options.length
    declaration.title = `深海女仆工坊 · ${count} 套造型 · ${MAID_ATELIER_BUILD_ID}`
    declaration.titleEn = `Abyssal Maid Atelier · ${count} outfits · ${MAID_ATELIER_BUILD_ID}`
    return changed
  }

  refreshDeclaration()
  let disposeRegistration = exposeSkinCustomization(declaration)

  // An outfit added while the window is open has to reach the panel, and the
  // panel renders whichever declaration it was registered with -- so a changed
  // listing means a fresh registration. This is the only lever the protocol
  // offers: it has a register/unregister handshake but no "panel opened" event,
  // and the panel belongs to the manager, so there is nothing stable to observe.
  const unwatchArtwork = onArtworkChange(() => {
    if (!refreshDeclaration()) return
    disposeRegistration()
    disposeRegistration = exposeSkinCustomization(declaration)
  })

  return () => {
    unwatchArtwork()
    disposeRegistration()
  }
}
