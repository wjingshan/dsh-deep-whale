// @vitest-environment jsdom
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeSkinSourceId } from '../../scripts/write-skin-build-id.mjs'
import {
  SKIN_CUSTOMIZATION_REGISTER_EVENT,
  type SkinCustomizationRegistration,
} from '../../skin-manager/src/protocol.ts'
import { installMaidCustomization } from '../src/client/customization.ts'
import { MAID_ATELIER_BUILD_ID } from '../src/client/build-id.generated.ts'
import { LEFT_ARTWORK_SETS } from '../src/client/left-artwork.ts'

const SKIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The badge in the settings panel is only worth having if it tells the truth.
 *
 * The skin ships the versioned bundle and commits `lib/`, so "src edited but the
 * bundle not rebuilt" is a real and otherwise invisible state: the panel would
 * advertise sources that are not the ones running. Recomputing the id here turns
 * that into a failing test instead.
 *
 * If this fails after an intentional `src/**` edit, rebuild — do not edit the
 * generated constant.
 */
describe('maid build id', () => {
  it('matches a fresh hash of src/**, so the panel cannot advertise wrong sources', () => {
    expect(computeSkinSourceId(SKIN_ROOT)).toBe(MAID_ATELIER_BUILD_ID)
  })

  it('is a short lowercase hex id', () => {
    expect(MAID_ATELIER_BUILD_ID).toMatch(/^[0-9a-f]{12}$/)
  })

  it('is shown in the settings panel heading together with the shipped outfit count', () => {
    let registration: SkinCustomizationRegistration | undefined
    const receive = (event: Event) => {
      registration = (event as CustomEvent<SkinCustomizationRegistration>).detail
    }
    window.addEventListener(SKIN_CUSTOMIZATION_REGISTER_EVENT, receive)
    const dispose = installMaidCustomization()
    const definition = registration!.definition
    const outfits = Object.keys(LEFT_ARTWORK_SETS).length
    for (const title of [definition.title, definition.titleEn]) {
      expect(title).toContain(MAID_ATELIER_BUILD_ID)
      expect(title).toContain(String(outfits))
    }
    dispose()
    window.removeEventListener(SKIN_CUSTOMIZATION_REGISTER_EVENT, receive)
  })
})
