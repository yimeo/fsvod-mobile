import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";

import type { MacCmsEndpoint, MacCmsEpisode, MacCmsPlaySource, MacCmsVodDetail } from "@/lib/maccms";

const PREFIX = "fsvod:";
const SOURCE_KEY = `${PREFIX}source`;
const SOURCES_KEY = `${PREFIX}sources`;
const DETAIL_PREFIX = `${PREFIX}detail:`;
const SEARCH_KEY = `${PREFIX}searches`;
const HISTORY_KEY = `${PREFIX}history`;
const CATEGORY_ORDER_KEY = `${PREFIX}category-order`;
const CATEGORY_PAGE_MODE_KEY = `${PREFIX}category-page-mode`;
const CATEGORY_CLASSIC_PAGE_SIZE_KEY = `${PREFIX}category-classic-page-size`;
const POSTER_CACHE_KEY = `${PREFIX}poster-cache-urls`;
const MAX_TRACKED_POSTERS = 360;

export type CategoryPageMode = "auto" | "manual" | "classic";
export type CategoryClassicPageSize = 12 | 24 | 30 | 60;
export const DEFAULT_LIST_PAGE_SIZE: CategoryClassicPageSize = 24;

export interface WatchHistoryEntry {
  id: string;
  name: string;
  posterUrl: string | null;
  sourceName: string;
  episodeName: string;
  watchedAt: string;
  episodeUrl?: string;
  episodeIndex?: number;
  playlist?: MacCmsEpisode[];
  playSources?: MacCmsPlaySource[];
  positionSeconds?: number;
  durationSeconds?: number;
}

export type SourceHealth = "unknown" | "healthy" | "unhealthy";

export interface SavedMacCmsSource {
  id: string;
  endpoint: MacCmsEndpoint;
  displayName: string;
  sourceType?: "official" | "custom";
  officialKey?: string;
  health: SourceHealth;
  lastCheckedAt: string | null;
  lastError: string | null;
}

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveEndpoint(endpoint: MacCmsEndpoint): Promise<void> {
  await AsyncStorage.setItem(SOURCE_KEY, JSON.stringify(endpoint));
}

export function getEndpoint(): Promise<MacCmsEndpoint | null> {
  return getJson<MacCmsEndpoint | null>(SOURCE_KEY, null);
}

export function clearEndpoint(): Promise<void> {
  return AsyncStorage.removeItem(SOURCE_KEY);
}

function sourceId(endpoint: MacCmsEndpoint): string {
  return endpoint.apiUrl;
}

export async function getSources(): Promise<SavedMacCmsSource[]> {
  const saved = await getJson<SavedMacCmsSource[]>(SOURCES_KEY, []);
  if (saved.length) {
    const normalized = saved.map((source) => ({ ...source, displayName: source.displayName?.trim() || source.endpoint.inputDomain }));
    if (normalized.some((source, index) => source.displayName !== saved[index]?.displayName)) await saveSources(normalized);
    return normalized;
  }
  const legacy = await getEndpoint();
  if (!legacy) return [];
  const migrated: SavedMacCmsSource[] = [{ id: sourceId(legacy), endpoint: legacy, displayName: legacy.inputDomain, health: "unknown", lastCheckedAt: null, lastError: null }];
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(migrated));
  return migrated;
}

