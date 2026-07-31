import DOMPurify from 'dompurify'
import { parse, serialize, type ParserError } from 'parse5'

interface Parse5Location {
  startOffset: number
  endOffset: number
}

interface Parse5Node {
  nodeName?: string
  tagName?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: Parse5Node[]
  content?: Parse5Node
  sourceCodeLocation?: Parse5Location
}

const BLOCKED_TAGS = ['script', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button']

export function prepareHtmlPreview(source: string, fileId: string): string {
  const tree = parse(source, { sourceCodeLocationInfo: true }) as unknown as Parse5Node
  annotate(tree)
  const annotated = serialize(tree as never)
  const sanitized = DOMPurify.sanitize(annotated, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['link'],
    ADD_ATTR: ['data-aladdeen-source-start', 'data-aladdeen-source-end'],
    FORBID_TAGS: BLOCKED_TAGS,
    FORBID_ATTR: ['srcset', 'target', 'download']
  })
  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const element of document.querySelectorAll('base, meta[http-equiv]')) element.remove()
  for (const element of document.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
    }
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    anchor.dataset.aladdeenBlockedLink = anchor.href
    anchor.removeAttribute('href')
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>('link')) {
    if (link.rel.toLowerCase() !== 'stylesheet') link.remove()
  }
  for (const element of document.querySelectorAll<HTMLImageElement | HTMLLinkElement>('[src], link[href]')) {
    const attribute = element.hasAttribute('src') ? 'src' : 'href'
    const value = element.getAttribute(attribute)
    if (!value) continue
    const safe = localAssetUrl(fileId, value)
    if (safe) element.setAttribute(attribute, safe)
    else element.removeAttribute(attribute)
  }
  document.documentElement.setAttribute('data-aladdeen-html-preview', '')
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; img-src data: aladdeen-asset:; style-src 'unsafe-inline' aladdeen-asset:; font-src data: aladdeen-asset:; media-src aladdeen-asset:; form-action 'none'"
  document.head.prepend(policy)
  const style = document.createElement('style')
  style.textContent = `
    :root { color-scheme: light dark; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html { background: Canvas; color: CanvasText; }
    body { max-width: 880px; margin: 0 auto; padding: 72px clamp(24px, 6vw, 72px) 120px; overflow-wrap: anywhere; }
    img, video, canvas { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 14px; border-radius: 8px; background: color-mix(in srgb, CanvasText 7%, Canvas); }
    table { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; }
    th, td { border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); padding: 6px 9px; }
    a[data-aladdeen-blocked-link] { color: LinkText; text-decoration: underline; cursor: not-allowed; }
  `
  document.head.append(style)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

export function validateHtmlSource(source: string): ParserError[] {
  const errors: ParserError[] = []
  parse(source, { onParseError: (error) => errors.push(error) })
  return errors
}

function annotate(node: Parse5Node): void {
  if (node.tagName && node.sourceCodeLocation) {
    node.attrs = (node.attrs ?? []).filter((attribute) => (
      !attribute.name.toLowerCase().startsWith('data-aladdeen-')
    ))
    node.attrs.push(
      { name: 'data-aladdeen-source-start', value: String(node.sourceCodeLocation.startOffset) },
      { name: 'data-aladdeen-source-end', value: String(node.sourceCodeLocation.endOffset) }
    )
  }
  for (const child of node.childNodes ?? []) annotate(child)
  if (node.content) annotate(node.content)
}

function localAssetUrl(fileId: string, value: string): string | null {
  const trimmed = value.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return trimmed.startsWith('data:image/') ? trimmed : null
  }
  return `aladdeen-asset://document/${encodeURIComponent(fileId)}?path=${encodeURIComponent(trimmed)}`
}
