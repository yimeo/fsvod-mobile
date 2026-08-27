import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const INDEX_KEY = "fsvod:offline-downloads";
const ROOT = `${FileSystem.documentDirectory ?? ""}fsvod-offline/`;
type TransferState = "running" | "paused" | "stopped";
type ActiveTransfer = { state: TransferState; resumable: FileSystem.DownloadResumable | null };
const activeTransfers = new Map<string, ActiveTransfer>();

export interface OfflineDownload {
  id: string;
  vodId: string;
  vodName: string;
  sourceName: string;
  episodeName: string;
  remoteUrl: string;
  localUri: string;
  sizeBytes: number;
  downloadedAt: string;
  format: "file" | "hls";
}

export interface OfflineDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
}

export interface OfflineDownloadRequest {
  vodId: string;
  vodName: string;
  sourceName: string;
  episodeName: string;
  remoteUrl: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "media";
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url);
}

export function isOfflineDownloadSupported(url: string): boolean {
  return /\.(mp4|m4v|webm|m3u8)(\?.*)?$/i.test(url);
}

async function ensureRoot(): Promise<void> {
  if (!ROOT) throw new Error("当前设备不支持本地离线缓存");
  await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
}

async function getIndex(): Promise<OfflineDownload[]> {
  try {
    const value = await AsyncStorage.getItem(INDEX_KEY);
    return value ? (JSON.parse(value) as OfflineDownload[]) : [];
  } catch {
    return [];
  }
}

