import type { PreviewSize } from './preview-geometry'

interface PreviewSvg extends PreviewSize {
  markup: string
  title: string
  description: string
}

/** Input has already passed the Mermaid sanitizer. Namespace cached SVGs per DOM instance. */
export function preparePreviewSvg(source: string, prefix: string): PreviewSvg {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const svg = document.documentElement
  const ids = new Map<string, string>()
  for (const element of document.querySelectorAll('[id]')) {
    const id = element.getAttribute('id')!
    ids.set(id, `${prefix}-${ids.size}`)
  }
  const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const idPattern = ids.size ? new RegExp(`#(${[...ids.keys()].sort((a, b) => b.length - a.length).map(escaped).join('|')})(?![\\w-])`, 'g') : null
  const references = (value: string): string => idPattern ? value.replace(idPattern, (_match, id: string) => `#${ids.get(id)!}`) : value
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'id') element.setAttribute('id', ids.get(attribute.value)!)
      else if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        element.setAttribute(attribute.name, attribute.value.split(/\s+/).map((id) => ids.get(id) ?? id).join(' '))
      } else if (attribute.name === 'href' || attribute.name === 'xlink:href' || /url\(/i.test(attribute.value)) {
        element.setAttribute(attribute.name, references(attribute.value))
      }
    }
    if (element.localName === 'style') element.textContent = references(element.textContent ?? '')
  }
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const dimension = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : fallback
  const width = dimension(box?.[2], 640)
  const height = dimension(box?.[3], 480)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return {
    markup: new XMLSerializer().serializeToString(svg), width, height,
    title: svg.querySelector('title')?.textContent?.trim() || 'Mermaid diagram',
    description: svg.querySelector('desc')?.textContent?.trim() || ''
  }
}

/** Inline mindmaps depend on app CSS; freeze computed presentation into standalone SVG output. */
export function standaloneSvg(element: SVGSVGElement): string {
  const clone = element.cloneNode(true) as SVGSVGElement
  const originalElements = [element, ...element.querySelectorAll('*')]
  const clonedElements = [clone, ...clone.querySelectorAll('*')]
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style']
  originalElements.forEach((original, index) => {
    const target = clonedElements[index]!
    const style = getComputedStyle(original)
    for (const property of properties) target.setAttribute(property, style.getPropertyValue(property))
  })
  const box = element.viewBox?.baseVal
  if (box?.width && box.height) {
    clone.setAttribute('width', String(box.width))
    clone.setAttribute('height', String(box.height))
  } else {
    const parts = element.getAttribute('viewBox')?.split(/\s+/)
    if (parts?.[2] && parts[3]) { clone.setAttribute('width', parts[2]); clone.setAttribute('height', parts[3]) }
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(clone)
}
