/// <reference types="vite/client" />

/**
 * Which source built this bundle, injected at build time. Reported in the UI
 * and at the top of every diagnostic report, so a report never has to have its
 * build guessed at from which sections it happens to contain.
 */
declare const __BUILD_ID__: string;
