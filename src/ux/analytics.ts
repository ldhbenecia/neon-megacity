// Anonymous visit statistics (Google Analytics 4). Off unless the build sets VITE_GA_ID, and never
// on localhost, previews, automation, ?debug/?notrack, Do Not Track or the panel opt-out.

/** Visitor opt-out, set from the control panel ("방문 통계 보내기"). */
export const ANALYTICS_STORAGE_KEY = 'hangang.analytics';

/** The deployed site; a copy of this build on another host must not report into the same id. */
export const PAGES_HOST = 'ldhbenecia.github.io';

export interface LoadContext {
  id: string | undefined;
  hostname: string;
  search: string;
  webdriver: boolean;
  /** Do Not Track or Global Privacy Control. */
  doNotTrack: boolean;
  optedOut: boolean;
}

/** Only the deployed Pages site counts; previews, local servers and copies would skew the numbers. */
export function shouldLoad(c: LoadContext): boolean {
  if (!c.id || !/^G-[A-Z0-9]{4,}$/.test(c.id)) return false;
  if (c.hostname !== PAGES_HOST) return false;
  const q = new URLSearchParams(c.search);
  if (q.has('debug') || q.has('notrack') || q.get('quality') === 'ci') return false;
  return !c.webdriver && !c.doNotTrack && !c.optedOut;
}

export function readOptOut(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(ANALYTICS_STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

/**
 * The only events and parameters ever sent. Values are names from the app (preset and zone names,
 * modes, coarse buckets), never coordinates, ids of people or free text.
 */
const EVENTS = {
  boot_result: { result: ['ready', 'error'], ready_bucket: ['<2s', '2-5s', '5-10s', '>10s'] },
  quality_tier: { tier: ['high', 'medium', 'low'] },
  preset_used: { preset: null },
  district_used: { district: null },
  mode_entered: { mode: ['fly', 'cinematic'] },
} as const satisfies Record<string, Record<string, readonly string[] | null>>;

export type AnalyticsEvent = keyof typeof EVENTS;

/** Allow-listed copy of an event's parameters, or null when the event is not on the list. */
export function cleanEvent(
  name: string,
  params: Record<string, string>,
): Record<string, string> | null {
  if (!Object.hasOwn(EVENTS, name)) return null;
  const spec = EVENTS[name as AnalyticsEvent] as Record<string, readonly string[] | null>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!Object.hasOwn(spec, key) || typeof value !== 'string') continue;
    const allowed = spec[key];
    // Open values are app labels (preset or zone names): short, no control characters.
    if (allowed ? allowed.includes(value) : /^[^\p{C}]{1,40}$/u.test(value)) out[key] = value;
  }
  return out;
}

export function readyBucket(ms: number): string {
  return ms < 2000 ? '<2s' : ms < 5000 ? '2-5s' : ms < 10000 ? '5-10s' : '>10s';
}

type Gtag = (...args: unknown[]) => void;
interface GaWindow {
  dataLayer?: unknown[];
  gtag?: Gtag;
  [disable: `ga-disable-${string}`]: boolean | undefined;
}

let id: string | null = null;
let enabled = false;
// The panel choice for this visit; storage may be blocked, so it is never re-read from there.
let optedOut = false;
const pending: [AnalyticsEvent, Record<string, string>][] = [];

const win = (): GaWindow => window as unknown as GaWindow;

function send(name: AnalyticsEvent, params: Record<string, string>): void {
  const clean = cleanEvent(name, params);
  if (clean) win().gtag?.('event', name, clean);
}

/** Records an event; dropped unless analytics started, queued until the tag is set up. */
export function track(name: AnalyticsEvent, params: Record<string, string>): void {
  if (!enabled) return;
  if (id === null) pending.push([name, params]);
  else send(name, params);
}

/**
 * Called once the city is ready. Decides whether to measure at all and, if so, loads gtag.js when
 * the page is idle so the first frames never wait on it.
 */
export function startAnalytics(
  boot: { result: 'ready' | 'error'; readyMs: number },
  gaId = buildId(),
): void {
  const ctx: LoadContext = {
    id: gaId,
    hostname: location.hostname,
    search: location.search,
    webdriver: navigator.webdriver,
    doNotTrack: privacySignal(),
    optedOut: readOptOut(storage()),
  };
  optedOut = ctx.optedOut;
  const on = Boolean(gaId) && shouldLoad(ctx);
  document.documentElement.dataset.analytics = on ? 'on' : 'off';
  if (!gaId || !on) return;
  enabled = true;
  track('boot_result', { result: boot.result, ready_bucket: readyBucket(boot.readyMs) });
  const load = (): void => {
    // Turned off in the panel before the idle callback ran: load nothing at all.
    if (!enabled || optedOut) return;
    const w = win();
    // Google's disable flag has to be in place before the first gtag() call.
    w[`ga-disable-${gaId}`] = false;
    w.dataLayer = w.dataLayer ?? [];
    // gtag.js reads arguments objects from dataLayer, not arrays.
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer?.push(arguments);
    };
    w.gtag('js', new Date());
    w.gtag('config', gaId, configParams(location));
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    // A blocked or failed load only means no statistics.
    s.onerror = () => {
      enabled = false;
    };
    document.head.append(s);
    id = gaId;
    for (const [name, params] of pending.splice(0)) send(name, params);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
}

/**
 * gtag config: no ad features, and the page_view carries the page without its query or referrer
 * (?pose=, ?district= and the like would otherwise bypass the event allow-list).
 */
export function configParams(loc: Pick<Location, 'origin' | 'pathname'>): Record<string, unknown> {
  return {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: loc.origin + loc.pathname,
    page_referrer: '',
  };
}

/** The panel toggle: stored, and applied at once through Google's documented disable flag. */
export function setAnalyticsOptOut(off: boolean, gaId = buildId()): void {
  try {
    storage()?.setItem(ANALYTICS_STORAGE_KEY, off ? 'off' : 'on');
  } catch {
    // Storage blocked: the choice holds for this visit.
  }
  optedOut = off;
  if (gaId) win()[`ga-disable-${gaId}`] = off;
  // Back on within the same visit: events flow again if the tag is already set up.
  enabled = !off && id !== null;
}

/** Do Not Track or Global Privacy Control: the visitor already said no. */
export function privacySignal(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.doNotTrack === '1' || n.globalPrivacyControl === true;
}

/** Whether a measurement id was built in (the panel shows the toggle only then). */
export function analyticsConfigured(): boolean {
  return Boolean(buildId());
}

/** Vite inlines this at build time; tests (no vite/client types) see undefined. */
function buildId(): string | undefined {
  return (import.meta as { env?: { VITE_GA_ID?: string } }).env?.VITE_GA_ID;
}

export function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
