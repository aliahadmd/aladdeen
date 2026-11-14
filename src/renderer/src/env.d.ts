/// <reference types="vite/client" />

import type { LiResearchApi } from '@shared/contracts'

declare global {
  interface Window {
    liresearch: LiResearchApi
  }
}

export {}
