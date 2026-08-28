import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";

const POSTER_CACHE_INDEX_KEY = "fsvod:poster-cache-index";
const MAX_TRACKED_POSTERS = 500;

let writeQueue = Promise.resolve();

function normalizeUrl(value: string | null | undefined): string | null {
  const url = value?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

async function getTrackedUrls(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(POSTER_CACHE_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Records only successfully rendered remote posters so the cache screen can report actual disk files. */
export function recordPosterCache(url: string | null | undefined): void {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  writeQueue = writeQueue.then(async () => {
    const current = await getTrackedUrls();
    const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, MAX_TRACKED_POSTERS);
    await AsyncStorage.setItem(POSTER_CACHE_INDEX_KEY, JSON.stringify(next));
  }).catch(() => undefined);
}

export async function getPosterCacheSummary(): Promise<{ count: number; bytes: number }> {
  const urls = await getTrackedUrls();
  let count = 0;
  let bytes = 0;
  for (const url of urls) {
    try {
      const path = await Image.getCachePathAsync(url);
      if (!path) continue;
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists && !info.isDirectory) {
        count += 1;
        bytes += typeof info.size === "number" ? info.size : 0;
      }
    } catch {
      // A cache entry may have been evicted by the image library or the system.
    }
  }
  return { count, bytes };
}

export async function clearPosterCache(): Promise<void> {
  await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache(), AsyncStorage.removeItem(POSTER_CACHE_INDEX_KEY)]);
}
