import type {
  PptxElement,
  PptxSlide,
  PptxViewerInstance
} from 'pptx-vanilla-viewer'
import type { DocumentActor, PresentationSearchEntry } from '@shared/contracts'
import { recordDocumentTransaction } from './runtime'

export interface PresentationSlideSummary {
  id: string
  name?: string
  slideNumber: number
  hidden: boolean
  elementCount: number
}

export interface PresentationElementSummary {
  id: string
  shapeId?: string
  type: string
  name?: string
  text?: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  hidden: boolean
}

export interface PresentationElementPatch {
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  hidden?: boolean
  text?: string
}

export interface PresentationDocumentApi {
  listSlides(): PresentationSlideSummary[]
  getSlide(slideIndex: number): PresentationSlideSummary
  getElements(slideIndex: number): PresentationElementSummary[]
  addSlide(afterIndex?: number, actor?: DocumentActor): PresentationSlideSummary
  duplicateSlides(indexes: number[], actor?: DocumentActor): void
  deleteSlides(indexes: number[], actor?: DocumentActor): void
  moveSlide(fromIndex: number, toIndex: number, actor?: DocumentActor): void
  updateElement(slideIndex: number, elementId: string, patch: PresentationElementPatch, actor?: DocumentActor): void
  replaceText(search: string, replacement: string, matchCase?: boolean, actor?: DocumentActor): number
  goToSlide(slideIndex: number): void
  selectElements(slideIndex: number, elementIds: string[]): void
  enterPresentation(): Promise<void>
  exitPresentation(): Promise<void>
}

export class ViewerPresentationDocumentApi implements PresentationDocumentApi {
  private internalMutationDepth = 0

  constructor(
    private readonly viewer: PptxViewerInstance,
    private readonly fileId: string,
    private readonly baseRevision: () => string,
    private readonly onMutation: () => void,
    private readonly canMutate: () => boolean = () => true
  ) {}

  listSlides(): PresentationSlideSummary[] {
    return this.viewer.getSlides().map(slideSummary)
  }

  getSlide(slideIndex: number): PresentationSlideSummary {
    return slideSummary(this.slide(slideIndex))
  }

  getElements(slideIndex: number): PresentationElementSummary[] {
    this.slide(slideIndex)
    return this.viewer.getElements(slideIndex).map(elementSummary)
  }

  addSlide(afterIndex?: number, actor: DocumentActor = 'agent'): PresentationSlideSummary {
    const previousCount = this.viewer.getSlideCount()
    const normalized = afterIndex === undefined ? undefined : assertSlideIndex(afterIndex, previousCount)
    this.mutate(actor, 'add-slide', () => this.viewer.addSlide(normalized))
    const createdIndex = normalized === undefined ? previousCount : Math.min(normalized + 1, previousCount)
    return this.getSlide(createdIndex)
  }

  duplicateSlides(indexes: number[], actor: DocumentActor = 'agent'): void {
    const normalized = assertSlideIndexes(indexes, this.viewer.getSlideCount())
    this.mutate(actor, `duplicate-slides:${normalized.join(',')}`, () => this.viewer.duplicateSlides(normalized))
  }

  deleteSlides(indexes: number[], actor: DocumentActor = 'agent'): void {
    const normalized = assertSlideIndexes(indexes, this.viewer.getSlideCount())
    if (normalized.length >= this.viewer.getSlideCount()) {
      throw new Error('A presentation must contain at least one slide.')
    }
    this.mutate(actor, `delete-slides:${normalized.join(',')}`, () => this.viewer.deleteSlides(normalized))
  }

  moveSlide(fromIndex: number, toIndex: number, actor: DocumentActor = 'agent'): void {
    const count = this.viewer.getSlideCount()
    const from = assertSlideIndex(fromIndex, count)
    const to = assertSlideIndex(toIndex, count)
    this.mutate(actor, `move-slide:${from}:${to}`, () => this.viewer.moveSlide(from, to))
  }

