/// <reference types="vite/client" />

import type { FluidMdApi } from '@shared/contracts'

declare global {
  interface Window {
    fluidmd: FluidMdApi
  }
}

export {}