export function saveSources(sources: SavedMacCmsSource[]): Promise<void> {
  return AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

export async function upsertSource(endpoint: MacCmsEndpoint, health: SourceHealth = "healthy", lastError: string | null = null, displayName?: string, metadata?: Pick<SavedMacCmsSource, "sourceType" | "officialKey">): Promise<SavedMacCmsSource[]> {
  const sources = await getSources();
  const currentIndex = sources.findIndex((source) => source.id === sourceId(endpoint));
  const current = currentIndex >= 0 ? sources[currentIndex] : undefined;
  const entry: SavedMacCmsSource = {
    id: sourceId(endpoint),
    endpoint,
    displayName: displayName?.trim() || current?.displayName || endpoint.inputDomain,
    sourceType: metadata?.sourceType ?? current?.sourceType,
    officialKey: metadata?.officialKey ?? current?.officialKey,
    health,
    lastCheckedAt: new Date().toISOString(),
    lastError,
  };
  const next = current
    ? sources.map((source) => source.id === entry.id ? entry : source)
    : metadata?.sourceType === "official" ? [...sources, entry] : [entry, ...sources];
  await saveSources(next);
  return next;
}

export async function replaceSource(id: string, endpoint: MacCmsEndpoint, displayName: string): Promise<SavedMacCmsSource[]> {
  const sources = await getSources();
  const previousIndex = sources.findIndex((source) => source.id === id);
  const current = sources[previousIndex];
  const entry: SavedMacCmsSource = {
    id: sourceId(endpoint),
    endpoint,
    displayName: displayName.trim() || current?.displayName || endpoint.inputDomain,
    sourceType: current?.sourceType,
    officialKey: current?.officialKey,
    health: "healthy",
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
  };
  const next = sources.filter((source) => source.id !== id && source.id !== entry.id);
  next.splice(Math.max(0, Math.min(previousIndex, next.length)), 0, entry);
  await saveSources(next);
  return next;
}

export async function updateSourceHealth(id: string, health: SourceHealth, lastError: string | null = null): Promise<SavedMacCmsSource[]> {
  const next = (await getSources()).map((source) => source.id === id ? { ...source, health, lastCheckedAt: new Date().toISOString(), lastError } : source);
  await saveSources(next);
  return next;
}

export async function removeSource(id: string): Promise<SavedMacCmsSource[]> {
  const next = (await getSources()).filter((source) => source.id !== id);
  await saveSources(next);
  return next;
}

export async function renameSource(id: string, displayName: string): Promise<SavedMacCmsSource[]> {
  const name = displayName.trim();
  const next = (await getSources()).map((source) => source.id === id ? { ...source, displayName: name || source.endpoint.inputDomain } : source);
  await saveSources(next);
  return next;
}

export async function moveSource(id: string, direction: -1 | 1): Promise<SavedMacCmsSource[]> {
  const next = [...await getSources()];
  const from = next.findIndex((source) => source.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  await saveSources(next);
  return next;
}

export async function cacheVodDetail(detail: MacCmsVodDetail): Promise<void> {
  await AsyncStorage.setItem(`${DETAIL_PREFIX}${detail.id}`, JSON.stringify({ detail, cachedAt: new Date().toISOString() }));
}

export async function getCachedVodDetail(id: string): Promise<MacCmsVodDetail | null> {
  const result = await getJson<{ detail: MacCmsVodDetail } | null>(`${DETAIL_PREFIX}${id}`, null);
  return result?.detail ?? null;
}

export async function rememberSearch(keyword: string): Promise<string[]> {
  const normalized = keyword.trim();
  if (!normalized) return getSearches();
  const searches = await getSearches();
  const next = [normalized, ...searches.filter((item) => item !== normalized)].slice(0, 12);
  await AsyncStorage.setItem(SEARCH_KEY, JSON.stringify(next));
  return next;
}

export function getSearches(): Promise<string[]> {
  return getJson<string[]>(SEARCH_KEY, []);
}

export function getCategoryOrder(): Promise<string[]> {
  return getJson<string[]>(CATEGORY_ORDER_KEY, []);
}

export async function saveCategoryOrder(order: string[]): Promise<void> {
  await AsyncStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(order));
}

export async function getCategoryPageMode(): Promise<CategoryPageMode> {
  const mode = await getJson<CategoryPageMode>(CATEGORY_PAGE_MODE_KEY, "auto");
  return mode === "manual" || mode === "classic" ? mode : "auto";
}

export function saveCategoryPageMode(mode: CategoryPageMode): Promise<void> {
  return AsyncStorage.setItem(CATEGORY_PAGE_MODE_KEY, JSON.stringify(mode));
}

export async function getCategoryClassicPageSize(): Promise<CategoryClassicPageSize> {
  const size = await getJson<number>(CATEGORY_CLASSIC_PAGE_SIZE_KEY, DEFAULT_LIST_PAGE_SIZE);
  return size === 12 || size === 24 || size === 30 || size === 60 ? size : DEFAULT_LIST_PAGE_SIZE;
}

export function saveCategoryClassicPageSize(size: CategoryClassicPageSize): Promise<void> {
  return AsyncStorage.setItem(CATEGORY_CLASSIC_PAGE_SIZE_KEY, JSON.stringify(size));
}

export async function saveWatchHistory(entry: WatchHistoryEntry): Promise<WatchHistoryEntry[]> {
  const history = await getWatchHistory();
  const episodeKey = entry.episodeUrl || entry.episodeName;
  const normalizedEntry = entry.durationSeconds && entry.positionSeconds && entry.positionSeconds >= Math.max(entry.durationSeconds - 10, entry.durationSeconds * 0.95)
    ? { ...entry, positionSeconds: 0 }
    : entry;
  const next = [normalizedEntry, ...history.filter((item) => item.id !== entry.id || (item.episodeUrl || item.episodeName) !== episodeKey)].slice(0, 30);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function getWatchHistory(): Promise<WatchHistoryEntry[]> {
  return getJson<WatchHistoryEntry[]>(HISTORY_KEY, []);
}

export function clearWatchHistory(): Promise<void> {
  return AsyncStorage.removeItem(HISTORY_KEY);
}

export async function clearPlaybackLists(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const playlistKeys = keys.filter((key) => key.startsWith(DETAIL_PREFIX));
  if (playlistKeys.length) await AsyncStorage.multiRemove(playlistKeys);
}

export function clearSearches(): Promise<void> {
  return AsyncStorage.removeItem(SEARCH_KEY);
}

export async function clearLocalVodData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const cacheKeys = keys.filter((key) => key.startsWith(DETAIL_PREFIX) || key === SEARCH_KEY || key === HISTORY_KEY || key === POSTER_CACHE_KEY);
  if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
}

function normalizePosterUrl(value: string): string | null {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

async function getTrackedPosterUrls(): Promise<string[]> {
  const values = await getJson<string[]>(POSTER_CACHE_KEY, []);
  return [...new Set(values.map(normalizePosterUrl).filter((value): value is string => Boolean(value)))].slice(0, MAX_TRACKED_POSTERS);
}

function collectPosterCandidates(value: unknown, output: Set<string>, keyHint = ""): void {
  if (typeof value === "string") {
    const normalized = normalizePosterUrl(value);
    const looksLikePoster = /poster|cover|pic|thumb|image|vod_pic|backdrop/i.test(keyHint) || /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(normalized || "");
    if (normalized && looksLikePoster) output.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPosterCandidates(item, output, keyHint));
    return;
  }
  if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => collectPosterCandidates(item, output, key));
}

