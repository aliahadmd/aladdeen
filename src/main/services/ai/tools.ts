import { DesktopError } from '@main/errors'
import type { AppDatabase } from '@main/services/database'
import type { WorkspaceService } from '@main/services/workspace'
import type { AiMode, AiToolName } from '@shared/ai'
import { isTextDocumentKind } from '@shared/documents'
import { z } from 'zod'

export const AI_TOOL_DEFINITIONS = [
  {
    name: 'list_files' as const,
    description:
      'List every indexed file of a project. Returns relative paths with document kinds and sizes.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project to list files from.' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'read_file' as const,
    description:
      'Read a text document (Markdown, HTML) from a project. Returns the full content and a sha256 revision that write_file requires to guard against external edits.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        relative_path: { type: 'string', description: 'Path relative to the project root.' }
      },
      required: ['project_id', 'relative_path']
    }
  },
  {
    name: 'write_file' as const,
    description:
      'Create or overwrite a text document in a project with full content. Pass the sha256 returned by read_file as expected_revision_sha256, or the literal "new" to create a file that does not exist yet. The write is rejected when the file changed since it was read.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        relative_path: { type: 'string' },
        content: { type: 'string' },
        expected_revision_sha256: { type: 'string' }
      },
      required: ['project_id', 'relative_path', 'content', 'expected_revision_sha256']
    }
  }
] satisfies ReadonlyArray<{ name: AiToolName; description: string; inputSchema: Record<string, unknown> }>

const listFilesSchema = z.object({ project_id: z.string().uuid() })
const readFileSchema = z.object({
  project_id: z.string().uuid(),
  relative_path: z.string().min(1).max(1_000)
})
const writeFileSchema = z.object({
  project_id: z.string().uuid(),
  relative_path: z.string().min(1).max(1_000),
  content: z.string().max(20 * 1024 * 1024),
  expected_revision_sha256: z.string().min(4).max(64)
})

export class AiToolError extends DesktopError {}

export interface AiToolOutcome {
  content: string
  isError: boolean
}

export class AiToolExecutor {
  constructor(
    private readonly database: AppDatabase,
    private readonly workspace: WorkspaceService
  ) {}

  toolsForMode(mode: AiMode): typeof AI_TOOL_DEFINITIONS {
    if (mode === 'plan') return AI_TOOL_DEFINITIONS.filter((tool) => tool.name !== 'write_file')
    return AI_TOOL_DEFINITIONS
  }

  isWriteTool(name: AiToolName): boolean {
    return name === 'write_file'
  }

  async execute(name: AiToolName, rawInput: unknown): Promise<AiToolOutcome> {
    try {
      switch (name) {
        case 'list_files':
          return this.listFiles(listFilesSchema.parse(rawInput).project_id)
        case 'read_file':
          return await this.readFile(readFileSchema.parse(rawInput))
        case 'write_file':
          return await this.writeFile(writeFileSchema.parse(rawInput))
      }
    } catch (error) {
      if (error instanceof DesktopError) {
        return { content: `Error: ${error.message}`, isError: true }
      }
      if (error instanceof z.ZodError) {
        return { content: `Error: invalid tool input. ${z.prettifyError(error)}`, isError: true }
      }
      throw error
    }
  }

  private listFiles(projectId: string): AiToolOutcome {
    const project = this.database.getProject(projectId)
    if (!project) throw new AiToolError('NOT_FOUND', 'That project does not exist.')
    const files = this.database.listProjectIndex(projectId)
    if (files.length === 0) return { content: 'No indexed files in this project.', isError: false }
    const lines = files
      .slice(0, 2_000)
      .map(
        (file) =>
          `${file.relativePath} (${file.documentKind}, ${file.size} bytes${
            file.size > 1024 * 1024 ? ', large' : ''
          })`
      )
    const suffix = files.length > 2_000 ? `\n… and ${files.length - 2_000} more` : ''
    return { content: `Project "${project.name}" — ${files.length} files:\n${lines.join('\n')}${suffix}`, isError: false }
  }

  private async readFile(input: { project_id: string; relative_path: string }): Promise<AiToolOutcome> {
    const snapshot = await this.workspace.openDocument({
      kind: 'project',
      projectId: input.project_id,
      relativePath: input.relative_path
    })
    if (snapshot.documentKind !== undefined && !isTextDocumentKind(snapshot.documentKind)) {
      const size = 'size' in snapshot ? snapshot.size : undefined
      return {
        content: [
          `${input.relative_path} is a binary ${snapshot.documentKind.toUpperCase()} document (${size ?? 'unknown'} bytes).`,
          'Text extraction for binary documents is not available to tools yet. Ask the user to open it in a tab, or work with its metadata.'
        ].join(' '),
        isError: false
      }
    }
    if (!('content' in snapshot) || typeof snapshot.content !== 'string') {
      throw new AiToolError('INTERNAL', 'The document could not be read as text.')
    }
    const content =
      snapshot.content.length > 400_000
        ? `${snapshot.content.slice(0, 400_000)}\n\n[Truncated: the file is ${snapshot.content.length} characters.]`
        : snapshot.content
    return {
      content: `${input.relative_path} (revision sha256 ${snapshot.revision.sha256}):\n\n${content}`,
      isError: false
    }
  }

  private async writeFile(input: {
    project_id: string
    relative_path: string
    content: string
    expected_revision_sha256: string
  }): Promise<AiToolOutcome> {
    let snapshot
    try {
      snapshot = await this.workspace.openDocument({
        kind: 'project',
        projectId: input.project_id,
        relativePath: input.relative_path
      })
    } catch (error) {
      if (error instanceof DesktopError && error.code === 'NOT_FOUND') snapshot = null
      else throw error
    }

    if (input.expected_revision_sha256 === 'new') {
      if (snapshot) {
        return {
          content: `Error: ${input.relative_path} already exists (revision ${snapshot.revision.sha256}). Re-read it and pass its sha256.`,
          isError: true
        }
      }
      const { parentPath, name } = splitRelativePath(input.relative_path)
      const created = await this.workspace.createEntry({ projectId: input.project_id, parentPath, name })
      if (!('content' in created) || typeof created.content !== 'string') {
        throw new AiToolError('INVALID_FILE', 'Only text documents can be written by the AI.')
      }
      const saved = await this.workspace.saveDocument({
        fileId: created.id,
        content: input.content,
        expectedRevision: created.revision
      })
      return { content: `Created ${input.relative_path} (revision ${saved.sha256}).`, isError: false }
    }

    if (!snapshot) {
      return {
        content: 'Error: the file does not exist. Pass "new" as expected_revision_sha256 to create it.',
        isError: true
      }
    }
    if (snapshot.revision.sha256 !== input.expected_revision_sha256) {
      return {
        content: `Error: ${input.relative_path} changed since it was read (current revision ${snapshot.revision.sha256}). Re-read the file before writing.`,
        isError: true
      }
    }
    const saved = await this.workspace.saveDocument({
      fileId: snapshot.id,
      content: input.content,
      expectedRevision: snapshot.revision
    })
    return { content: `Wrote ${input.relative_path} (revision ${saved.sha256}).`, isError: false }
  }
}

function splitRelativePath(relativePath: string): { parentPath: string; name: string } {
  const index = relativePath.lastIndexOf('/')
  return index === -1
    ? { parentPath: '', name: relativePath }
    : { parentPath: relativePath.slice(0, index), name: relativePath.slice(index + 1) }
}
