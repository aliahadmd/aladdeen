import { z } from 'zod'
import {
  MAX_DOCUMENT_BYTES,
  MAX_SEARCH_DOCUMENT_BYTES
} from './limits'
import { THEME_PRESETS } from './contracts'
import {
  AI_MODES,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  AI_PROVIDERS,
  AI_REASONING_LEVELS
} from './ai'
import {
  READING_COLUMN_WIDTHS,
  READING_FONTS,
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN,
  READING_LINE_HEIGHTS,
  READING_SURFACES
} from './reading'

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
  themePreset: z.enum(THEME_PRESETS),
  sidebarWidth: z.number().int().min(248).max(420),
  sidebarCollapsed: z.boolean(),
  completedOnboardingVersion: z.number().int().min(0).max(1_000),
  aiPanelWidth: z.number().int().min(AI_PANEL_MIN_WIDTH).max(AI_PANEL_MAX_WIDTH),
  aiPanelCollapsed: z.boolean(),
  aiProvider: z.enum(AI_PROVIDERS),
  aiModelId: z.string().trim().max(200),
  aiReasoning: z.enum(AI_REASONING_LEVELS),
  aiMode: z.enum(AI_MODES),
  readingFont: z.enum(READING_FONTS),
  readingFontSize: z.number().int().min(READING_FONT_SIZE_MIN).max(READING_FONT_SIZE_MAX),
  readingLineHeight: z.enum(READING_LINE_HEIGHTS),
  readingColumnWidth: z.enum(READING_COLUMN_WIDTHS),
  readingSurface: z.enum(READING_SURFACES)
})

export const aiProviderSchema = z.enum(AI_PROVIDERS)

export const aiBaseUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => {
    if (value === '') return true
    try {
      const url = new URL(value)
      return (
        !url.username && !url.password && !url.search && !url.hash && !/\/+$/u.test(url.pathname)
      )
    } catch {
      return false
    }
  }, 'Enter a valid base URL without credentials, query parameters, or fragments.')

export const aiSetProfileSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: aiBaseUrlSchema,
  allowLocal: z.boolean(),
  manualModelId: z.string().trim().max(200)
})

export const aiSetApiKeySchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().min(1).max(4_096)
})

export const aiMentionedFileSchema = z.object({
  projectId: idSchema,
  relativePath: relativePathSchema,
  fileId: idSchema.optional()
})

export const aiSendSchema = z.object({
  sessionId: idSchema,
  content: z.string().min(1).max(200_000),
  mentionedFiles: z.array(aiMentionedFileSchema).max(24)
})

export const aiApproveSchema = z.object({
  requestId: idSchema,
  approved: z.boolean()
})

export const aiRenameSessionSchema = z.object({
  sessionId: idSchema,
  title: z.string().trim().min(1).max(120)
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
