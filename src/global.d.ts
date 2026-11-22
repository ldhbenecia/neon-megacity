// Globals shared by the app (src/) and the Node-side tooling (tests/e2e, scripts/).
export {};

declare global {
  interface Window {
    /** Readiness flag set every frame by main.ts; polled by e2e tests and the screenshot script. */
    __city?: { ready: boolean; frames: number };
  }
}
