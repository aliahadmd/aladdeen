import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentActions } from '@renderer/components/DocumentActions'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, AppSettings, TextOpenDocument } from '@shared/contracts'
import { DOCUMENT_CAPABILITIES } from '@shared/documents'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const fileId = '11111111-1111-4111-8111-111111111111'
const settings: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false,
  agentEnabled: false,
  agentProvider: 'anthropic',
  agentModelId: 'claude-sonnet-4-5',
  agentThinkingLevel: 'medium',
  agentPanelWidth: 380,
  agentPanelCollapsed: false,
  completedOnboardingVersion: 1,
  ...DEFAULT_READING_SETTINGS
}

const document: TextOpenDocument = {
  id: fileId,
  environmentId: '22222222-2222-4222-8222-222222222222',
  name: 'reading.md',
  location: 'Notes',
  fullPath: '/notes/reading.md',
  documentKind: 'markdown',
  encoding: 'utf-8',
  capabilities: DOCUMENT_CAPABILITIES.markdown,
  content: '# Reading',
  savedContent: '# Reading',
  status: 'saved',
  revision: { mtimeMs: 1, size: 9, sha256: 'a'.repeat(64), lineEnding: 'LF', hasBom: false },
  editorScrollTop: 0,
  editorSelection: 0
}

describe('Markdown document actions', () => {
  const update = vi.fn(async (next: AppSettings) => ({ ok: true as const, value: next }))

  beforeEach(() => {
    update.mockClear()
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: { settings: { update } } as unknown as AladdeenApi
    })
    useAppStore.setState({
      documents: [document],
      activeFileId: fileId,
      settings,
      persistedSettings: settings
    })
  })

  afterEach(cleanup)

  it('offers compact size, column, and reset controls', async () => {
    render(<DocumentActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Reading controls' }))

    expect(screen.getByText('16 px')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Increase reading text size' }))
    await waitFor(() => expect(useAppStore.getState().settings.readingFontSize).toBe(17))

    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    await waitFor(() => expect(useAppStore.getState().settings.readingColumnWidth).toBe('wide'))

    fireEvent.click(screen.getByRole('button', { name: 'Reset reading preferences' }))
    await waitFor(() => expect(useAppStore.getState().settings).toMatchObject(DEFAULT_READING_SETTINGS))
    expect(update).toHaveBeenCalled()
  })
})
