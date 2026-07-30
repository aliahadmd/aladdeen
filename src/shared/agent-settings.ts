import type { AppSettings } from './contracts'

export function agentSessionMustStopForSettingsChange(
  previous: AppSettings,
  next: AppSettings
): boolean {
  return !next.agentEnabled || previous.agentProvider !== next.agentProvider
}
