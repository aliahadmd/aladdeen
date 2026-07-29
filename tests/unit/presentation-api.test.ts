import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PptxElement, PptxSlide, PptxViewerInstance } from 'pptx-vanilla-viewer'
import { ViewerPresentationDocumentApi } from '@renderer/document-adapters/presentation-api'
import {
  cleanupDocumentRuntime,
  getDocumentTransactions
} from '@renderer/document-adapters/runtime'

const fileIds: string[] = []

afterEach(() => {
  fileIds.splice(0).forEach(cleanupDocumentRuntime)
})

function createHarness(canMutate = true): {
  api: ViewerPresentationDocumentApi
  dirty: ReturnType<typeof vi.fn>
  slides: PptxSlide[]
  viewer: PptxViewerInstance
} {
  const fileId = crypto.randomUUID()
  fileIds.push(fileId)
  const elements = [{
    id: 'element-1',
    shapeId: '7',
    type: 'text',
    name: 'Title 1',
    text: 'Alpha alpha',
    x: 10,
    y: 20,
    width: 300,
    height: 80,
    hidden: false
  }] as unknown as PptxElement[]
  const slides = [{
    id: 'slide-1',
    slideNumber: 1,
    hidden: false,
    elements,
    notes: 'Speaker note'
  }] as unknown as PptxSlide[]
  let currentSlide = 0
  const viewer = {
    getSlides: () => slides,
    getSlideCount: () => slides.length,
    getSlide: (index: number) => slides[index],
    getElements: (index: number) => slides[index]?.elements ?? [],
    getCurrentSlide: () => currentSlide,
    goToSlide: vi.fn((index: number) => { currentSlide = index }),
    getElementById: (id: string, index: number) => slides[index]?.elements.find((element) => element.id === id),
    updateElement: vi.fn((id: string, patch: Partial<PptxElement>) => {
      const element = slides[currentSlide]?.elements.find((candidate) => candidate.id === id)
      if (element) Object.assign(element, patch)
    }),
    addSlide: vi.fn(),
    duplicateSlides: vi.fn(),
    deleteSlides: vi.fn(),
    moveSlide: vi.fn(),
    selectElements: vi.fn(),
    enterPresentation: vi.fn(async () => undefined),
    exitPresentation: vi.fn(async () => undefined)
  } as unknown as PptxViewerInstance
  const dirty = vi.fn()
  return {
    api: new ViewerPresentationDocumentApi(viewer, fileId, () => 'base-revision', dirty, () => canMutate),
    dirty,
    slides,
    viewer
  }
}

describe('engine-neutral presentation document API', () => {
  it('returns JSON-safe slide, element, and search records', () => {
    const { api } = createHarness()
    expect(api.listSlides()).toEqual([{
      id: 'slide-1',
      slideNumber: 1,
      hidden: false,
      elementCount: 1
    }])
    expect(api.getElements(0)).toEqual([expect.objectContaining({
      id: 'element-1',
      shapeId: '7',
      name: 'Title 1',
      text: 'Alpha alpha'
    })])
    expect(api.extractSearchEntries()).toEqual([
      expect.objectContaining({ slideNumber: 1, elementId: 'element-1', source: 'slide', text: 'Alpha alpha' }),
      expect.objectContaining({ slideNumber: 1, source: 'notes', text: 'Speaker note' })
    ])
    expect(api.findElementForLocator(0, '7')?.id).toBe('element-1')
  })

  it('records validated agent mutations but ignores a no-op replacement', () => {
    const { api, dirty, slides } = createHarness()
    expect(api.replaceText('missing', 'unused')).toBe(0)
    expect(dirty).not.toHaveBeenCalled()
    expect(getDocumentTransactions(fileIds[0]!)).toHaveLength(0)

    expect(api.replaceText('alpha', 'Beta')).toBe(2)
    expect((slides[0]!.elements[0] as { text: string }).text).toBe('Beta Beta')
    expect(dirty).toHaveBeenCalledTimes(1)
    expect(getDocumentTransactions(fileIds[0]!)).toEqual([
      expect.objectContaining({ actor: 'agent', documentKind: 'pptx', undoGroup: 'replace-text:alpha' })
    ])
  })

  it('restores navigation after a failed update and rejects read-only mutation', () => {
    const mutable = createHarness()
    expect(() => mutable.api.updateElement(0, 'missing', { text: 'No' })).toThrow(/does not exist/i)
    expect(mutable.viewer.goToSlide).toHaveBeenLastCalledWith(0)
    expect(mutable.dirty).not.toHaveBeenCalled()

    const readOnly = createHarness(false)
    expect(() => readOnly.api.updateElement(0, 'element-1', { text: 'No' })).toThrow(/read-only/i)
    expect(readOnly.dirty).not.toHaveBeenCalled()
  })
})
