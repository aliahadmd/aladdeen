import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { ANTHROPIC_DEFAULT_BASE_URL, AI_MODE_DESCRIPTIONS } from '@shared/ai'
import type {
  AiChatMessage,
  AiContentBlock,
  AiCredentialStatus,
  AiEvent,
  AiMentionedFile,
  AiModelInfo,
  AiMode,
  AiProvider,
  AiProviderProfileInfo,
  AiReasoning,
  AiSessionDetail,
  AiSessionSummary,
  AiToolName,
  AiToolUseBlock,
  AiUsageInfo
} from '@shared/ai'
import { IPC } from '@shared/contracts'
import { DesktopError } from '@main/errors'
import type { AppDatabase } from '@main/services/database'
import type { WorkspaceService } from '@main/services/workspace'
import { normalizeAiBaseUrl } from './endpoints'
import { fallbackModels, fetchProviderModels } from './models'
import {
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  createAnthropicFrameHandler,
  createOpenAiFrameHandler,
  extractProviderErrorMessage,
  readSseFrames
} from './providers'
import type { AiHttpRequest, AiProviderRequest, AiProviderTurn } from './providers'
import { AiSecretVault } from './secrets'
import { AiToolExecutor } from './tools'

const MAX_TURNS_PER_RUN = 16
const MAX_TOOL_RESULT_CHARS = 400_000
const STREAM_FIRST_BYTE_TIMEOUT_MS = 120_000

interface ActiveRun {
  abort: AbortController
  approvals: Map<string, (approved: boolean) => void>
}

export class AiService {
  private readonly vault: AiSecretVault
  private readonly tools: AiToolExecutor
  private readonly activeRuns = new Map<string, ActiveRun>()

  constructor(
    private readonly database: AppDatabase,
    private readonly workspace: WorkspaceService,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    this.vault = new AiSecretVault(database)
    this.tools = new AiToolExecutor(database, workspace)
  }

  credentialStatus(): AiCredentialStatus {
    return this.vault.credentialStatus()
  }

  setApiKey(provider: AiProvider, apiKey: string): void {
    this.vault.setApiKey(provider, apiKey)
  }

  clearApiKey(provider: AiProvider): void {
    this.vault.clearApiKey(provider)
  }

  getProfile(provider: AiProvider): AiProviderProfileInfo {
    const profile = this.database.getAiProfile(provider)
    return {
      provider,
      baseUrl: profile.baseUrl,
      allowLocal: profile.allowLocal,
      manualModelId: profile.manualModelId
    }
  }

  setProfile(provider: AiProvider, baseUrl: string, allowLocal: boolean, manualModelId: string): AiProviderProfileInfo {
    // Reachability (DNS/SSRF) is validated at request time; save time only
    // normalizes and applies the scheme policy so saving works offline.
    const normalized = normalizeAiBaseUrl(baseUrl, allowLocal)
    this.database.setAiProfile(provider, normalized, allowLocal, manualModelId)
    return { provider, baseUrl: normalized, allowLocal, manualModelId }
  }

  async listModels(provider: AiProvider): Promise<AiModelInfo[]> {
    const profile = this.database.getAiProfile(provider)
    const hasKey = this.vault.hasApiKey(provider)
    const baseUrl = this.resolveBaseUrl(provider, profile.baseUrl)
    try {
      const models = await fetchProviderModels(
        provider,
        baseUrl,
        hasKey ? this.vault.readApiKey(provider) : null
      )
      if (profile.manualModelId !== '' && !models.some((model) => model.id === profile.manualModelId)) {
        models.push({ provider, id: profile.manualModelId, label: profile.manualModelId })
      }
      if (models.length > 0) return models
    } catch {
      // Fall through to the offline catalog below.
    }
    return fallbackModels(provider, profile.manualModelId)
  }

  listSessions(): AiSessionSummary[] {
    return this.database.listAiSessions()
  }

  getSession(sessionId: string): AiSessionDetail {
    const session = this.database.getAiSession(sessionId)
    if (!session) throw new DesktopError('NOT_FOUND', 'That chat no longer exists.')
    return session
  }

  createSession(projectId: string | null): AiSessionDetail {
    const summary = this.database.createAiSession(randomUUID(), 'New chat', projectId)
    return { ...summary, messages: [] }
  }

  deleteSession(sessionId: string): void {
    const run = this.activeRuns.get(sessionId)
    if (run) throw new DesktopError('BUSY', 'Stop the current response before deleting this chat.')
    this.database.deleteAiSession(sessionId)
  }

