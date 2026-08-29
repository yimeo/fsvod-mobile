import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";

// This exact key is used by the user's v1.2.4 APK, whose poster count and size display works.
const POSTER_CACHE_URLS_KEY = "fsvod:poster-cache-urls";
// A migration reader for the divergent key introduced after v1.2.4.
const MIGRATED_POSTER_CACHE_URLS_KEY = "fsvod:poster-cache-index";
const MAX_TRACKED_POSTERS = 360;

let writeQueue = Promise.resolve();
const listeners = new Set<() => void>();

function normalizeUrl(value: string | null | undefined): string | null {
  const url = value?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function toFileUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return path.startsWith("/") ? `file://${path}` : path;
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribePosterCacheChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readUrls(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function trackedUrls(): Promise<string[]> {
  const [workingVersionUrls, migratedUrls] = await Promise.all([
    readUrls(POSTER_CACHE_URLS_KEY),
    readUrls(MIGRATED_POSTER_CACHE_URLS_KEY),
  ]);
  return [...new Set([...workingVersionUrls, ...migratedUrls].map(normalizeUrl).filter((item): item is string => Boolean(item)))].slice(0, MAX_TRACKED_POSTERS);
}

/** Called only after expo-image reports a successful poster load. */
export function recordPosterCache(value: string | null | undefined): void {
  const url = normalizeUrl(value);
  if (!url) return;
  writeQueue = writeQueue.then(async () => {
    const current = await trackedUrls();
    const next = [url, ...current.filter((item) => item !== url)].slice(0, MAX_TRACKED_POSTERS);
    await AsyncStorage.setItem(POSTER_CACHE_URLS_KEY, JSON.stringify(next));
    emitChange();
  }).catch(() => undefined);
}

/** Matches v1.2.4: Image cache path -> file URI -> FileSystem size -> valid URL index. */
export async function getPosterCacheSummary(): Promise<{ count: number; bytes: number }> {
  const urls = await trackedUrls();
  const cached = (await Promise.all(urls.map(async (url) => {
    try {
      const cachePath = await Image.getCachePathAsync(url);
      if (!cachePath) return null;
      const info = await FileSystem.getInfoAsync(toFileUri(cachePath));
      if (!info.exists) return null;
      return { url, bytes: typeof info.size === "number" ? info.size : 0 };
    } catch {
      return null;
    }
  }))).filter((item): item is { url: string; bytes: number } => Boolean(item));

  const validUrls = cached.map((item) => item.url);
  if (validUrls.length !== urls.length) {
    await AsyncStorage.setItem(POSTER_CACHE_URLS_KEY, JSON.stringify(validUrls));
  }
  return { count: cached.length, bytes: cached.reduce((total, item) => total + item.bytes, 0) };
}

export async function clearPosterCache(): Promise<void> {
  await Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
  await AsyncStorage.multiRemove([POSTER_CACHE_URLS_KEY, MIGRATED_POSTER_CACHE_URLS_KEY]);
  emitChange();
}
