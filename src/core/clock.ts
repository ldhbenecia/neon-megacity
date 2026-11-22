// HUD clock formatting for env.timeOfDay.

/** Minutes since midnight (0..1439) for a time of day; wraps so 1.0 is 00:00, not 24:00. */
export function clockMinutes(timeOfDay: number): number {
  const t = ((timeOfDay % 1) + 1) % 1;
  return Math.floor(t * 24 * 60);
}

/** "HH:MM" for minutes since midnight. */
export function formatClock(minutes: number): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}
