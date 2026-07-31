import { z } from 'zod'
import {
  MAX_DOCUMENT_BYTES,
  MAX_SEARCH_DOCUMENT_BYTES
} from './limits'
import {
  READING_COLUMN_WIDTHS,
  READING_FONTS,
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN,
  READING_LINE_HEIGHTS,
  READING_SURFACES
} from './reading'
import { isCustomAgentProviderId, isLegacyCustomAgentProvider } from './agent-providers'

const searchBufferSchema = z.string()
  .max(MAX_SEARCH_DOCUMENT_BYTES)
  .refine(
    (content) => Buffer.byteLength(content, 'utf8') <= MAX_SEARCH_DOCUMENT_BYTES,
    'Search buffer exceeds the 10 MiB limit.'
  )

export const documentContentSchema = z.string()
  .max(MAX_DOCUMENT_BYTES)
  .refine(
    (content) => Buffer.byteLength(content, 'utf8') <= MAX_DOCUMENT_BYTES,
    'Document exceeds the 20 MiB limit.'
  )

export const idSchema = z.string().uuid()
export const agentProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/, 'Invalid agent provider ID')
  .refine((value) => !isCustomAgentProviderId(value), 'Custom endpoints are no longer supported')
export const legacyAgentProviderSchema = z
  .string()
  .trim()
  .refine(isLegacyCustomAgentProvider, 'Invalid legacy custom provider ID')

export const relativePathSchema = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains an invalid character')

export const environmentNameSchema = z.string().trim().min(1).max(60)

export const fileRevisionSchema = z.object({
  mtimeMs: z.number().finite().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  lineEnding: z.enum(['LF', 'CRLF']).optional(),
  hasBom: z.boolean().optional()
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
  bufferOverrides: z.array(z.discriminatedUnion('kind', [
    z.object({
      fileId: idSchema,
      kind: z.literal('text'),
      content: searchBufferSchema
    }),
    z.object({
      fileId: idSchema,
      kind: z.literal('spreadsheet'),
      cells: z.array(z.object({
        sheetName: z.string().min(1).max(31),
        address: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
        row: z.number().int().min(1).max(1_048_576),
        column: z.number().int().min(1).max(16_384),
        value: z.string().max(32_768),
        formula: z.string().max(8_192).optional()
      })).max(200_000)
    }),
    z.object({
      fileId: idSchema,
      kind: z.literal('presentation'),
      entries: z.array(z.object({
        slideIndex: z.number().int().min(0).max(1_999),
        slideNumber: z.number().int().min(1).max(2_000),
        slideId: z.string().min(1).max(255).optional(),
        elementId: z.string().min(1).max(255).optional(),
        elementName: z.string().max(1_024).optional(),
        source: z.enum(['slide', 'notes']),
        text: z.string().max(32_768)
      })).max(500_000)
    })
  ])).max(100)
}).superRefine((value, context) => {
  const totalBytes = value.bufferOverrides.reduce(
    (total, override) => total + Buffer.byteLength(
      override.kind === 'text'
        ? override.content
        : JSON.stringify(override.kind === 'spreadsheet' ? override.cells : override.entries),
      'utf8'
    ),
    0
  )
  if (totalBytes > 64 * 1024 * 1024) {
    context.addIssue({
      code: 'custom',
      path: ['bufferOverrides'],
      message: 'Open search buffers are too large.'
    })
  }
})

export const saveDocumentSchema = z.object({
  fileId: idSchema,
  content: documentContentSchema,
  expectedRevision: fileRevisionSchema,
  force: z.boolean().optional()
})

export const createEntrySchema = z.object({
  projectId: idSchema,
  parentPath: relativePathSchema,
  name: z.string().trim().min(1).max(255),
  documentKind: z.enum(['markdown', 'html', 'docx', 'xlsx', 'pptx']).optional()
})

