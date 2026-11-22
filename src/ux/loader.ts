// Boot loader placeholder (ART_DIRECTION 9). The ux module replaces this with the
// #boot skeleton, weighted progress bar, stage log and the "power on" fade.
// main.ts already reports every boot stage through this interface, so ux only edits src/ux/.

export interface Loader {
  /** A boot stage starts. `weight` is its share of the progress bar (all stages sum to 100). */
  stage(name: string, weight: number): void;
  /** Every stage finished and the first frame is about to render. */
  done(): void;
  /** A stage threw; show it, keep the stack in the console. */
  fail(stage: string, err: unknown): void;
}

export function createLoader(): Loader {
  return {
    stage() {},
    done() {},
    fail(stage, err) {
      console.error(`[boot] ${stage} failed`, err);
    },
  };
}