  updateElement(
    slideIndex: number,
    elementId: string,
    patch: PresentationElementPatch,
    actor: DocumentActor = 'agent'
  ): void {
    const index = assertSlideIndex(slideIndex, this.viewer.getSlideCount())
    const id = assertElementId(elementId)
    const updates = assertElementPatch(patch)
    const priorSlide = this.viewer.getCurrentSlide()
    this.mutate(actor, `update-element:${index}:${id}`, () => {
      try {
        this.viewer.goToSlide(index)
        if (!this.viewer.getElementById(id, index)) throw new Error(`Element “${id}” does not exist on slide ${index + 1}.`)
        this.viewer.updateElement(id, updates as Partial<PptxElement>)
      } finally {
        if (priorSlide !== index) this.viewer.goToSlide(priorSlide)
      }
    })
  }

  replaceText(
    search: string,
    replacement: string,
    matchCase = false,
    actor: DocumentActor = 'agent'
  ): number {
    const needle = assertText(search, 'Search text', 500)
    const next = assertText(replacement, 'Replacement text', 32_768, true)
    const expression = new RegExp(escapeRegex(needle), matchCase ? 'g' : 'gi')
    const priorSlide = this.viewer.getCurrentSlide()
    let replacements = 0
    const updates: Array<{ slideIndex: number, elementId: string, text: string }> = []
    this.viewer.getSlides().forEach((slide, slideIndex) => {
      for (const element of slide.elements) {
        if (!('text' in element) || typeof element.text !== 'string') continue
        const replaced = element.text.replace(expression, () => {
          replacements += 1
          return next
        })
        if (replaced !== element.text) updates.push({ slideIndex, elementId: element.id, text: replaced })
      }
    })
    if (updates.length === 0) return 0
    this.mutate(actor, `replace-text:${needle}`, () => {
      try {
        for (const update of updates) {
          this.viewer.goToSlide(update.slideIndex)
          this.viewer.updateElement(update.elementId, { text: update.text } as Partial<PptxElement>)
        }
      } finally {
        this.viewer.goToSlide(priorSlide)
      }
    })
    return replacements
  }

  goToSlide(slideIndex: number): void {
    this.viewer.goToSlide(assertSlideIndex(slideIndex, this.viewer.getSlideCount()))
  }

  selectElements(slideIndex: number, elementIds: string[]): void {
    const index = assertSlideIndex(slideIndex, this.viewer.getSlideCount())
    const ids = [...new Set(elementIds.map(assertElementId))]
    const known = new Set(this.viewer.getElements(index).map((element) => element.id))
    if (ids.some((id) => !known.has(id))) throw new Error('One or more presentation elements do not exist.')
    this.viewer.goToSlide(index)
    this.viewer.selectElements(ids)
  }

  enterPresentation(): Promise<void> {
    return this.viewer.enterPresentation()
  }

  exitPresentation(): Promise<void> {
    return this.viewer.exitPresentation()
  }

  isApplyingInternalMutation(): boolean {
    return this.internalMutationDepth > 0
  }

  extractSearchEntries(): PresentationSearchEntry[] {
    const output: PresentationSearchEntry[] = []
    this.viewer.getSlides().forEach((slide, slideIndex) => {
      for (const element of flattenElements(slide.elements)) {
        const text = 'text' in element && typeof element.text === 'string' ? element.text.trim() : ''
        if (!text) continue
        output.push({
          slideIndex,
          slideNumber: slideIndex + 1,
          slideId: slide.id,
          elementId: element.id,
          ...(element.name ? { elementName: element.name } : {}),
          source: 'slide',
          text
        })
      }
      if (slide.notes?.trim()) {
        output.push({
          slideIndex,
          slideNumber: slideIndex + 1,
          slideId: slide.id,
          source: 'notes',
          text: slide.notes.trim()
        })
      }
    })
    return output
  }

