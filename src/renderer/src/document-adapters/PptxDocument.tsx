import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileSliders, LoaderCircle, ShieldAlert } from 'lucide-react'
import {
  createPptxViewer,
  type PptxViewerInstance,
  type ToolbarActionId,
  type ViewerTheme
} from 'pptx-vanilla-viewer'
import 'pptx-vanilla-viewer/styles.css'
import type { PresentationCompatibility } from '@shared/contracts'
import { useEffectiveDarkMode } from '@renderer/hooks/use-effective-dark-mode'
import { useAppStore } from '@renderer/store/app-store'
import type { DocumentAdapterProps } from './registry'
import {
  recordDocumentTransaction,
  registerDocumentRuntime,
  type BinaryDocumentRuntime
} from './runtime'
import { ViewerPresentationDocumentApi } from './presentation-api'

const HIDDEN_ACTIONS: ToolbarActionId[] = [
  'file',
  'share',
  'broadcast',
  'export',
  'record',
  'help'
]

const DISALLOWED_CONTROL_SELECTOR = [
  '.pptxv-ai-toggle',
  '.pptxv-ai-settings',
  '.pptxv-titlebar-autosave',
  '.pptxv-titlebar-status',
  '.pptxv-qat [aria-label="Save"]',
  '.pptxv-mobile-toolbar [aria-label="Save"]',
  '[aria-label="Settings & Shortcuts"]',
  '[data-pptx-collaboration]',
  '[data-pptx-share]'
].join(', ')

