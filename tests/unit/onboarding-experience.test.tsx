import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingExperience } from '@renderer/components/OnboardingExperience'
import { useAppStore } from '@renderer/store/app-store'

describe('guided onboarding experience', () => {
  const createEnvironment = vi.fn()

  beforeEach(() => {
    createEnvironment.mockResolvedValue(true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    })
    useAppStore.setState({
      createEnvironment,
      pendingOpenRequest: undefined
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('moves through four distinct tutorial steps and then requires environment setup', () => {
    const view = render(<OnboardingExperience mode="first-run" />)
    const experience = view.container.querySelector('.onboarding-experience')

    expect(screen.getByRole('heading', { name: 'Research stays on your Mac' })).toHaveFocus()
    expect(screen.getByLabelText('Step 1 of 4')).toBeVisible()
    expect(experience).toHaveAttribute('data-palette', 'lavender')

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Organize without moving anything' })).toHaveFocus()
    expect(experience).toHaveAttribute('data-palette', 'sage')

    fireEvent.keyDown(screen.getByRole('heading', { name: 'Organize without moving anything' }), { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: 'A workspace for every format' })).toHaveFocus()
    expect(experience).toHaveAttribute('data-palette', 'amber')

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Find the passage, not just the file' })).toHaveFocus()
    expect(experience).toHaveAttribute('data-palette', 'rose')

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByRole('heading', { name: 'Create your first environment' })).toBeVisible()
    expect(screen.getByLabelText('Environment name')).toHaveValue('Personal')
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).not.toBeInTheDocument()
    expect(experience).toHaveAttribute('data-palette', 'neutral')
  })

  it('skips education without skipping setup and preserves a queued Finder document', async () => {
    useAppStore.setState({
      pendingOpenRequest: {
        token: '33333333-3333-4333-8333-333333333333',
        name: 'Evidence.pdf'
      }
    })
    render(<OnboardingExperience mode="first-run" />)

    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }))
    expect(screen.getByText(/we’ll open/i)).toHaveTextContent('Evidence.pdf')

    const input = screen.getByLabelText('Environment name')
    fireEvent.change(input, { target: { value: '  Archive  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(createEnvironment).toHaveBeenCalledWith('Archive'))
  })

  it('opens direct setup without tutorial navigation after the last environment is removed', () => {
    render(<OnboardingExperience mode="setup" />)

    expect(screen.getByRole('heading', { name: 'Create your first environment' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument()
  })

  it('replays without changing environments and closes with Escape or Done', () => {
    const onClose = vi.fn()
    const view = render(<OnboardingExperience mode="replay" onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Research stays on your Mac' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(createEnvironment).not.toHaveBeenCalled()

    onClose.mockClear()
    view.rerender(<OnboardingExperience mode="replay" onClose={onClose} />)
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Environment name')).not.toBeInTheDocument()
  })
})
