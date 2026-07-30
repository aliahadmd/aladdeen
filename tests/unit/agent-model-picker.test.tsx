import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentModelPicker } from '@renderer/components/agent/AgentModelPicker'
import type { AgentModel } from '@shared/contracts'

const models: AgentModel[] = [
  {
    provider: 'openai-codex',
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    supportsThinking: true
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    supportsThinking: true
  },
  {
    provider: 'openai-codex',
    id: 'gpt-5.5',
    name: 'Duplicate GPT',
    supportsThinking: false
  },
  {
    provider: 'openai-codex',
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    supportsThinking: true
  }
]

afterEach(cleanup)

describe('agent model picker', () => {
  it('filters and deduplicates models while preserving friendly pi order', () => {
    const onChange = vi.fn()
    render(
      <AgentModelPicker
        models={models}
        provider="openai-codex"
        value="gpt-5.5"
        variant="settings"
        ariaLabel="Default agent model"
        onChange={onChange}
      />
    )

    const picker = screen.getByLabelText('Default agent model')
    expect(screen.getByRole('option', { name: 'GPT-5.5' })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'GPT-5.5' })).toHaveLength(1)
    expect(screen.queryByRole('option', { name: 'Claude Sonnet 4.5' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'GPT-5.5',
      'GPT-5.4'
    ])
    expect(screen.getByText(/Model ID:/)).toHaveTextContent('gpt-5.5')

    fireEvent.change(picker, { target: { value: 'gpt-5.4' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'gpt-5.4' }))
  })

  it('preserves an unavailable saved value until the user chooses a valid model', () => {
    const onChange = vi.fn()
    render(
      <AgentModelPicker
        models={models}
        provider="openai-codex"
        value="retired-model"
        variant="settings"
        ariaLabel="Default agent model"
        onChange={onChange}
      />
    )

    expect(screen.getByRole('option', { name: 'Unavailable: retired-model' })).toBeDisabled()
    expect(screen.getByText(/saved model is unavailable/i)).toBeVisible()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blocks unverified custom models from becoming the default', () => {
    const onChange = vi.fn()
    render(
      <AgentModelPicker
        models={[{
          provider: 'custom:123e4567-e89b-42d3-a456-426614174000',
          id: 'custom-coder',
          name: 'Custom Coder',
          supportsThinking: false,
          verified: false
        }]}
        provider="custom:123e4567-e89b-42d3-a456-426614174000"
        value=""
        variant="settings"
        ariaLabel="Default agent model"
        onChange={onChange}
      />
    )

    expect(screen.getByRole('option', { name: 'Custom Coder (verify first)' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Default agent model'), {
      target: { value: 'custom-coder' }
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses an accessible searchable combobox for a large OpenRouter catalog', () => {
    const onChange = vi.fn()
    const largeCatalog: AgentModel[] = Array.from({ length: 90 }, (_, index) => ({
      provider: 'openrouter',
      id: `vendor/model-${index}`,
      name: `Vendor Model ${index}`,
      supportsThinking: index % 2 === 0,
      verified: true
    }))
    render(
      <AgentModelPicker
        models={largeCatalog}
        provider="openrouter"
        value="vendor/model-0"
        variant="settings"
        ariaLabel="Default agent model"
        onChange={onChange}
      />
    )

    const picker = screen.getByRole('combobox', { name: 'Default agent model' })
    fireEvent.change(picker, { target: { value: 'Model 89' } })
    fireEvent.click(screen.getByRole('option', { name: /Vendor Model 89/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'vendor/model-89' }))
  })
})
