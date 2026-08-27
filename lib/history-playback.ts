import { fetchVodDetail, type MacCmsEndpoint, type MacCmsEpisode, type MacCmsPlaySource } from "@/lib/maccms";
import { getOfflineDownload } from "@/lib/offline-downloads";
import type { WatchHistoryEntry } from "@/lib/vod-storage";

export interface HistoryPlaybackParams {
  url: string;
  episodeUrl: string;
  vodId: string;
  posterUrl?: string;
  title: string;
  episode: string;
  source: string;
  offline: "0" | "1";
  episodeIndex: string;
  playlist: string;
  playSources: string;
  resumePosition: string;
}

export async function buildHistoryPlaybackParams(entry: WatchHistoryEntry, endpoint: MacCmsEndpoint): Promise<HistoryPlaybackParams> {
  let episodeUrl = entry.episodeUrl;
  let episodeName = entry.episodeName || "影视内容";
  let sourceName = entry.sourceName;
  let playlist = entry.playlist ?? [];
  let playSources: MacCmsPlaySource[] = entry.playSources ?? [];
  let episodeIndex = entry.episodeIndex ?? 0;
  let title = entry.name;
  let posterUrl = entry.posterUrl;

  if (!episodeUrl || !playSources.length) {
    const detail = await fetchVodDetail(endpoint, entry.id);
    const source = detail.sources.find((item) => item.name === entry.sourceName) ?? detail.sources[0];
    if (!source?.episodes.length) throw new Error("该影片当前没有可直接播放的剧集");
    const foundIndex = source.episodes.findIndex((item) => item.name === entry.episodeName);
    episodeIndex = foundIndex >= 0 ? foundIndex : 0;
    const selected: MacCmsEpisode = source.episodes[episodeIndex];
    episodeUrl = selected.url;
    episodeName = selected.name;
    sourceName = source.name;
    playlist = source.episodes;
    playSources = detail.sources;
    title = detail.name;
    posterUrl = detail.posterUrl ?? entry.posterUrl;
  }

  const offline = await getOfflineDownload(episodeUrl);
  return {
    url: offline?.localUri ?? episodeUrl,
    episodeUrl,
    vodId: entry.id,
    ...(posterUrl ? { posterUrl } : {}),
    title,
    episode: episodeName,
    source: sourceName,
    offline: offline ? "1" : "0",
    episodeIndex: String(Math.max(0, episodeIndex)),
    playlist: JSON.stringify(playlist),
    playSources: JSON.stringify(playSources),
    resumePosition: String(Math.max(0, entry.positionSeconds ?? 0)),
  };
}