  findElementForLocator(slideIndex: number, elementId?: string, elementName?: string): PptxElement | undefined {
    const elements = flattenElements(this.viewer.getElements(slideIndex))
    return elements.find((element) =>
      (elementId && (element.id === elementId || element.shapeId === elementId)) ||
      (elementName && element.name === elementName)
    )
  }

  private slide(index: number): PptxSlide {
    const normalized = assertSlideIndex(index, this.viewer.getSlideCount())
    const slide = this.viewer.getSlide(normalized)
    if (!slide) throw new Error(`Slide ${normalized + 1} does not exist.`)
    return slide
  }

  private mutate<T>(actor: DocumentActor, undoGroup: string, action: () => T): T {
    if (!this.canMutate()) throw new Error('This presentation is read-only.')
    this.internalMutationDepth += 1
    try {
      const result = action()
      recordDocumentTransaction({
        id: crypto.randomUUID(),
        fileId: this.fileId,
        documentKind: 'pptx',
        actor,
        baseRevision: this.baseRevision(),
        undoGroup,
        createdAt: Date.now()
      })
      this.onMutation()
      return result
    } finally {
      this.internalMutationDepth -= 1
    }
  }
}

function slideSummary(slide: PptxSlide): PresentationSlideSummary {
  return {
    id: slide.id,
    ...(slide.name ? { name: slide.name } : {}),
    slideNumber: slide.slideNumber,
    hidden: Boolean(slide.hidden),
    elementCount: flattenElements(slide.elements).length
  }
}

function elementSummary(element: PptxElement): PresentationElementSummary {
  const text = 'text' in element && typeof element.text === 'string' ? element.text : undefined
  return {
    id: element.id,
    ...(element.shapeId ? { shapeId: element.shapeId } : {}),
    type: element.type,
    ...(element.name ? { name: element.name } : {}),
    ...(text !== undefined ? { text } : {}),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    ...(element.rotation !== undefined ? { rotation: element.rotation } : {}),
    hidden: Boolean(element.hidden)
  }
}

function flattenElements(elements: readonly PptxElement[]): PptxElement[] {
  const output: PptxElement[] = []
  const queue = [...elements]
  while (queue.length > 0) {
    const element = queue.shift()!
    output.push(element)
    if ('children' in element && Array.isArray(element.children)) queue.unshift(...element.children)
  }
  return output
}

function assertSlideIndex(index: number, count: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Slide index is out of range.')
  return index
}

function assertSlideIndexes(indexes: number[], count: number): number[] {
  if (indexes.length === 0) throw new Error('Choose at least one slide.')
  return [...new Set(indexes.map((index) => assertSlideIndex(index, count)))].sort((left, right) => left - right)
}

function assertElementId(id: string): string {
  const normalized = id.trim()
  if (!normalized || normalized.length > 255 || /[\0\r\n]/.test(normalized)) throw new Error('Presentation element id is invalid.')
  return normalized
}

function assertElementPatch(patch: PresentationElementPatch): PresentationElementPatch {
  const allowed = ['x', 'y', 'width', 'height', 'rotation', 'hidden', 'text'] as const
  if (Object.keys(patch).some((key) => !(allowed as readonly string[]).includes(key))) {
    throw new Error('Presentation element patch contains unsupported fields.')
  }
  const output: PresentationElementPatch = {}
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error(`Presentation ${key} is out of range.`)
    if ((key === 'width' || key === 'height') && value <= 0) throw new Error(`Presentation ${key} must be positive.`)
    output[key] = value
  }
  if (patch.hidden !== undefined) output.hidden = Boolean(patch.hidden)
  if (patch.text !== undefined) output.text = assertText(patch.text, 'Element text', 32_768, true)
  if (Object.keys(output).length === 0) throw new Error('Presentation element patch cannot be empty.')
  return output
}

function assertText(value: string, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.length === 0) || value.includes('\0')) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
