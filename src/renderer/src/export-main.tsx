import { createRoot } from 'react-dom/client'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import './index.css'
import './export.css'
import { MarkdownContent } from './components/MarkdownContent'

interface ExportRenderPayload {
  fileId: string
  title: string
  content: string
}

declare global {
  interface Window {
    renderAladdeenExport(payload: ExportRenderPayload): Promise<void>
  }
}

const root = createRoot(document.getElementById('root')!)

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

async function waitForDiagrams(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (document.querySelector('[data-mermaid-state="loading"]')) {
    if (Date.now() >= deadline) throw new Error('Timed out while rendering Mermaid diagrams.')
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
}

async function waitForImages(): Promise<void> {
  await withTimeout(Promise.all(
    Array.from(document.images).map(
      (image) =>
        image.complete ||
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        })
    )
  ).then(() => undefined), 15_000, 'Timed out while loading local images.')
}

window.renderAladdeenExport = async ({ fileId, title, content }) => {
  root.render(
    <MarkdownContent
      content={content}
      documentId={fileId}
      fallbackTitle={title}
      theme="light"
      interactive={false}
    />
  )
  await nextFrame()
  await waitForDiagrams()
  await withTimeout(document.fonts.ready, 15_000, 'Timed out while loading export fonts.')
  await waitForImages()
  await nextFrame()
  document.title = document.querySelector<HTMLElement>('.markdown-body')?.dataset.documentTitle || title
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
