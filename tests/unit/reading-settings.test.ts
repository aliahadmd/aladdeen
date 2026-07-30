import { describe, expect, it } from 'vitest'
import { settingsSchema } from '@shared/schemas'
import { DEFAULT_READING_SETTINGS } from '@shared/reading'

const baseSettings = {
  theme: 'system' as const,
  accent: 'indigo' as const,
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

describe('reading settings validation', () => {
  it('accepts the recommended defaults and font-size boundaries', () => {
    expect(settingsSchema.parse(baseSettings)).toEqual(baseSettings)
    expect(settingsSchema.safeParse({ ...baseSettings, readingFontSize: 14 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...baseSettings, readingFontSize: 24 }).success).toBe(true)
  })

  it('rejects unsupported fonts, surfaces, and out-of-range sizes', () => {
    expect(settingsSchema.safeParse({ ...baseSettings, readingFont: 'remote' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...baseSettings, readingSurface: '#ffffff' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...baseSettings, readingFontSize: 13 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...baseSettings, readingFontSize: 25 }).success).toBe(false)
  })
})
