import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { useAppStore } from '@renderer/store/app-store'
import type { AladdeenApi, AppSettings } from '@shared/contracts'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const defaultSettings: AppSettings = {
  theme: 'system',
  accent: 'indigo',
  sidebarWidth: 320,
  sidebarCollapsed: false,
  completedOnboardingVersion: 1,
  ...DEFAULT_READING_SETTINGS
}

describe('settings dialog', () => {
  const update = vi.fn()
  const openExternal = vi.fn()

  beforeEach(() => {
    update.mockImplementation(async (settings: AppSettings) => ({ ok: true, value: settings }))
    openExternal.mockResolvedValue({ ok: true, value: undefined })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    })
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: {
        settings: { update },
        system: { openExternal }
      } as unknown as AladdeenApi
    })
    useAppStore.setState({ settings: defaultSettings, persistedSettings: defaultSettings })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows one real settings category at a time and persists appearance changes', async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    expect(screen.queryByText('Quick open')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Aladdeen' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ ...defaultSettings, theme: 'dark' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rose accent' }))
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith({ ...defaultSettings, theme: 'dark', accent: 'rose' })
    })
  })

  it('restores the last persisted appearance when a settings write fails', async () => {
    update.mockResolvedValueOnce({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'Settings are read-only.' }
    })
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await waitFor(() => {
      expect(useAppStore.getState().settings).toEqual(defaultSettings)
      expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('switches panels and uses manual keyboard activation with heading focus', async () => {
    const view = render(<SettingsDialog open onOpenChange={vi.fn()} />)

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' })
    fireEvent.click(appearanceTab)
    appearanceTab.focus()
    fireEvent.keyDown(appearanceTab, { key: 'ArrowDown' })

    const readingTab = screen.getByRole('tab', { name: 'Reading' })
    expect(readingTab).toHaveFocus()
    fireEvent.keyDown(readingTab, { key: 'ArrowDown' })

    const shortcutsTab = screen.getByRole('tab', { name: 'Keyboard shortcuts' })
    expect(shortcutsTab).toHaveFocus()
    expect(shortcutsTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(shortcutsTab, { key: 'Enter' })
    const heading = await screen.findByRole('heading', { name: 'Keyboard shortcuts' })
    expect(shortcutsTab).toHaveAttribute('aria-selected', 'true')
    expect(heading).toHaveFocus()
    expect(screen.getByText('Quick open')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dark' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'About' }))
    expect(screen.getByRole('heading', { name: 'About' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Aladdeen Research' })).toBeVisible()
    expect(screen.getByText('Version 0.7.0')).toBeVisible()
    expect(screen.getByText(/original disk locations/i)).toBeVisible()
    expect(screen.queryByText('Quick open')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /X: x\.com\/aliahadmd1/i }))
    fireEvent.click(screen.getByRole('button', { name: /GitHub: github\.com\/aliahadmd/i }))
    fireEvent.click(screen.getByRole('button', { name: /Email: ali@aliahad\.com/i }))
    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://x.com/aliahadmd1')
    expect(openExternal).toHaveBeenNthCalledWith(2, 'https://github.com/aliahadmd')
    expect(openExternal).toHaveBeenNthCalledWith(3, 'mailto:ali@aliahad.com')

    view.unmount()
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
  })

  it('updates and resets Markdown reading preferences', async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Reading' }))

    expect(screen.getByRole('heading', { name: 'Reading' })).toBeVisible()
    expect(screen.getByText('Your current reading appearance.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Iowan Made for long reading' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ ...defaultSettings, readingFont: 'iowan' }))

    fireEvent.click(screen.getByRole('button', { name: 'Increase reading text size' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ ...defaultSettings, readingFont: 'iowan', readingFontSize: 17 }))

    fireEvent.click(screen.getByRole('button', { name: 'Relaxed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      ...defaultSettings,
      readingFont: 'iowan',
      readingFontSize: 17,
      readingLineHeight: 'relaxed',
      readingColumnWidth: 'wide',
      readingSurface: 'sage'
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(defaultSettings))
  })

  it('closes with Escape and restores focus to the opener', async () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open settings</button>
          <SettingsDialog open={open} onOpenChange={setOpen} />
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open settings' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('offers the tutorial from About and closes Settings before replaying it', () => {
    const onOpenChange = vi.fn()
    const onShowTutorial = vi.fn()
    render(
      <SettingsDialog
        open
        onOpenChange={onOpenChange}
        onShowTutorial={onShowTutorial}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'About' }))
    fireEvent.click(screen.getByRole('button', { name: 'View tutorial' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onShowTutorial).toHaveBeenCalledOnce()
  })
})
