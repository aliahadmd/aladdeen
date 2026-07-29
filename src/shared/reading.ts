export const READING_FONTS = ['system', 'avenir', 'iowan', 'georgia'] as const
export const READING_LINE_HEIGHTS = ['compact', 'comfortable', 'relaxed'] as const
export const READING_COLUMN_WIDTHS = ['narrow', 'comfortable', 'wide'] as const
export const READING_SURFACES = ['default', 'paper', 'sage', 'slate'] as const

export type ReadingFont = (typeof READING_FONTS)[number]
export type ReadingLineHeight = (typeof READING_LINE_HEIGHTS)[number]
export type ReadingColumnWidth = (typeof READING_COLUMN_WIDTHS)[number]
export type ReadingSurface = (typeof READING_SURFACES)[number]

export interface ReadingSettings {
  readingFont: ReadingFont
  readingFontSize: number
  readingLineHeight: ReadingLineHeight
  readingColumnWidth: ReadingColumnWidth
  readingSurface: ReadingSurface
}

export const READING_FONT_SIZE_MIN = 14
export const READING_FONT_SIZE_MAX = 24

export const DEFAULT_READING_SETTINGS: Readonly<ReadingSettings> = {
  readingFont: 'system',
  readingFontSize: 16,
  readingLineHeight: 'comfortable',
  readingColumnWidth: 'comfortable',
  readingSurface: 'default'
}

export const READING_LINE_HEIGHT_VALUES: Record<ReadingLineHeight, number> = {
  compact: 1.55,
  comfortable: 1.72,
  relaxed: 1.9
}

export const READING_COLUMN_WIDTH_VALUES: Record<ReadingColumnWidth, number> = {
  narrow: 620,
  comfortable: 720,
  wide: 960
}
