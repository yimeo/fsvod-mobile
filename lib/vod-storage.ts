import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MacCmsEndpoint, MacCmsVodDetail } from "@/lib/maccms";

const PREFIX = "fsvod:";
const SOURCE_KEY = `${PREFIX}source`;
const DETAIL_PREFIX = `${PREFIX}detail:`;
const SEARCH_KEY = `${PREFIX}searches`;
const HISTORY_KEY = `${PREFIX}history`;
const CATEGORY_ORDER_KEY = `${PREFIX}category-order`;

export interface WatchHistoryEntry {
  id: string;
  name: string;
  posterUrl: string | null;
  sourceName: string;
  episodeName: string;
  watchedAt: string;
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

export async function saveWatchHistory(entry: WatchHistoryEntry): Promise<WatchHistoryEntry[]> {
  const history = await getWatchHistory();
  const next = [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, 30);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function getWatchHistory(): Promise<WatchHistoryEntry[]> {
  return getJson<WatchHistoryEntry[]>(HISTORY_KEY, []);
}

export async function clearLocalVodData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const appKeys = keys.filter((key) => key.startsWith(PREFIX));
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