async function saveIndex(entries: OfflineDownload[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function outputId(request: OfflineDownloadRequest): string {
  return `${request.vodId}-${hash(`${request.sourceName}-${request.episodeName}-${request.remoteUrl}`)}`;
}

function extensionFrom(url: string, fallback: string): string {
  const pathname = url.split("?")[0];
  const match = pathname.match(/\.([a-zA-Z0-9]{1,8})$/);
  return match ? match[1].toLowerCase() : fallback;
}

function resolveUrl(relativeUrl: string, baseUrl: string): string {
  return new URL(relativeUrl, baseUrl).toString();
}

async function getSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === "number" ? info.size : 0;
}

function throwIfInterrupted(remoteUrl: string): void {
  const state = activeTransfers.get(remoteUrl)?.state;
  if (state === "paused") throw new Error("DOWNLOAD_PAUSED");
  if (state === "stopped") throw new Error("DOWNLOAD_STOPPED");
}

async function downloadFile(url: string, targetUri: string, onProgress?: (progress: OfflineDownloadProgress) => void, remoteUrl?: string): Promise<void> {
  if (remoteUrl) throwIfInterrupted(remoteUrl);
  const task = FileSystem.createDownloadResumable(url, targetUri, {}, (event) => {
    const total = event.totalBytesExpectedToWrite > 0 ? event.totalBytesExpectedToWrite : null;
    onProgress?.({
      downloadedBytes: event.totalBytesWritten,
      totalBytes: total,
      fraction: total ? event.totalBytesWritten / total : null,
    });
  });
  const active = remoteUrl ? activeTransfers.get(remoteUrl) : null;
  if (active) active.resumable = task;
  try {
    const result = await task.downloadAsync();
    if (!result?.uri) throw new Error("媒体文件下载未完成");
    if (remoteUrl) throwIfInterrupted(remoteUrl);
  } finally {
    if (active) active.resumable = null;
  }
}

async function resolveHlsMediaPlaylist(url: string): Promise<{ url: string; content: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取播放清单（HTTP ${response.status}）`);
  const content = await response.text();
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const variants = lines.flatMap((line, index) => line.startsWith("#EXT-X-STREAM-INF") ? [lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith("#"))] : []).filter((item): item is string => Boolean(item));
  if (variants.length > 0) return resolveHlsMediaPlaylist(resolveUrl(variants[variants.length - 1], url));
  return { url, content };
}

async function downloadHls(url: string, targetDir: string, onProgress?: (progress: OfflineDownloadProgress) => void): Promise<{ uri: string; sizeBytes: number }> {
  const playlist = await resolveHlsMediaPlaylist(url);
  if (/#EXT-X-KEY|#EXT-X-MAP|#EXT-X-BYTERANGE/i.test(playlist.content)) throw new Error("该 HLS 线路使用了暂不支持的加密或分片格式");
  if (!/#EXT-X-ENDLIST/i.test(playlist.content)) throw new Error("直播线路无法作为离线影片下载");
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
  const lines = playlist.content.split(/\r?\n/);
  const segments = lines.filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (segments.length === 0) throw new Error("播放清单中没有可下载的媒体分片");
  const localNames = new Map<string, string>();
  let downloaded = 0;
  let totalSize = 0;
  for (let index = 0; index < segments.length; index += 1) {
    throwIfInterrupted(url);
    const remoteSegment = resolveUrl(segments[index].trim(), playlist.url);
    const localName = `segment-${String(index + 1).padStart(4, "0")}.${extensionFrom(remoteSegment, "ts")}`;
    await downloadFile(remoteSegment, `${targetDir}${localName}`, undefined, url);
    totalSize += await getSize(`${targetDir}${localName}`);
    downloaded += 1;
    localNames.set(segments[index].trim(), localName);
    onProgress?.({ downloadedBytes: downloaded, totalBytes: segments.length, fraction: downloaded / segments.length });
  }
  const rewritten = lines.map((line) => localNames.get(line.trim()) ?? line).join("\n");
  const manifestUri = `${targetDir}offline.m3u8`;
  await FileSystem.writeAsStringAsync(manifestUri, rewritten, { encoding: FileSystem.EncodingType.UTF8 });
  totalSize += await getSize(manifestUri);
  return { uri: manifestUri, sizeBytes: totalSize };
}

export async function getOfflineDownloads(): Promise<OfflineDownload[]> {
  const entries = await getIndex();
  const verified = await Promise.all(entries.map(async (entry) => {
    const info = await FileSystem.getInfoAsync(entry.localUri);
    return info.exists ? entry : null;
  }));
  const current = verified.filter((entry): entry is OfflineDownload => Boolean(entry));
  if (current.length !== entries.length) await saveIndex(current);
  return current.sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
}

export async function getOfflineDownload(remoteUrl: string): Promise<OfflineDownload | null> {
  const entries = await getOfflineDownloads();
  return entries.find((entry) => entry.remoteUrl === remoteUrl) ?? null;
}

export async function downloadEpisodeOffline(request: OfflineDownloadRequest, onProgress?: (progress: OfflineDownloadProgress) => void): Promise<OfflineDownload> {
  if (Platform.OS === "web") throw new Error("离线下载仅支持 Android 与 iOS 原生应用");
  if (!isOfflineDownloadSupported(request.remoteUrl)) throw new Error("仅支持 MP4、WebM 与无加密点播 HLS 线路离线缓存");
  const existing = await getOfflineDownload(request.remoteUrl);
  if (existing) return existing;
  await ensureRoot();
  const id = outputId(request);
  const targetDir = `${ROOT}${safeSegment(request.vodId)}-${hash(request.remoteUrl)}/`;
  if (activeTransfers.has(request.remoteUrl)) throw new Error("该剧集正在下载");
  activeTransfers.set(request.remoteUrl, { state: "running", resumable: null });
  try {
    let localUri: string;
    let sizeBytes: number;
    let format: OfflineDownload["format"];
    if (isHlsUrl(request.remoteUrl)) {
      const result = await downloadHls(request.remoteUrl, targetDir, onProgress);
      localUri = result.uri;
      sizeBytes = result.sizeBytes;
      format = "hls";
    } else {
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      localUri = `${targetDir}offline.${extensionFrom(request.remoteUrl, "mp4")}`;
      await downloadFile(request.remoteUrl, localUri, onProgress, request.remoteUrl);
      sizeBytes = await getSize(localUri);
      format = "file";
    }
    const entry: OfflineDownload = { id, ...request, localUri, sizeBytes, downloadedAt: new Date().toISOString(), format };
    const entries = await getIndex();
    await saveIndex([entry, ...entries.filter((item) => item.remoteUrl !== request.remoteUrl)]);
    return entry;
  } catch (error) {
    await FileSystem.deleteAsync(targetDir, { idempotent: true });
    throw error;
  } finally {
    activeTransfers.delete(request.remoteUrl);
  }
}

export async function pauseOfflineDownload(remoteUrl: string): Promise<void> {
  const active = activeTransfers.get(remoteUrl);
  if (!active) return;
  active.state = "paused";
  await active.resumable?.pauseAsync().catch(() => undefined);
}

export async function stopOfflineDownload(remoteUrl: string): Promise<void> {
  const active = activeTransfers.get(remoteUrl);
  if (!active) return;
  active.state = "stopped";
  await active.resumable?.pauseAsync().catch(() => undefined);
}

export async function removeOfflineDownload(id: string): Promise<void> {
  const entries = await getIndex();
  const target = entries.find((entry) => entry.id === id);
  if (target) {
    const folder = target.localUri.slice(0, target.localUri.lastIndexOf("/") + 1);
    await FileSystem.deleteAsync(folder, { idempotent: true });
  }
  await saveIndex(entries.filter((entry) => entry.id !== id));
}

export async function removeOfflineDownloadByUrl(remoteUrl: string): Promise<void> {
  const target = await getOfflineDownload(remoteUrl);
  if (target) await removeOfflineDownload(target.id);
}

export async function clearOfflineDownloads(): Promise<void> {
  if (ROOT) await FileSystem.deleteAsync(ROOT, { idempotent: true });
  await AsyncStorage.removeItem(INDEX_KEY);
}

export async function getOfflineSummary(): Promise<{ count: number; sizeBytes: number }> {
  const downloads = await getOfflineDownloads();
  return { count: downloads.length, sizeBytes: downloads.reduce((sum, item) => sum + item.sizeBytes, 0) };
}
