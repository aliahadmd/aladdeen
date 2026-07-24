/// <reference types="vite/client" />

import type { AladdeenApi } from '@shared/contracts'

declare global {
  interface Window {
    aladdeen: AladdeenApi
  }
}

export {}
