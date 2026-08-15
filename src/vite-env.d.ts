/// <reference types="vite/client" />

/** 构建期由 vite.config.ts 注入的 package.json 版本号。 */
declare const __APP_VERSION__: string;

interface Window {
  __TAURI_INTERNALS__?: unknown;
}