  renameSession(sessionId: string, title: string): void {
    this.database.renameAiSession(sessionId, title)
  }

  send(sessionId: string, content: string, mentionedFiles: AiMentionedFile[]): { messageId: string } {
    if (this.activeRuns.has(sessionId)) {
      throw new DesktopError('BUSY', 'A response is already streaming in this chat.')
    }
    const session = this.database.getAiSession(sessionId)
    if (!session) throw new DesktopError('NOT_FOUND', 'That chat no longer exists.')

    const settings = this.database.getSettings()
    const userMessage: AiChatMessage = {
      id: randomUUID(),
      role: 'user',
      blocks: [{ type: 'text', text: content }],
      createdAt: Date.now()
    }
    this.database.appendAiMessage(sessionId, userMessage)
    if (session.title === 'New chat') {
      this.database.renameAiSession(sessionId, content.replace(/\s+/gu, ' ').trim().slice(0, 60) || 'New chat')
    }

    const assistantMessage: AiChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      blocks: [],
      createdAt: Date.now()
    }
    this.database.appendAiMessage(sessionId, assistantMessage)

    void this.runLoop(sessionId, assistantMessage.id, content, mentionedFiles, settings).catch(
      (error: unknown) => {
        const desktopError =
          error instanceof DesktopError
            ? error
            : new DesktopError('INTERNAL', error instanceof Error ? error.message : 'The AI run failed.')
        this.emit({ type: 'run-error', sessionId, code: desktopError.code, message: desktopError.message })
      }
    )
    return { messageId: assistantMessage.id }
  }

  approve(requestId: string, approved: boolean): void {
    for (const run of this.activeRuns.values()) {
      const resolve = run.approvals.get(requestId)
      if (resolve) {
        run.approvals.delete(requestId)
        resolve(approved)
        return
      }
    }
  }

  cancel(sessionId: string): void {
    const run = this.activeRuns.get(sessionId)
    if (!run) return
    for (const [, resolve] of run.approvals) resolve(false)
    run.approvals.clear()
    run.abort.abort()
  }

  dispose(): void {
    for (const [sessionId] of this.activeRuns) this.cancel(sessionId)
  }

  private async runLoop(
    sessionId: string,
    assistantMessageId: string,
    userContent: string,
    mentionedFiles: AiMentionedFile[],
    settings: { aiProvider: AiProvider; aiModelId: string; aiReasoning: AiReasoning; aiMode: AiMode }
  ): Promise<void> {
    const abort = new AbortController()
    const run: ActiveRun = { abort, approvals: new Map() }
    this.activeRuns.set(sessionId, run)
    this.emit({ type: 'run-started', sessionId, messageId: assistantMessageId })

    try {
      const contextText = await this.buildMentionedContext(mentionedFiles)
      const history = this.database.getAiSession(sessionId)!.messages
      const lastMessage = history[history.length - 1]
      const blocks = lastMessage?.blocks ?? []
      if (contextText !== '' && lastMessage) {
        blocks.splice(
          Math.max(0, blocks.findIndex((block) => block.type === 'text') + 1),
          0,
          { type: 'text', text: contextText }
        )
        lastMessage.blocks = blocks
      }

      let providerBlocks: AiContentBlock[] = []
      for (let turn = 0; turn < MAX_TURNS_PER_RUN; turn += 1) {
        const turns = this.canonicalTurns(history, providerBlocks)
        providerBlocks = await this.streamProviderTurn(
          sessionId,
          assistantMessageId,
          settings,
          turns,
          abort.signal
        )
        history.push({ id: assistantMessageId, role: 'assistant', blocks: providerBlocks, createdAt: Date.now() })

        const toolUses = providerBlocks.filter(
          (block): block is AiToolUseBlock => block.type === 'tool_use'
        )
        if (toolUses.length === 0 || abort.signal.aborted) break

        const results: AiContentBlock[] = []
        for (const toolUse of toolUses) {
          const outcome = await this.executeTool(sessionId, assistantMessageId, toolUse, settings.aiMode, run)
          results.push({
            type: 'tool_result',
            toolUseId: toolUse.id,
            content: outcome.content.slice(0, MAX_TOOL_RESULT_CHARS),
            isError: outcome.isError
          })
        }
        history.push({
          id: randomUUID(),
          role: 'user',
          blocks: results,
          createdAt: Date.now()
        })
        providerBlocks = []
      }

      if (abort.signal.aborted) this.emit({ type: 'run-cancelled', sessionId })
      else this.emit({ type: 'run-completed', sessionId, messageId: assistantMessageId })
    } finally {
      this.activeRuns.delete(sessionId)
    }
  }

  private canonicalTurns(
    history: AiChatMessage[],
    pendingAssistantBlocks: AiContentBlock[]
  ): AiProviderTurn[] {
    const turns: AiProviderTurn[] = []
    for (const message of history) {
      if (message.blocks.length === 0) continue
      turns.push({ role: message.role, blocks: message.blocks })
    }
    if (pendingAssistantBlocks.length > 0) {
      turns.push({ role: 'assistant', blocks: pendingAssistantBlocks })
    }
    return turns
  }

  private async streamProviderTurn(
    sessionId: string,
    messageId: string,
    settings: { aiProvider: AiProvider; aiModelId: string; aiReasoning: AiReasoning; aiMode: AiMode },
    turns: AiProviderTurn[],
    signal: AbortSignal
  ): Promise<AiContentBlock[]> {
    const provider = settings.aiProvider
    const profile = this.database.getAiProfile(provider)
    const baseUrl = this.resolveBaseUrl(provider, profile.baseUrl)
    const apiKey = this.vault.hasApiKey(provider) ? this.vault.readApiKey(provider) : ''
    const request: AiProviderRequest = {
      model: settings.aiModelId,
      system: this.systemPrompt(settings.aiMode),
      turns,
      tools: this.tools.toolsForMode(settings.aiMode),
      reasoning: settings.aiReasoning
    }
    const http = this.buildHttp(provider, request, baseUrl, apiKey)

    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(), STREAM_FIRST_BYTE_TIMEOUT_MS)
    const composedSignal = AbortSignal.any([signal, timeoutController.signal])

    const response = await fetch(http.url, {
      method: 'POST',
      headers: http.headers,
      body: http.body,
      signal: composedSignal
    })
    if (!response.ok || response.body === null) {
      clearTimeout(timeout)
      const payload = response.body === null ? '' : await response.text()
      throw extractProviderErrorMessage(response.status, payload)
    }

    const handler =
      provider === 'anthropic' ? createAnthropicFrameHandler() : createOpenAiFrameHandler()
    const blocks: AiContentBlock[] = []
    const toolInputs = new Map<number, { id: string; name: AiToolName; json: string }>()
    let usage: AiUsageInfo = { inputTokens: 0, outputTokens: 0 }

    const appendText = (kind: 'text' | 'thinking', text: string): void => {
      const last = blocks[blocks.length - 1]
      if (last && last.type === kind) {
        ;(last as { text: string }).text += text
      } else {
        blocks.push(kind === 'text' ? { type: 'text', text } : { type: 'thinking', text })
      }
    }

    try {
      for await (const frame of readSseFrames(response.body)) {
        clearTimeout(timeout)
        for (const chunk of handler(frame)) {
          switch (chunk.kind) {
            case 'thinking':
              appendText('thinking', chunk.text)
              this.emit({ type: 'thinking-delta', sessionId, messageId, delta: chunk.text })
              break
            case 'text':
              appendText('text', chunk.text)
              this.emit({ type: 'text-delta', sessionId, messageId, delta: chunk.text })
              break
            case 'tool-use': {
              const name = chunk.name as AiToolName
              if (!this.tools.toolsForMode(settings.aiMode).some((tool) => tool.name === name)) continue
              toolInputs.set(chunk.index, { id: chunk.id, name, json: '' })
              blocks.push({ type: 'tool_use', id: chunk.id, name, input: {} })
              break
            }
            case 'tool-input': {
              const entry = toolInputs.get(chunk.index)
              if (entry) entry.json += chunk.partialJson
              break
            }
            case 'usage':
              usage = {
                inputTokens: usage.inputTokens + chunk.inputTokens,
                outputTokens: usage.outputTokens + chunk.outputTokens
              }
              this.emit({ type: 'usage', sessionId, usage })
              break
            case 'finish':
              break
          }
        }
      }
    } catch (error) {
      if (signal.aborted || timeoutController.signal.aborted) {
        // Fall through: partial blocks are persisted and the run reports cancelled.
      } else if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes('fetch failed'))
      ) {
        throw new DesktopError('INTERNAL', 'The provider endpoint could not be reached.')
      } else {
        throw error
      }
    } finally {
      clearTimeout(timeout)
    }

    for (const [index, block] of blocks.entries()) {
      if (block.type !== 'tool_use') continue
      const entry = toolInputs.get(index)
      if (!entry) continue
      try {
        block.input = entry.json.trim() === '' ? {} : (JSON.parse(entry.json) as Record<string, unknown>)
      } catch {
        block.input = {}
      }
    }

    this.database.replaceAiMessage(sessionId, messageId, blocks)
    return blocks
  }

  private buildHttp(
    provider: AiProvider,
    request: AiProviderRequest,
    baseUrl: string,
    apiKey: string
  ): AiHttpRequest {
    return provider === 'anthropic'
      ? buildAnthropicRequest(request, baseUrl, apiKey)
      : buildOpenAiCompatibleRequest(request, baseUrl, apiKey)
  }

  private async executeTool(
    sessionId: string,
    messageId: string,
    toolUse: AiToolUseBlock,
    mode: AiMode,
    run: ActiveRun
  ): Promise<{ content: string; isError: boolean }> {
    if (this.tools.isWriteTool(toolUse.name) && mode === 'ask') {
      const requestId = randomUUID()
      const approved = await new Promise<boolean>((resolve) => {
        run.approvals.set(requestId, resolve)
        this.emit({
          type: 'approval-requested',
          sessionId,
          requestId,
          toolUseId: toolUse.id,
          name: toolUse.name,
          input: toolUse.input
        })
      })
      this.emit({ type: 'approval-resolved', sessionId, requestId, approved })
      if (!approved) {
        return { content: 'The user declined this change. Continue without modifying the file.', isError: false }
      }
    }

    this.emit({
      type: 'tool-started',
      sessionId,
      messageId,
      toolUseId: toolUse.id,
      name: toolUse.name,
      input: toolUse.input
    })
    const outcome = await this.tools.execute(toolUse.name, toolUse.input)
    this.emit({
      type: 'tool-finished',
      sessionId,
      messageId,
      toolUseId: toolUse.id,
      summary: summarizeToolResult(outcome),
      isError: outcome.isError
    })
    return outcome
  }

  private async buildMentionedContext(mentionedFiles: AiMentionedFile[]): Promise<string> {
    if (mentionedFiles.length === 0) return ''
    const sections: string[] = []
    for (const mention of mentionedFiles.slice(0, 24)) {
      try {
        const outcome = await this.tools.execute('read_file', {
          project_id: mention.projectId,
          relative_path: mention.relativePath
        })
        sections.push(`<file path="${mention.relativePath}">\n${outcome.content}\n</file>`)
      } catch {
        sections.push(
          `<file path="${mention.relativePath}">\nThe file could not be read.\n</file>`
        )
      }
    }
    return `The user attached these files to the message:\n\n${sections.join('\n\n')}`
  }

  private systemPrompt(mode: AiMode): string {
    const project = this.activeProjectSummary()
    return [
      'You are Aladdeen\'s research assistant, embedded in a private, offline-first research workspace for Markdown, HTML, DOCX, PDF, XLSX, and PPTX documents.',
      'The user\'s files stay on their machine. Be precise, cite file paths when referencing documents, and prefer reading a file before making claims about its contents.',
      'When writing files, always pass the sha256 revision from your most recent read_file so external edits are detected.',
      `Current tool policy — ${mode}: ${AI_MODE_DESCRIPTIONS[mode]}`,
      project,
      `Today's date is ${new Date().toISOString().slice(0, 10)}.`
    ].join('\n\n')
  }

  private activeProjectSummary(): string {
    try {
      const projects = this.database.listProjects(this.database.getActiveEnvironmentId() ?? '')
      if (projects.length === 0) return ''
      return `Workspace projects: ${projects.map((project) => project.name).join(', ')}.`
    } catch {
      return ''
    }
  }

  private resolveBaseUrl(provider: AiProvider, configuredBaseUrl: string): string {
    if (provider === 'anthropic') return configuredBaseUrl !== '' ? configuredBaseUrl : ANTHROPIC_DEFAULT_BASE_URL
    if (configuredBaseUrl === '') {
      throw new DesktopError(
        'VALIDATION_FAILED',
        'Set a base URL for the OpenAI-compatible provider in Settings → AI.'
      )
    }
    return configuredBaseUrl
  }

  private emit(event: AiEvent): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC.aiEvent, event)
  }
}

function summarizeToolResult(outcome: { content: string; isError: boolean }): string {
  const firstLine = outcome.content.split('\n', 1)[0] ?? ''
  return firstLine.slice(0, 160)
}