async function getKnownPosterUrls(): Promise<string[]> {
  const tracked = await getTrackedPosterUrls();
  const keys = await AsyncStorage.getAllKeys();
  const sourceKeys = keys.filter((key) => key.startsWith(DETAIL_PREFIX) || key === HISTORY_KEY);
  const values = await Promise.all(sourceKeys.map((key) => AsyncStorage.getItem(key)));
  const candidates = new Set(tracked);
  values.forEach((raw) => {
    if (!raw) return;
    try { collectPosterCandidates(JSON.parse(raw) as unknown, candidates); } catch { /* ignore malformed legacy data */ }
  });
  return [...candidates].slice(0, MAX_TRACKED_POSTERS);
}

let posterWriteQueue: Promise<void> = Promise.resolve();

export function rememberPosterCache(url: string): Promise<void> {
  const normalized = normalizePosterUrl(url);
  if (!normalized) return Promise.resolve();
  posterWriteQueue = posterWriteQueue.then(async () => {
    const current = await getTrackedPosterUrls();
    const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, MAX_TRACKED_POSTERS);
    await AsyncStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(next));
  }).catch(() => undefined);
  return posterWriteQueue;
}

export async function clearPosterCache(): Promise<void> {
  await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
  await AsyncStorage.removeItem(POSTER_CACHE_KEY);
}

function toFileUri(path: string): string {
  // expo-image Android returns Glide's absolute path (for example
  // /data/user/0/.../image) while expo-file-system expects file:// URIs.
  return path.startsWith("file://") ? path : path.startsWith("/") ? `file://${path}` : path;
}

export async function getPosterCacheSummary(): Promise<{ count: number; bytes: number }> {
  const tracked = await getKnownPosterUrls();
  const resolved = await Promise.all(tracked.map(async (url) => {
    try {
      const path = await Image.getCachePathAsync(url);
      if (!path) return null;
      const info = await FileSystem.getInfoAsync(toFileUri(path));
      if (!info.exists) return null;
      return { url, bytes: typeof info.size === "number" ? info.size : 0 };
    } catch {
      return null;
    }
  }));
  const cached = resolved.filter((item): item is { url: string; bytes: number } => Boolean(item));
  const cachedUrls = cached.map((item) => item.url);
  if (cachedUrls.length !== tracked.length) await AsyncStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(cachedUrls));
  return { count: cached.length || tracked.length, bytes: cached.reduce((total, item) => total + item.bytes, 0) };
}

export async function getLocalCacheSummary(): Promise<{ playbackLists: number; searches: number; history: number; posterCount: number; posterBytes: number }> {
  const keys = await AsyncStorage.getAllKeys();
  const [searches, history, posterCache] = await Promise.all([getSearches(), getWatchHistory(), getPosterCacheSummary()]);
  return {
    playbackLists: keys.filter((key) => key.startsWith(DETAIL_PREFIX)).length,
    searches: searches.length,
    history: history.length,
    posterCount: posterCache.count,
    posterBytes: posterCache.bytes,
  };
}
