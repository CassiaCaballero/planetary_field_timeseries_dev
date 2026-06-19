/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK: string
  readonly VITE_PC_STAC_BASE?: string
  readonly VITE_PC_TILER_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
