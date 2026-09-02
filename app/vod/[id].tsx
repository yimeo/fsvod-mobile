import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { ScreenContainer } from "@/components/screen-container";
import { SourceQuickSwitcher } from "@/components/source-quick-switcher";
import { VodPoster } from "@/components/vod-poster";
import { useDownloadQueue } from "@/lib/download-queue-context";
import { fetchVodDetail, type MacCmsVodDetail } from "@/lib/maccms";
import { getOfflineDownloads, isOfflineDownloadSupported, type OfflineDownload } from "@/lib/offline-downloads";
import { cacheVodDetail, getCachedVodDetail, getWatchHistory, saveWatchHistory } from "@/lib/vod-storage";
import { getSourceTypeLabel } from "@/lib/source-label";
import { useVodSource } from "@/lib/vod-context";

export default function VodDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { endpoint, sources, sourceError } = useVodSource();
  const { enqueue, retry, resumeTask, tasks, isWifi, settings } = useDownloadQueue();
  const [detail, setDetail] = useState<MacCmsVodDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [downloads, setDownloads] = useState<Record<string, OfflineDownload>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showEpisodeDownloads, setShowEpisodeDownloads] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      const sourceKey = endpoint?.apiUrl ?? "global";
      const cached = await getCachedVodDetail(id, sourceKey);
      if (cached) { setDetail(cached); setIsLoading(false); }
      if (!endpoint) { if (!cached) setError("未找到数据源配置"); return; }
      try { const fresh = await fetchVodDetail(endpoint, id); setDetail(fresh); await cacheVodDetail(fresh, sourceKey); }
      catch (loadError) { if (!cached) setError(loadError instanceof Error ? loadError.message : "影片详情加载失败"); }
      finally { setIsLoading(false); }
    };
    void load();
  }, [endpoint, id]);

  useEffect(() => { void getOfflineDownloads().then((saved) => setDownloads(Object.fromEntries(saved.map((item) => [item.remoteUrl, item])))); }, [id, tasks]);

  const source = useMemo(() => detail?.sources[sourceIndex] ?? null, [detail, sourceIndex]);
  const firstEpisode = source?.episodes[0];
  const downloadedEpisodeCount = source?.episodes.filter((item) => Boolean(downloads[item.url])).length ?? 0;
  const metadata = detail ? [detail.year, detail.area, detail.language].filter(Boolean).join(" · ") : "";
  const currentSource = sources.find((item) => item.id === endpoint?.apiUrl || item.endpoint.apiUrl === endpoint?.apiUrl);
  const sourceCaption = currentSource?.displayName?.trim() || currentSource?.endpoint.inputDomain?.trim() || endpoint?.inputDomain?.trim() || "当前数据源";
  const sourceConnectionTone = currentSource?.health === "healthy" ? "healthy" : currentSource?.health === "unhealthy" ? "unhealthy" : "unknown";

  const play = async (episodeName: string, url: string) => {
    if (!detail || !source) return;
    const previous = (await getWatchHistory()).find((entry) => entry.id === detail.id && entry.episodeUrl === url && entry.sourceName === source.name);
    const resumePosition = previous?.positionSeconds ?? 0;
    await saveWatchHistory({ id: detail.id, name: detail.name, posterUrl: detail.posterUrl, sourceName: source.name, episodeName, episodeUrl: url, episodeIndex: source.episodes.findIndex((item) => item.url === url), playlist: source.episodes, playSources: detail.sources, positionSeconds: resumePosition, watchedAt: new Date().toISOString() });
    const offline = downloads[url];
    router.push({ pathname: "/player", params: { url: offline?.localUri ?? url, episodeUrl: url, vodId: detail.id, ...(detail.posterUrl ? { posterUrl: detail.posterUrl } : {}), title: detail.name, contentType: detail.typeName, episode: episodeName, source: source.name, offline: offline ? "1" : "0", resumePosition: String(resumePosition), episodeIndex: String(source.episodes.findIndex((item) => item.url === url)), playlist: JSON.stringify(source.episodes), playSources: JSON.stringify(detail.sources) } } as never);
  };

  const download = async (episodeName: string, url: string) => {
    if (!detail || !source || downloads[url]) return;
    setDownloadError(null);
    const count = await enqueue([{ vodId: detail.id, vodName: detail.name, sourceName: source.name, episodeName, remoteUrl: url }]);
    if (count === 0) setDownloadError("该剧集已在下载队列中或当前线路不支持离线缓存");
  };

  if (isLoading && !detail) return <View style={styles.page}><ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#F5B64B" size="large" /></ScreenContainer><GlobalBottomNavigation /></View>;
  if (!detail) return <View style={styles.page}><ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>无法加载影片</Text><Text style={styles.errorText}>{error ?? "影片不存在或已被删除"}</Text><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回</Text></Pressable></ScreenContainer><GlobalBottomNavigation /></View>;

  return <View style={styles.page}><ScreenContainer containerClassName="bg-background"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.topBar}><Pressable accessibilityLabel="返回" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹</Text></Pressable><View style={styles.headerIdentity}><Text style={styles.topBrand}>飞鸿影院</Text><SourceQuickSwitcher style={styles.sourceIdentity}><View style={[styles.sourceConnectionDot, sourceConnectionTone === "healthy" && styles.sourceConnectionDotHealthy, sourceConnectionTone === "unhealthy" && styles.sourceConnectionDotUnhealthy]} /><Text numberOfLines={1} style={styles.sourceCaption}>{sourceCaption}</Text><Text style={[styles.sourceTypeTag, getSourceTypeLabel(currentSource ?? {}) === "普通" && styles.sourceTypeTagNormal]}>{getSourceTypeLabel(currentSource ?? {})}</Text></SourceQuickSwitcher></View></View>
    <VodPoster title={detail.name} url={detail.posterUrl} cacheKey={endpoint?.apiUrl ?? "global"} showLoadingSpinner={false} generatedFirst generatedTitleSize={20} style={styles.heroPoster} />
    <Text style={styles.title}>{detail.name}</Text>
    <Text style={styles.metadata}>{metadata || detail.typeName || "影视"}</Text>
    {detail.typeName ? <View style={styles.typePill}><Text style={styles.typeText}>{detail.typeName}</Text></View> : null}
    <Pressable disabled={!firstEpisode} onPress={() => firstEpisode && void play(firstEpisode.name, firstEpisode.url)} style={({ pressed }) => [styles.playButton, firstEpisode && downloads[firstEpisode.url] && styles.playButtonOffline, !firstEpisode && styles.disabled, pressed && styles.pressed]}><Text style={styles.playIcon}>▶</Text><Text style={styles.playText}>{firstEpisode && downloads[firstEpisode.url] ? "离线播放" : "立即播放"}</Text></Pressable>
    <View style={styles.section}><Text style={styles.sectionTitle}>剧情简介</Text><Text style={styles.contentText}>{detail.content || "当前数据源未提供影片简介。"}</Text></View>
    {(detail.actor || detail.director) ? <View style={styles.creditBox}>{detail.director ? <Text style={styles.credit}>导演：{detail.director}</Text> : null}{detail.actor ? <Text style={styles.credit}>主演：{detail.actor}</Text> : null}</View> : null}
    <View style={styles.section}><Text style={styles.sectionTitle}>选择播放源</Text><FlatList horizontal data={detail.sources} keyExtractor={(item) => item.name} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceList} renderItem={({ item, index }) => <Pressable onPress={() => setSourceIndex(index)} style={({ pressed }) => [styles.sourceChip, sourceIndex === index && styles.sourceChipActive, pressed && styles.pressed]}><Text style={[styles.sourceText, sourceIndex === index && styles.sourceTextActive]}>{item.name}</Text></Pressable>} /></View>
    {source ? <View style={styles.section}><View style={styles.episodeHeader}><View><Text style={styles.sectionTitle}>播放列表</Text><Text style={styles.episodeMeta}>{source.name} · {source.episodes.length} 集{downloadedEpisodeCount ? ` · ${downloadedEpisodeCount} 集已下载` : ""}</Text></View><Pressable onPress={() => setShowEpisodeDownloads((current) => !current)} style={({ pressed }) => [styles.playlistDownloadButton, showEpisodeDownloads && styles.playlistDownloadButtonActive, pressed && styles.pressed]}><Text style={[styles.playlistDownloadText, showEpisodeDownloads && styles.playlistDownloadTextActive]}>{showEpisodeDownloads ? "完成" : "↓ 下载"}</Text></Pressable></View>{downloadedEpisodeCount ? <Text style={styles.offlineHint}>已下载剧集将优先使用本地文件播放，无需网络。</Text> : null}{showEpisodeDownloads ? <Text style={styles.downloadHint}>{settings?.wifiOnly ? (isWifi ? "点选每集右侧下载，Wi‑Fi 下会自动开始。" : "点选每集右侧下载，任务将在连接 Wi‑Fi 后开始。") : "点选每集右侧下载，会自动加入下载队列。"}</Text> : null}{downloadError ? <Text style={styles.downloadError}>{downloadError}</Text> : null}<FlatList data={source.episodes} key={`${source.name}-${showEpisodeDownloads ? "download" : "play"}`} numColumns={showEpisodeDownloads ? 2 : 4} scrollEnabled={false} keyExtractor={(item, index) => `${item.name}-${index}`} contentContainerStyle={styles.episodeList} columnWrapperStyle={source.episodes.length ? styles.episodeRow : undefined} renderItem={({ item }) => { const cached = downloads[item.url]; if (!showEpisodeDownloads) return <Pressable onPress={() => void play(item.name, item.url)} style={({ pressed }) => [styles.playEpisode, cached && styles.playEpisodeOffline, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.episodeText}>{item.name}</Text>{cached ? <Text style={styles.episodeOfflineLabel}>已下载</Text> : null}</Pressable>; const task = tasks.find((entry) => entry.remoteUrl === item.url); const supported = isOfflineDownloadSupported(item.url); const isDownloading = task?.status === "downloading"; const progressPercent = task?.progress?.fraction == null ? null : Math.min(100, Math.max(0, Math.round(task.progress.fraction * 100))); const status = cached ? "已下载" : isDownloading ? "下载中" : task?.status === "queued" ? "队列中" : task?.status === "paused" ? "继续" : task?.status === "failed" ? "重试" : supported ? "下载" : "不支持"; const action = task?.status === "failed" ? () => retry(task.id) : task?.status === "paused" ? () => resumeTask(task.id) : () => download(item.name, item.url); return <View style={styles.episodeDownloadRow}><Pressable onPress={() => void play(item.name, item.url)} style={({ pressed }) => [styles.downloadPlayEpisode, cached && styles.downloadPlayEpisodeOffline, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.episodeText}>{item.name}</Text></Pressable><Pressable disabled={!supported || isDownloading || task?.status === "queued" || Boolean(cached)} onPress={() => void action()} style={({ pressed }) => [styles.inlineDownloadButton, cached && styles.episodeCached, task?.status === "failed" && styles.episodeFailed, (!supported || isDownloading || task?.status === "queued") && !cached && styles.downloadDisabled, pressed && styles.pressed]}>{isDownloading ? <><Text style={styles.episodeActionText}>下载中</Text><Text style={styles.episodeProgressText}>{progressPercent === null ? "…" : `${progressPercent}%`}</Text></> : <Text numberOfLines={1} style={[styles.episodeActionText, cached && styles.episodeCachedText]}>{status}</Text>}</Pressable></View>; }} /></View> : null}
  </ScrollView></ScreenContainer><GlobalBottomNavigation /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0A0F12" },
  content: { padding: 18, paddingBottom: 112 },
  topBar: { height: 54, flexDirection: "row", alignItems: "center" },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#20293A", alignItems: "center", justifyContent: "center" },
  backLabel: { color: "#F2F4F8", fontWeight: "500", fontSize: 39, lineHeight: 41, marginTop: -5 },
  headerIdentity: { flex: 1, minWidth: 0, marginLeft: 10, flexDirection: "row", alignItems: "flex-end", gap: 7 },
  topBrand: { color: "#F6F7FB", fontSize: 20, lineHeight: 26, fontWeight: "900", letterSpacing: 0.1, flexShrink: 0 },
  sourceIdentity: { flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0, flexShrink: 1 },
  sourceCaption: { color: "#9FAABD", fontSize: 11, lineHeight: 16, flexShrink: 1 },
  sourceTypeTag: { color: "#B8F1E0", backgroundColor: "#1E554B", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  sourceTypeTagNormal: { color: "#D6DCE6", backgroundColor: "#4A5568" },
  sourceConnectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#77869D", flexShrink: 0 },
  sourceConnectionDotHealthy: { backgroundColor: "#78D3A4" },
  sourceConnectionDotUnhealthy: { backgroundColor: "#F39A79" },
  heroPoster: { width: "100%", height: 280, borderRadius: 23, marginTop: 10 },
  title: { color: "#F5F6F9", fontSize: 29, lineHeight: 38, fontWeight: "900", marginTop: 21 },
  metadata: { color: "#A3AEBD", fontSize: 13, lineHeight: 19, marginTop: 6 },
  typePill: { alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: "#20293A", marginTop: 15 },
  typeText: { color: "#C6CFDC", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  playButton: { height: 62, borderRadius: 17, backgroundColor: "#F5B64B", marginTop: 24, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 11 },
  playButtonOffline: { backgroundColor: "#A9E2BE" },
  playIcon: { color: "#15171E", fontSize: 17, lineHeight: 22 },
  playText: { color: "#15171E", fontSize: 17, lineHeight: 24, fontWeight: "900" },
  section: { marginTop: 29 },
  sectionTitle: { color: "#F0F2F6", fontSize: 19, lineHeight: 27, fontWeight: "900" },
  contentText: { color: "#B1BBC9", fontSize: 13, lineHeight: 22, marginTop: 10 },
  creditBox: { marginTop: 17, padding: 14, borderRadius: 14, backgroundColor: "#151B29" },
  credit: { color: "#AAB4C5", fontSize: 12, lineHeight: 19 },
  sourceList: { gap: 9, paddingTop: 13, paddingRight: 18 },
  sourceChip: { minHeight: 39, paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: "#32405A", backgroundColor: "#1A2231", justifyContent: "center" },
  sourceChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  sourceText: { color: "#C5D0DF", fontSize: 13, lineHeight: 19, fontWeight: "800" },
  sourceTextActive: { color: "#171821" },
  episodeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  episodeMeta: { color: "#8F9CAF", fontSize: 11, lineHeight: 17, marginTop: 3 },
  playlistDownloadButton: { height: 31, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: "#B88A3A", backgroundColor: "#1A2130", justifyContent: "center" },
  playlistDownloadButtonActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  playlistDownloadText: { color: "#F5CF86", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  playlistDownloadTextActive: { color: "#15171E" },
  downloadHint: { color: "#9BAAC0", fontSize: 11, lineHeight: 16, marginTop: 10 },
  offlineHint: { color: "#A9E2BE", fontSize: 11, lineHeight: 16, marginTop: 9 },
  downloadError: { color: "#F3BF7B", fontSize: 11, lineHeight: 17, backgroundColor: "#30252C", borderRadius: 8, padding: 8, marginTop: 10 },
  episodeList: { gap: 9, marginTop: 15 },
  episodeRow: { gap: 9, marginBottom: 9 },
  playEpisode: { flex: 1, minWidth: 0, height: 46, paddingHorizontal: 7, borderRadius: 10, backgroundColor: "#20293A", alignItems: "center", justifyContent: "center" },
  playEpisodeOffline: { backgroundColor: "#1F523F", borderWidth: 1, borderColor: "#438366" },
  episodeText: { color: "#E5EAF2", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  episodeOfflineLabel: { color: "#B7E9C8", fontSize: 8, lineHeight: 11, fontWeight: "900", marginTop: 1 },
  episodeDownloadRow: { flex: 1, minWidth: 0, height: 42, flexDirection: "row", borderRadius: 10, overflow: "hidden", backgroundColor: "#20293A" },
  downloadPlayEpisode: { flex: 1, minWidth: 0, paddingHorizontal: 8, justifyContent: "center", alignItems: "center" },
  downloadPlayEpisodeOffline: { backgroundColor: "#1B4438" },
  inlineDownloadButton: { width: 54, paddingHorizontal: 4, backgroundColor: "#263A57", borderLeftWidth: 1, borderLeftColor: "#405778", justifyContent: "center", alignItems: "center" },
  episodeActionText: { color: "#A8CBEF", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  episodeProgressText: { color: "#D4E5FA", fontSize: 9, lineHeight: 12, fontWeight: "800" },
  episodeCached: { backgroundColor: "#1F523F" },
  episodeCachedText: { color: "#B1E6C3" },
  episodeFailed: { backgroundColor: "#553040" },
  downloadDisabled: { opacity: 0.55 },
  errorTitle: { color: "#F4F6FA", fontSize: 18, lineHeight: 25, fontWeight: "800", textAlign: "center" },
  errorText: { color: "#AAB7CA", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  backButton: { marginTop: 20, backgroundColor: "#F5B64B", borderRadius: 11, paddingHorizontal: 16, height: 42, justifyContent: "center" },
  backText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