export const createStandaloneDocumentSchema = z.object({
  documentKind: z.enum(['markdown', 'html', 'docx', 'xlsx', 'pptx'])
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
const projectDocumentKindSchema = z.enum(['markdown', 'html', 'docx', 'pdf', 'xlsx', 'pptx'])
const enabledDocumentKindsSchema = z
  .array(projectDocumentKindSchema)
  .min(1, 'Choose at least one document type.')
  .max(6)
  .refine((kinds) => new Set(kinds).size === kinds.length, 'Document types must be unique.')
const projectIncludePathsSchema = z.array(relativePathSchema).max(20_000)
const projectExcludePatternsSchema = z
  .array(z.string().trim().min(1).max(500).refine((value) => !value.includes('\0'), 'Pattern contains an invalid character'))
  .max(200)

export const projectImportSelectionSchema = z.object({
  token: idSchema,
  scopeMode: projectScopeModeSchema,
  includePaths: projectIncludePathsSchema,
  excludePatterns: projectExcludePatternsSchema,
  enabledDocumentKinds: enabledDocumentKindsSchema,
  groupName: z.string().trim().max(60).optional(),
  pinned: z.boolean()
}).refine((value) => value.scopeMode === 'all' || value.includePaths.length > 0, {
  message: 'Choose at least one folder or document for a selective project.'
})

export const updateProjectSchema = z.object({
  projectId: idSchema,
  scopeMode: projectScopeModeSchema,
  includePaths: projectIncludePathsSchema,
  excludePatterns: projectExcludePatternsSchema,
  enabledDocumentKinds: enabledDocumentKindsSchema,
  groupName: z.string().trim().max(60).optional(),
  pinned: z.boolean(),
  archived: z.boolean()
}).refine((value) => value.scopeMode === 'all' || value.includePaths.length > 0, {
  message: 'Choose at least one folder or document for a selective project.'
})

export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  accent: z.enum(['indigo', 'blue', 'emerald', 'amber', 'rose']),
  sidebarWidth: z.number().int().min(248).max(420),
  sidebarCollapsed: z.boolean(),
  completedOnboardingVersion: z.number().int().min(0).max(1_000),
  agentEnabled: z.boolean(),
  agentProvider: agentProviderSchema,
  agentModelId: z.string().trim().max(200),
  agentThinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  agentPanelWidth: z.number().int().min(300).max(560),
  agentPanelCollapsed: z.boolean(),
  readingFont: z.enum(READING_FONTS),
  readingFontSize: z.number().int().min(READING_FONT_SIZE_MIN).max(READING_FONT_SIZE_MAX),
  readingLineHeight: z.enum(READING_LINE_HEIGHTS),
  readingColumnWidth: z.enum(READING_COLUMN_WIDTHS),
  readingSurface: z.enum(READING_SURFACES)
})

export const agentThinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export const agentAuthTypeSchema = z.enum(['oauth', 'api_key'])
export const agentStartSessionSchema = z.object({ projectId: idSchema })
export const agentSessionSchema = z.object({ sessionId: idSchema })
export const agentPromptSchema = z.object({
  sessionId: idSchema,
  message: z.string().trim().min(1).max(200_000),
  steer: z.boolean().optional()
})
export const agentApprovalResponseSchema = z.object({
  sessionId: idSchema,
  requestId: z.string().min(1).max(200),
  decision: z.enum(['allow', 'allow-always', 'deny'])
})
export const agentModelRequestSchema = z.object({
  sessionId: idSchema,
  provider: agentProviderSchema,
  modelId: z.string().trim().min(1).max(200)
})
export const agentThinkingRequestSchema = z.object({
  sessionId: idSchema,
  level: agentThinkingLevelSchema
})
export const agentBeginLoginSchema = z.object({
  providerId: agentProviderSchema,
  authType: agentAuthTypeSchema.optional().default('oauth')
})
export const agentLoginPromptResponseSchema = z.object({
  attemptId: idSchema,
  promptId: idSchema,
  value: z.string().max(16_384)
})

export const exportRequestSchema = z.object({
  fileId: idSchema,
  title: z.string().trim().min(1).max(255),
  content: documentContentSchema,
  format: z.enum(['pdf', 'docx'])
})

export const saveBinaryDocumentSchema = z.object({
  requestId: idSchema,
  fileId: idSchema,
  expectedRevision: fileRevisionSchema,
  byteLength: z.number().int().positive().max(512 * 1024 * 1024),
  force: z.boolean().optional(),
  saveAs: z.boolean().optional()
})

export const externalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  }, 'Only HTTP(S) and mail links can be opened')