function ribbonTabKey(tab: Element | null): string {
  return (tab?.getAttribute('title') ?? tab?.textContent ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const LIGHT_THEME: ViewerTheme = {
  colors: {
    background: '#f6f7f9',
    foreground: '#17191d',
    card: '#ffffff',
    cardForeground: '#17191d',
    popover: '#ffffff',
    popoverForeground: '#17191d',
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    secondary: '#eef0f4',
    secondaryForeground: '#272a30',
    muted: '#eef0f4',
    mutedForeground: '#6d727c',
    accent: '#e7e9f8',
    accentForeground: '#27235e',
    destructive: '#dc2626',
    destructiveForeground: '#ffffff',
    border: '#d9dce2',
    input: '#c9cdd5',
    ring: '#6366f1'
  },
  radius: '6px'
}

const DARK_THEME: ViewerTheme = {
  colors: {
    background: '#17181b',
    foreground: '#f2f3f5',
    card: '#202126',
    cardForeground: '#f2f3f5',
    popover: '#24262b',
    popoverForeground: '#f2f3f5',
    primary: '#8b8cf8',
    primaryForeground: '#151521',
    secondary: '#2b2d33',
    secondaryForeground: '#f2f3f5',
    muted: '#2b2d33',
    mutedForeground: '#a5a8b0',
    accent: '#34364a',
    accentForeground: '#f2f3ff',
    destructive: '#f87171',
    destructiveForeground: '#210f0f',
    border: '#3a3c43',
    input: '#464951',
    ring: '#a5b4fc'
  },
  radius: '6px'
}

export function PptxDocument({ document }: DocumentAdapterProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewerInstance | null>(null)
  const dark = useEffectiveDarkMode()
  const initialDark = useRef(dark)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [compatibility, setCompatibility] = useState<PresentationCompatibility | null>(null)
  const [requiresSaveAs, setRequiresSaveAs] = useState(false)
  const saveDocumentAs = useAppStore((state) => state.saveDocumentAs)
  const sessionUrl = document.documentKind === 'pptx' ? document.session.url : ''
  const presentationCompatibility = document.documentKind === 'pptx'
    ? document.session.presentationCompatibility
    : undefined
  const initialRevision = useRef(document.revision.sha256)

  useEffect(() => {
    viewerRef.current?.setTheme(dark ? DARK_THEME : LIGHT_THEME)
  }, [dark])

  useEffect(() => {
    if (document.documentKind !== 'pptx' || !host.current) return
    let disposed = false
    let loaded = false
    let cleanupRuntime: (() => void) | undefined
    let policyObserver: MutationObserver | undefined
    let inlineEditorFrame: number | undefined
    let viewerChromeFrame: number | undefined
    let inlineEditorRetries = 0
    let inlineSourceStyle: HTMLStyleElement | undefined
    let viewer: PptxViewerInstance | null = null
    let presentation: ViewerPresentationDocumentApi | null = null
    const expandedInspectorSections = new Set(['POSITION & SIZE', 'PRESENTATION'])
    const sessionCompatibility = presentationCompatibility ?? {
      level: 'supported' as const,
      reasons: [],
      requiresSaveAs: false
    }
    let localCompatibility = sessionCompatibility
    let localRequiresSaveAs = sessionCompatibility.requiresSaveAs

    const removeDisallowedControls = (): void => {
      host.current?.querySelectorAll(DISALLOWED_CONTROL_SELECTOR).forEach((element) => element.remove())
    }
    const synchronizeInlineEditor = (): void => {
      const editorHost = host.current
      if (!editorHost) return
      const inlineEditor = editorHost.querySelector<HTMLElement>(
        '.pptxv-inline-editor:not(.pptxv-table-cell-editor)'
      )
      if (!inlineEditor) {
        inlineEditorRetries = 0
        inlineSourceStyle?.remove()
        inlineSourceStyle = undefined
        editorHost.querySelectorAll('.is-aladdeen-inline-editing').forEach((element) => {
          element.classList.remove('is-aladdeen-inline-editing')
        })
        return
      }
      const retryAfterLayout = (): void => {
        if (inlineEditorFrame !== undefined || inlineEditorRetries >= 8) return
        inlineEditorRetries += 1
        inlineEditorFrame = window.requestAnimationFrame(() => {
          inlineEditorFrame = undefined
          synchronizeInlineEditor()
        })
      }
      if (!viewer) {
        retryAfterLayout()
        return
      }
      const selectedId = viewer.getSelectedElementId()
      let selected = selectedId
        ? editorHost.querySelector<HTMLElement>(`.pptxv-stage [data-element-id="${CSS.escape(selectedId)}"]`)
        : null
      if (!selected) {
        const editorRect = inlineEditor.getBoundingClientRect()
        let closestDistance = Number.POSITIVE_INFINITY
        for (const candidate of editorHost.querySelectorAll<HTMLElement>('.pptxv-stage [data-element-id]')) {
          const candidateRect = candidate.getBoundingClientRect()
          const distance = Math.abs(candidateRect.x - editorRect.x) + Math.abs(candidateRect.y - editorRect.y)
          if (distance < closestDistance) {
            selected = candidate
            closestDistance = distance
          }
        }
        if (closestDistance > 4) selected = null
      }
      const renderedText = selected?.querySelector<HTMLElement>('.pptxv-text')
      if (!selected || !renderedText) {
        retryAfterLayout()
        return
      }
      inlineEditorRetries = 0
      editorHost.querySelectorAll('.is-aladdeen-inline-editing').forEach((element) => {
        if (element !== selected) element.classList.remove('is-aladdeen-inline-editing')
      })
      selected.classList.add('is-aladdeen-inline-editing')
      const elementId = selected.dataset.elementId
      if (elementId) {
        const sourceStyle = inlineSourceStyle ?? editorHost.ownerDocument.createElement('style')
        inlineSourceStyle = sourceStyle
        const sourceRule = `.pptxv-stage [data-element-id="${CSS.escape(elementId)}"] .pptxv-text { visibility: hidden !important; }`
        if (sourceStyle.textContent !== sourceRule) sourceStyle.textContent = sourceRule
        if (!sourceStyle.isConnected) editorHost.append(sourceStyle)
      }
      if (inlineEditor.dataset.aladdeenEnhanced === 'true') return
      const style = window.getComputedStyle(renderedText)
      for (const property of [
        'color',
        'font-weight',
        'font-style',
        'line-height',
        'letter-spacing',
        'text-align',
        'text-decoration',
        'white-space',
        'word-break'
      ]) {
        inlineEditor.style.setProperty(property, style.getPropertyValue(property))
      }
      inlineEditor.dataset.aladdeenEnhanced = 'true'
    }
    const queueInlineEditorSync = (): void => {
      inlineEditorRetries = 0
      if (inlineEditorFrame !== undefined) window.cancelAnimationFrame(inlineEditorFrame)
      inlineEditorFrame = window.requestAnimationFrame(() => {
        inlineEditorFrame = undefined
        synchronizeInlineEditor()
      })
    }
    const handleEditorFocus = (event: FocusEvent): void => {
      if (event.target instanceof Element && event.target.closest('.pptxv-inline-editor')) {
        queueInlineEditorSync()
      }
    }
    const enhanceInspectorSections = (): void => {
      const editorHost = host.current
      if (!editorHost) return
      for (const section of editorHost.querySelectorAll<HTMLElement>('.pptxv-inspector-section')) {
        if (section.dataset.aladdeenEnhanced === 'true') continue
        const title = section.querySelector<HTMLElement>(':scope > .pptxv-inspector-section-title')
        if (!title) continue
        const key = (title.textContent ?? '').trim().toUpperCase()
        const applyExpandedState = (expanded: boolean): void => {
          section.classList.toggle('is-collapsed', !expanded)
          title.setAttribute('aria-expanded', String(expanded))
          if (expanded) expandedInspectorSections.add(key)
          else expandedInspectorSections.delete(key)
        }
        title.setAttribute('role', 'button')
        title.tabIndex = 0
        title.setAttribute('aria-label', `${title.textContent?.trim() ?? 'Property group'} properties`)
        title.addEventListener('click', () => {
          applyExpandedState(section.classList.contains('is-collapsed'))
        })
        title.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          applyExpandedState(section.classList.contains('is-collapsed'))
        })
        section.dataset.aladdeenEnhanced = 'true'
        applyExpandedState(expandedInspectorSections.has(key))
      }
    }
    const enhanceRibbonLayout = (): void => {
      const editorHost = host.current
      if (!editorHost) return
      const activeTab = editorHost.querySelector('.pptxv-ribbon-tab[aria-selected="true"]')
      const activeContent = editorHost.querySelector<HTMLElement>(
        '.pptxv-ribbon-tab-content:not([hidden])'
      )
      const tabKey = ribbonTabKey(activeTab)
      if (activeContent && tabKey) activeContent.dataset.aladdeenRibbonTab = tabKey
    }
    const synchronizeViewerChrome = (): void => {
      removeDisallowedControls()
      enhanceRibbonLayout()
      enhanceInspectorSections()
      synchronizeInlineEditor()
    }
    const queueViewerChromeSync = (): void => {
      if (viewerChromeFrame !== undefined) window.cancelAnimationFrame(viewerChromeFrame)
      viewerChromeFrame = window.requestAnimationFrame(() => {
        viewerChromeFrame = undefined
        synchronizeViewerChrome()
      })
    }
    const handleRibbonActivation = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('.pptxv-ribbon-tab')) {
        queueViewerChromeSync()
      }
    }
    const closeInspectorInitially = (): void => {
      const editorHost = host.current
      const inspector = editorHost?.querySelector<HTMLElement>('.pptxv-inspector')
      const toggle = editorHost?.querySelector<HTMLButtonElement>('[aria-label="Toggle inspector panel"]')
      if (inspector && toggle && !inspector.hidden) toggle.click()
    }
    const blockExternalNavigation = (event: Event): void => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      const href = target?.getAttribute('href') ?? ''
      if (/^(?:https?|file|ftp):/i.test(href) || href.startsWith('//')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const cleanup = (): void => {
      if (disposed) return
      disposed = true
      policyObserver?.disconnect()
      if (inlineEditorFrame !== undefined) window.cancelAnimationFrame(inlineEditorFrame)
      if (viewerChromeFrame !== undefined) window.cancelAnimationFrame(viewerChromeFrame)
      inlineSourceStyle?.remove()
      host.current?.removeEventListener('click', blockExternalNavigation, true)
      host.current?.removeEventListener('click', handleRibbonActivation, true)
      host.current?.removeEventListener('focusin', handleEditorFocus, true)
      cleanupRuntime?.()
      viewer?.stopCollaboration()
      viewer?.destroy()
      viewer = null
      presentation = null
      viewerRef.current = null
    }

    const initialize = async (): Promise<void> => {
      try {
        const response = await fetch(sessionUrl, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Could not load the presentation (${response.status}).`)
        const source = await response.arrayBuffer()
        if (disposed || !host.current) return

        setCompatibility(localCompatibility)
        setRequiresSaveAs(localRequiresSaveAs)
        host.current.addEventListener('click', blockExternalNavigation, true)
        host.current.addEventListener('click', handleRibbonActivation, true)
        host.current.addEventListener('focusin', handleEditorFocus, true)
        // Coalesce chrome sync into one animation frame: the synchronous
        // observer callback ran full-subtree queries and getComputedStyle on
        // every mutation, which made dragging and inline typing stutter and
        // re-triggered itself through its own DOM writes. Also watch `hidden`
        // flips so ribbon tab switches re-sync regardless of input modality.
        policyObserver = new MutationObserver(queueViewerChromeSync)
        policyObserver.observe(host.current, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['hidden']
        })

        viewer = createPptxViewer(host.current, {
          source,
          fileName: document.name,
          editable: localCompatibility.level !== 'read-only',
          showToolbar: true,
          showThumbnails: true,
          showFormatToolbar: true,
          showInspector: true,
          hiddenActions: HIDDEN_ACTIONS,
          smartArt3D: false,
          autosave: false,
          theme: initialDark.current ? DARK_THEME : LIGHT_THEME,
          onLoad: () => {
            if (disposed || !viewer) return
            const warnings = viewer.getHandler()?.getCompatibilityWarnings() ?? []
            if (localCompatibility.level === 'supported' && warnings.length > 0) {
              localCompatibility = {
                level: 'preserve-only',
                reasons: [...new Set(warnings.map((warning) => warning.message))].slice(0, 8),
                requiresSaveAs: true
              }
              localRequiresSaveAs = true
              setCompatibility(localCompatibility)
              setRequiresSaveAs(true)
            }
            presentation = new ViewerPresentationDocumentApi(
              viewer,
              document.id,
              () => useAppStore.getState().documents.find((item) => item.id === document.id)?.revision.sha256
                ?? initialRevision.current,
              () => useAppStore.getState().markBinaryDirty(document.id),
              () => localCompatibility.level !== 'read-only'
            )
            const runtime: BinaryDocumentRuntime = {
              serialize: async () => {
                if (!viewer) throw new Error('The presentation editor is not ready.')
                setSaving(true)
                try {
                  const bytes = await viewer.getContent()
                  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
                } finally {
                  setSaving(false)
                }
              },
              completeSave: (committed) => {
                if (committed && localRequiresSaveAs) {
                  localRequiresSaveAs = false
                  setRequiresSaveAs(false)
                }
              },
              extractPresentationEntries: () => presentation?.extractSearchEntries() ?? [],
              reveal: (match) => {
                const locator = match.presentationText
                if (!locator || !viewer || !presentation) return false
                presentation.goToSlide(locator.slideIndex)
                const element = presentation.findElementForLocator(
                  locator.slideIndex,
                  locator.elementId,
                  locator.elementName
                )
                if (element) viewer.selectElements([element.id])
                return true
              },
              undo: () => viewer?.undo(),
              redo: () => viewer?.redo(),
              focus: () => host.current?.focus(),
              presentation,
              autosaveAllowed: () => !localRequiresSaveAs && localCompatibility.level !== 'read-only',
              requiresSaveAs: () => localRequiresSaveAs,
              readOnly: () => localCompatibility.level === 'read-only',
              cleanup
            }
            cleanupRuntime = registerDocumentRuntime(document.id, runtime)
            loaded = true
            synchronizeViewerChrome()
            closeInspectorInitially()
            setLoading(false)
          },
          onSelectionChange: () => {
            queueInlineEditorSync()
          },
          onChange: () => {
            if (!loaded || localCompatibility.level === 'read-only' || presentation?.isApplyingInternalMutation()) return
            recordDocumentTransaction({
              id: crypto.randomUUID(),
              fileId: document.id,
              documentKind: 'pptx',
              actor: 'user',
              baseRevision: useAppStore.getState().documents.find((item) => item.id === document.id)?.revision.sha256
                ?? initialRevision.current,
              createdAt: Date.now()
            })
            useAppStore.getState().markBinaryDirty(document.id)
          },
          onError: (message, caught) => {
            if (disposed) return
            console.error('PPTX viewer failed', caught)
            setError(message || 'The presentation could not be opened.')
            setLoading(false)
          }
        })
        viewerRef.current = viewer
        synchronizeViewerChrome()
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : 'The presentation could not be opened.')
          setLoading(false)
        }
      }
    }
    void initialize()
    return cleanup
  }, [document.documentKind, document.id, document.name, presentationCompatibility, sessionUrl])

  if (document.documentKind !== 'pptx') return <div />
  return (
    <div className="aladdeen-pptx-host relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-elevated">
      {compatibility && compatibility.level !== 'supported' && (
        <div className={compatibility.level === 'read-only' ? 'pptx-compatibility is-read-only' : 'pptx-compatibility'}>
          {compatibility.level === 'read-only' ? <ShieldAlert size={15} /> : <AlertTriangle size={15} />}
          <span>
            {compatibility.level === 'read-only'
              ? `Read-only: Aladdeen cannot safely rewrite ${compatibility.reasons.join(', ')}.`
              : requiresSaveAs
                ? `Compatibility copy required to preserve ${compatibility.reasons.join(', ')}.`
                : `Compatibility features preserved in this editable copy: ${compatibility.reasons.join(', ')}.`}
          </span>
          {compatibility.level === 'preserve-only' && requiresSaveAs && (
            <button type="button" onClick={() => void saveDocumentAs(document.id)}>Save editable copy…</button>
          )}
        </div>
      )}
      <div
        ref={host}
        className={compatibility?.level === 'read-only' ? 'pptx-viewer-container is-read-only' : 'pptx-viewer-container'}
        tabIndex={-1}
      />
      {loading && (
        <div className="pptx-progress-overlay absolute inset-0 z-20 grid place-items-center bg-surface-elevated/90 text-[12px] text-foreground-muted">
          <span className="flex items-center gap-2">
            <LoaderCircle className="spinner" size={16} /> Loading presentation…
          </span>
        </div>
      )}
      {saving && !loading && (
        <div className="pptx-saving-indicator" role="status">
          <LoaderCircle className="spinner" size={12} /> Saving presentation…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-surface-elevated p-8 text-center">
          <div className="max-w-md">
            <FileSliders className="mx-auto text-danger" size={25} />
            <strong className="mt-3 block text-[14px]">Could not open presentation</strong>
            <span className="mt-1.5 block text-[11px] text-foreground-muted">{error}</span>
          </div>
        </div>
      )}
    </div>
  )
}
