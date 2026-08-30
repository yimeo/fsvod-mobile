import { OFFICIAL_RESOURCE_CONFIG_URLS } from "./official-resources";

const AD_FORMAT = "fsvod.index-ad.v1";
const AD_TIMEOUT_MS = 8_000;
const MAX_AD_ITEMS = 8;

type JsonRecord = Record<string, unknown>;

export type IndexAdTarget =
  | { type: "web"; url: string }
  | { type: "vod"; vodId: string };

export interface IndexAd {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  target: IndexAdTarget | null;
  durationSeconds: number;
}

export interface IndexAdLoadResult {
  ads: IndexAd[];
  rotationSeconds: number;
}

// Intentionally in-memory: it survives navigation within one APP process but
// is cleared when the APP is fully exited and started again.
let sessionAdResult: IndexAdLoadResult | null = null;
let sessionAdRequest: Promise<IndexAdLoadResult> | null = null;

export function getCachedIndexAds(): IndexAdLoadResult | null {
  return sessionAdResult;
}

interface IndexAdConfig {
  dataUrl: string;
  rotationSeconds: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function boundedSeconds(value: unknown, fallback: number): number {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) ? Math.min(15, Math.max(3, Math.round(seconds))) : fallback;
}

function parseConfig(value: unknown): IndexAdConfig | null {
  const raw = isRecord(value) ? value.index_ad : null;
  // Advertising is opt-in. A missing switch, a legacy string URL, or any value other than true must not request ad data.
  if (!isRecord(raw) || raw.enabled !== true) return null;
  const dataUrl = httpUrl(raw.data_url ?? raw.url ?? raw.script_url ?? raw.script ?? raw.api);
  if (!dataUrl) return null;
  return { dataUrl, rotationSeconds: boundedSeconds(raw.rotation_seconds, 5) };
}

function parseTarget(value: unknown): IndexAdTarget | null {
  if (!isRecord(value)) return null;
  const type = text(value.type).toLowerCase();
  if (type === "web") {
    const url = httpUrl(value.url);
    return url ? { type: "web", url } : null;
  }
  if (type === "vod") {
    const vodId = text(value.vod_id ?? value.vodId ?? value.id);
    return vodId ? { type: "vod", vodId } : null;
  }
  return null;
}

function parseAd(value: unknown, fallbackDuration: number): IndexAd | null {
  if (!isRecord(value) || value.active === false) return null;
  const id = text(value.id);
  const title = text(value.title);
  const imageUrl = httpUrl(value.image_url ?? value.imageUrl ?? value.image);
  if (!id || !title || !imageUrl) return null;
  return {
    id,
    title,
    subtitle: text(value.subtitle ?? value.description),
    imageUrl,
    target: parseTarget(value.target),
    durationSeconds: boundedSeconds(value.duration_seconds ?? value.durationSeconds, fallbackDuration),
  };
}

export function parseIndexAdResponse(payload: unknown, fallbackDuration = 5): IndexAd[] {
  if (!isRecord(payload) || (text(payload.format) && text(payload.format) !== AD_FORMAT)) return [];
  const rawItems = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.ads) ? payload.ads : Array.isArray(payload.data) ? payload.data : [];
  const unique = new Map<string, IndexAd>();
  rawItems.forEach((item) => {
    const ad = parseAd(item, fallbackDuration);
    if (ad && unique.size < MAX_AD_ITEMS) unique.set(ad.id, ad);
  });
  return [...unique.values()];
}

async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, text/plain, */*", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return JSON.parse((await response.text()).replace(/^\uFEFF/, "")) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function findIndexAdConfig(configUrls: readonly string[]): Promise<IndexAdConfig | null> {
  const queue = [...configUrls];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const payload = await requestJson(url);
      const config = parseConfig(payload);
      if (config) return config;
      if (isRecord(payload)) {
        [payload.primaryApi, payload.backupApi].map(httpUrl).filter((value): value is string => Boolean(value)).forEach((next) => queue.push(next));
      }
    } catch {
      // Try the next official configuration endpoint. The caller keeps the existing hero as fallback.
    }
  }
  return null;
}

/**
 * Returns only validated ad data. Remote JavaScript is never evaluated; an endpoint ending in .js is accepted only when it returns JSON.
 */
export async function loadIndexAds(configUrls: readonly string[] = OFFICIAL_RESOURCE_CONFIG_URLS): Promise<IndexAdLoadResult> {
  if (sessionAdResult) return sessionAdResult;
  if (sessionAdRequest) return sessionAdRequest;
  sessionAdRequest = (async () => {
    const config = await findIndexAdConfig(configUrls);
    if (!config) return { ads: [], rotationSeconds: 5 };
    try {
      const ads = parseIndexAdResponse(await requestJson(config.dataUrl), config.rotationSeconds);
      return { ads, rotationSeconds: config.rotationSeconds };
    } catch {
      return { ads: [], rotationSeconds: config.rotationSeconds };
    }
  })();
  const result = await sessionAdRequest;
  sessionAdRequest = null;
  if (result.ads.length > 0) sessionAdResult = result;
  return result;
}
