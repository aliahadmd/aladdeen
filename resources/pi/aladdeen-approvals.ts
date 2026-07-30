import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const GUARDED_TOOLS = new Set(['write', 'edit', 'bash'])

export default function aladdeenApprovals(pi: ExtensionAPI): void {
  const alwaysAllowed = new Set<string>()

  pi.on('tool_call', async (event, ctx) => {
    if (!GUARDED_TOOLS.has(event.toolName) || alwaysAllowed.has(event.toolName)) return undefined
    if (!ctx.hasUI) {
      return { block: true, reason: `${event.toolName} requires approval in Aladdeen.` }
    }

    const request = JSON.stringify({
      kind: 'aladdeen-approval',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input
    })
    const decision = await ctx.ui.select(request, ['allow', 'allow-always', 'deny'])
    if (decision === 'allow-always') {
      alwaysAllowed.add(event.toolName)
      return undefined
    }
    if (decision === 'allow') return undefined
    return { block: true, reason: `The user denied the ${event.toolName} tool call.` }
  })
}
