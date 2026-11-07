/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { VcaApi } from './app/storage/electron';

declare global {
  interface Window {
    vca?: VcaApi;
  }
}

export {};
