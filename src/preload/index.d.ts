import type { CardexApi } from './index'

declare global {
  interface Window {
    api: CardexApi
  }
}

export {}
