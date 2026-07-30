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
  agentEnabled: false,
  agentProvider: 'anthropic',
  agentModelId: 'claude-sonnet-4-5',
  agentThinkingLevel: 'medium',
  agentPanelWidth: 380,
  agentPanelCollapsed: false,
  ...DEFAULT_READING_SETTINGS
}

describe('settings dialog', () => {
  const update = vi.fn()
  const openExternal = vi.fn()
  const credentialStatus = vi.fn()
  const getModelCatalog = vi.fn()
  const getProviderCatalog = vi.fn()
  const getProviderProfiles = vi.fn()
  const createProviderProfile = vi.fn()
  const beginLogin = vi.fn()
  const respondLoginPrompt = vi.fn()
  const reopenLoginUrl = vi.fn()
  const cancelLogin = vi.fn()
  const disconnectProvider = vi.fn()
  const onAuthEvent = vi.fn()

  beforeEach(() => {
    update.mockImplementation(async (settings: AppSettings) => ({ ok: true, value: settings }))
    openExternal.mockResolvedValue({ ok: true, value: undefined })
    beginLogin.mockResolvedValue({ ok: true, value: { attemptId: '15cc12cb-35a0-4ef0-8d76-06eba334c5bc' } })
    respondLoginPrompt.mockResolvedValue({ ok: true, value: undefined })
    reopenLoginUrl.mockResolvedValue({ ok: true, value: undefined })
    cancelLogin.mockResolvedValue({ ok: true, value: undefined })
    disconnectProvider.mockResolvedValue({ ok: true, value: undefined })
    onAuthEvent.mockReturnValue(() => undefined)
    credentialStatus.mockResolvedValue({
      ok: true,
      value: {
        encryptionAvailable: true,
        providers: [
          {
            providerId: 'anthropic',
            configured: false,
            reauthRequired: false,
            oauthAvailable: true,
            apiKeyAvailable: true
          },
          {
            providerId: 'openai-codex',
            configured: false,
            reauthRequired: false,
            oauthAvailable: true,
            apiKeyAvailable: false
          },
          {
            providerId: 'kimi-coding',
            configured: false,
            reauthRequired: false,
            oauthAvailable: true,
            apiKeyAvailable: true
          },
          {
            providerId: 'openai',
            configured: false,
            reauthRequired: false,
            oauthAvailable: false,
            apiKeyAvailable: true
          },
          {
            providerId: 'google',
            configured: false,
            reauthRequired: false,
            oauthAvailable: false,
            apiKeyAvailable: true
          }
        ]
      }
    })
    getProviderProfiles.mockResolvedValue({ ok: true, value: [] })
    getProviderCatalog.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'anthropic',
          name: 'Claude',
          source: 'native',
          featured: true,
          oauthAvailable: true,
          apiKeyAvailable: true,
          modelCount: 2,
          catalogKind: 'bundled'
        }
      ]
    })
    createProviderProfile.mockResolvedValue({
      ok: true,
      value: {
        id: 'custom:123e4567-e89b-42d3-a456-426614174000',
        name: 'Local Ollama',
        protocol: 'openai-completions',
        baseUrl: 'http://127.0.0.1:11434/v1',
        endpointScope: 'loopback',
        authScheme: 'none',
        catalogMode: 'remote',
        compatibility: {},
        models: [],
        createdAt: 100,
        updatedAt: 100
      }
    })
    getModelCatalog.mockResolvedValue({
      ok: true,
      value: [
        {
          provider: 'anthropic',
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          supportsThinking: true
        },
        {
          provider: 'anthropic',
          id: 'claude-opus-4-5',
          name: 'Claude Opus 4.5',
          supportsThinking: true
        }
      ]
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    })
    Object.defineProperty(window, 'aladdeen', {
      configurable: true,
      value: {
        settings: {
          update,
          get: vi.fn().mockResolvedValue({ ok: true, value: defaultSettings })
        },
        agent: {
          beginLogin,
          respondLoginPrompt,
          reopenLoginUrl,
          cancelLogin,
          disconnectProvider,
          credentialStatus,
          getModelCatalog,
          getProviderCatalog,
          getProviderProfiles,
          createProviderProfile,
          onAuthEvent
        },
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
    expect(screen.getByText('Version 0.9.0')).toBeVisible()
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

  it('keeps the coding agent opt-in and collects API keys through the sanitized login dialog', async () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Coding agent' }))

    expect(screen.getByText(/Off by default/)).toBeVisible()
    expect(screen.getByLabelText('Default agent model')).toBeDisabled()
    expect(screen.queryByLabelText('Agent model ID')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('anthropic API key')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Enable coding agent' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      ...defaultSettings,
      agentEnabled: true,
      agentPanelCollapsed: false
    }))
    const apiKeyButton = await screen.findByRole('button', { name: 'API key' })
    fireEvent.click(apiKeyButton)
    await waitFor(() => expect(beginLogin).toHaveBeenCalledWith({
      providerId: 'anthropic',
      authType: 'api_key'
    }))
  })

  it('guides creation of a loopback custom endpoint without collecting secrets in profile state', async () => {
    const enabledSettings = { ...defaultSettings, agentEnabled: true }
    useAppStore.setState({ settings: enabledSettings, persistedSettings: enabledSettings })
    render(<SettingsDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Coding agent' }))
    fireEvent.click(await screen.findByRole('button', { name: /Add custom endpoint/i }))
    fireEvent.click(screen.getByRole('button', { name: /Local server/i }))

    fireEvent.change(screen.getByLabelText('Provider name'), {
      target: { value: 'Local Ollama' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))

    await waitFor(() => expect(createProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Local Ollama',
      protocol: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      endpointScope: 'loopback',
      authScheme: 'none'
    })))
    expect(JSON.stringify(createProviderProfile.mock.calls)).not.toContain('apiKey')
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
