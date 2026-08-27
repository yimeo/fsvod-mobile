import AsyncStorage from "@react-native-async-storage/async-storage";

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

export async function clearLocalVodData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const appKeys = keys.filter((key) => key.startsWith(PREFIX) && key !== SOURCE_KEY && key !== SOURCES_KEY);
  if (appKeys.length) await AsyncStorage.multiRemove(appKeys);
}

export async function getLocalCacheSummary(): Promise<{ playbackLists: number; searches: number; history: number }> {
  const keys = await AsyncStorage.getAllKeys();
  return {
    playbackLists: keys.filter((key) => key.startsWith(DETAIL_PREFIX)).length,
    searches: (await getSearches()).length,
    history: (await getWatchHistory()).length,
  };
}
