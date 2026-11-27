// City worker: generates the layout off the main thread (docs/PERF.md "async boot", phase 1).
// It imports the generator only, so the layout module's live binding stays a main-thread concern.
import { generateLayout } from './generate';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  postMessage(generateLayout(e.data.seed));
};
