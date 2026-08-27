import AsyncStorage from "@react-native-async-storage/async-storage";

import type { OfflineDownloadRequest, OfflineDownloadProgress } from "@/lib/offline-downloads";

const TASKS_KEY = "fsvod:download-queue";
const SETTINGS_KEY = "fsvod:download-settings";

export type DownloadTaskStatus = "queued" | "downloading" | "paused" | "failed" | "completed";

export interface DownloadQueueTask extends OfflineDownloadRequest {
  id: string;
  status: DownloadTaskStatus;
  progress: OfflineDownloadProgress | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadSettings {
  wifiOnly: boolean;
  storageLimitBytes: number;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  wifiOnly: true,
  storageLimitBytes: 50 * 1024 * 1024 * 1024,
};

export function createQueueTask(request: OfflineDownloadRequest): DownloadQueueTask {
  const timestamp = new Date().toISOString();
  return {
    ...request,
    id: `${request.vodId}-${request.remoteUrl}-${request.sourceName}`,
    status: "queued",
    progress: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function upsertQueueTasks(existing: DownloadQueueTask[], requests: OfflineDownloadRequest[]): DownloadQueueTask[] {
  const activeTasks = existing.filter((task) => task.status !== "completed");
  const byUrl = new Map(activeTasks.map((task) => [task.remoteUrl, task]));
  const incoming = requests
    .filter((request) => !byUrl.has(request.remoteUrl))
    .map(createQueueTask);
  return [...activeTasks, ...incoming];
}

export function updateQueueTask(tasks: DownloadQueueTask[], id: string, patch: Partial<DownloadQueueTask>): DownloadQueueTask[] {
  return tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task);
}

export function nextRunnableTask(tasks: DownloadQueueTask[]): DownloadQueueTask | null {
  return tasks.find((task) => task.status === "queued") ?? null;
}

export function retryTask(tasks: DownloadQueueTask[], id: string): DownloadQueueTask[] {
  return updateQueueTask(tasks, id, { status: "queued", error: null, progress: null });
}

export function formatStorageLimit(value: number): string {
  if (value <= 0) return "不限";
  return `${Math.round(value / (1024 * 1024 * 1024))} GB`;
}

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getQueueTasks(): Promise<DownloadQueueTask[]> {
  return getJson<DownloadQueueTask[]>(TASKS_KEY, []);
}

export function saveQueueTasks(tasks: DownloadQueueTask[]): Promise<void> {
  return AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function clearQueueTasks(): Promise<void> {
  return AsyncStorage.removeItem(TASKS_KEY);
}

export async function getDownloadSettings(): Promise<DownloadSettings> {
  const stored = await getJson<Partial<DownloadSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_DOWNLOAD_SETTINGS, ...stored };
}

export function saveDownloadSettings(settings: DownloadSettings): Promise<void> {
  return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
