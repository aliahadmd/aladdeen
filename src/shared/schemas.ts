import { z } from 'zod'

export const idSchema = z.string().uuid()

export const relativePathSchema = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains an invalid character')

export const environmentNameSchema = z.string().trim().min(1).max(60)

export const fileRevisionSchema = z.object({
  mtimeMs: z.number().finite().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  lineEnding: z.enum(['LF', 'CRLF']),
  hasBom: z.boolean()
})

export const documentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: idSchema, relativePath: relativePathSchema }),
  z.object({ kind: z.literal('tracked'), fileId: idSchema })
])

const globalSearchScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('environment') }),
  z.object({ kind: z.literal('project'), projectId: idSchema }),
  z.object({ kind: z.literal('standalone') })
])

export const globalSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500)
    .refine((value) => !/[\0\r\n]/.test(value), 'Search contains an invalid character'),
  matchCase: z.boolean(),
  wholeWord: z.boolean(),
  scope: globalSearchScopeSchema,
  bufferOverrides: z.array(z.object({
    fileId: idSchema,
    content: z.string().max(10 * 1024 * 1024)
  })).max(100)
}).superRefine((value, context) => {
  const totalCharacters = value.bufferOverrides.reduce((total, override) => total + override.content.length, 0)
  if (totalCharacters > 64 * 1024 * 1024) {
    context.addIssue({
      code: 'custom',
      path: ['bufferOverrides'],
      message: 'Open search buffers are too large.'
    })
  }
})

export const saveDocumentSchema = z.object({
  fileId: idSchema,
  content: z.string().max(20_000_000),
  expectedRevision: fileRevisionSchema,
  force: z.boolean().optional()
})

export const createEntrySchema = z.object({
  projectId: idSchema,
  parentPath: relativePathSchema,
  name: z.string().trim().min(1).max(255)
})

export const renameEntrySchema = z.object({
  projectId: idSchema,
  path: relativePathSchema,
  newName: z.string().trim().min(1).max(255)
})

export const environmentStateSchema = z.object({
  openFileIds: z.array(idSchema).max(100),
  activeFileId: idSchema.optional()
})

const projectScopeModeSchema = z.enum(['all', 'selected'])
const projectIncludePathsSchema = z.array(relativePathSchema).max(20_000)
const projectExcludePatternsSchema = z
  .array(z.string().trim().min(1).max(500).refine((value) => !value.includes('\0'), 'Pattern contains an invalid character'))
  .max(200)

export const projectImportSelectionSchema = z.object({
  token: idSchema,
  scopeMode: projectScopeModeSchema,
  includePaths: projectIncludePathsSchema,
  excludePatterns: projectExcludePatternsSchema,
  groupName: z.string().trim().max(60).optional(),
  pinned: z.boolean()
}).refine((value) => value.scopeMode === 'all' || value.includePaths.length > 0, {
  message: 'Choose at least one folder or Markdown file for a selective project.'
})

export const updateProjectSchema = z.object({
  projectId: idSchema,
  scopeMode: projectScopeModeSchema,
  includePaths: projectIncludePathsSchema,
  excludePatterns: projectExcludePatternsSchema,
  groupName: z.string().trim().max(60).optional(),
  pinned: z.boolean(),
  archived: z.boolean()
}).refine((value) => value.scopeMode === 'all' || value.includePaths.length > 0, {
  message: 'Choose at least one folder or Markdown file for a selective project.'
})

export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  accent: z.enum(['indigo', 'blue', 'emerald', 'amber', 'rose']),
  sidebarWidth: z.number().int().min(248).max(420),
  sidebarCollapsed: z.boolean()
})

export const exportRequestSchema = z.object({
  fileId: idSchema,
  title: z.string().trim().min(1).max(255),
  content: z.string().max(20_000_000),
  format: z.enum(['pdf', 'docx'])
})

export const externalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  }, 'Only HTTP(S) and mail links can be opened')
