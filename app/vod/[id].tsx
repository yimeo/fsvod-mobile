import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { ScreenContainer } from "@/components/screen-container";
import { VodPoster } from "@/components/vod-poster";
import { useDownloadQueue } from "@/lib/download-queue-context";
import { fetchVodDetail, type MacCmsVodDetail } from "@/lib/maccms";
import { getOfflineDownloads, isOfflineDownloadSupported, type OfflineDownload } from "@/lib/offline-downloads";
import { cacheVodDetail, getCachedVodDetail, saveWatchHistory } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

export default function VodDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { endpoint } = useVodSource();
  const { enqueue, retry, resumeTask, tasks, isWifi, settings } = useDownloadQueue();
  const [detail, setDetail] = useState<MacCmsVodDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [downloads, setDownloads] = useState<Record<string, OfflineDownload>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloadPickerOpen, setIsDownloadPickerOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      const cached = await getCachedVodDetail(id);
      if (cached) { setDetail(cached); setIsLoading(false); }
      if (!endpoint) { if (!cached) setError("未找到数据源配置"); return; }
      try { const fresh = await fetchVodDetail(endpoint, id); setDetail(fresh); await cacheVodDetail(fresh); }
      catch (loadError) { if (!cached) setError(loadError instanceof Error ? loadError.message : "影片详情加载失败"); }
      finally { setIsLoading(false); }
    };
    void load();
  }, [endpoint, id]);

  useEffect(() => { void getOfflineDownloads().then((saved) => setDownloads(Object.fromEntries(saved.map((item) => [item.remoteUrl, item])))); }, [id, tasks]);

  const source = useMemo(() => detail?.sources[sourceIndex] ?? null, [detail, sourceIndex]);
  const firstEpisode = source?.episodes[0];
  const metadata = detail ? [detail.year, detail.area, detail.language].filter(Boolean).join(" · ") : "";

  const play = async (episodeName: string, url: string) => {
    if (!detail || !source) return;
    await saveWatchHistory({ id: detail.id, name: detail.name, posterUrl: detail.posterUrl, sourceName: source.name, episodeName, episodeUrl: url, episodeIndex: source.episodes.findIndex((item) => item.url === url), playlist: source.episodes, playSources: detail.sources, positionSeconds: 0, watchedAt: new Date().toISOString() });
    const offline = downloads[url];
    router.push({ pathname: "/player", params: { url: offline?.localUri ?? url, episodeUrl: url, vodId: detail.id, ...(detail.posterUrl ? { posterUrl: detail.posterUrl } : {}), title: detail.name, episode: episodeName, source: source.name, offline: offline ? "1" : "0", episodeIndex: String(source.episodes.findIndex((item) => item.url === url)), playlist: JSON.stringify(source.episodes), playSources: JSON.stringify(detail.sources) } } as never);
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
    <View style={styles.topBar}><Pressable accessibilityLabel="返回" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹</Text></Pressable><Text style={styles.topBrand}>飞鸿影院</Text></View>
    <VodPoster title={detail.name} url={detail.posterUrl} style={styles.heroPoster} />
    <Text style={styles.title}>{detail.name}</Text>
    <Text style={styles.metadata}>{metadata || detail.typeName || "影视"}</Text>
    {detail.typeName ? <View style={styles.typePill}><Text style={styles.typeText}>{detail.typeName}</Text></View> : null}
    <Pressable disabled={!firstEpisode} onPress={() => firstEpisode && void play(firstEpisode.name, firstEpisode.url)} style={({ pressed }) => [styles.playButton, !firstEpisode && styles.disabled, pressed && styles.pressed]}><Text style={styles.playIcon}>▶</Text><Text style={styles.playText}>立即播放</Text></Pressable>
    <View style={styles.section}><Text style={styles.sectionTitle}>剧情简介</Text><Text style={styles.contentText}>{detail.content || "当前数据源未提供影片简介。"}</Text></View>
    {(detail.actor || detail.director) ? <View style={styles.creditBox}>{detail.director ? <Text style={styles.credit}>导演：{detail.director}</Text> : null}{detail.actor ? <Text style={styles.credit}>主演：{detail.actor}</Text> : null}</View> : null}
    <View style={styles.section}><Text style={styles.sectionTitle}>选择播放源</Text><FlatList horizontal data={detail.sources} keyExtractor={(item) => item.name} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceList} renderItem={({ item, index }) => <Pressable onPress={() => setSourceIndex(index)} style={({ pressed }) => [styles.sourceChip, sourceIndex === index && styles.sourceChipActive, pressed && styles.pressed]}><Text style={[styles.sourceText, sourceIndex === index && styles.sourceTextActive]}>{item.name}</Text></Pressable>} /></View>
    {source ? <View style={styles.section}><View style={styles.episodeHeader}><View><Text style={styles.sectionTitle}>播放列表</Text><Text style={styles.episodeMeta}>{source.name} · {source.episodes.length} 集</Text></View><Pressable onPress={() => setIsDownloadPickerOpen((current) => !current)} style={({ pressed }) => [styles.playlistDownloadButton, pressed && styles.pressed]}><Text style={styles.playlistDownloadText}>{isDownloadPickerOpen ? "收起下载" : "↓ 下载"}</Text></Pressable></View><FlatList data={source.episodes} key={`play-${source.name}`} numColumns={4} scrollEnabled={false} keyExtractor={(item, index) => `${item.name}-${index}`} contentContainerStyle={styles.episodeList} columnWrapperStyle={source.episodes.length ? styles.episodeRow : undefined} renderItem={({ item }) => <Pressable onPress={() => void play(item.name, item.url)} style={({ pressed }) => [styles.playEpisode, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.episodeText}>{item.name}</Text></Pressable>} />{isDownloadPickerOpen ? <View style={styles.downloadPicker}><View style={styles.downloadPickerHead}><View><Text style={styles.downloadPickerTitle}>选择下载剧集</Text><Text style={styles.downloadPickerMeta}>{settings?.wifiOnly ? (isWifi ? "Wi‑Fi 环境下自动下载" : "已加入队列，等待 Wi‑Fi") : "已加入队列后自动下载"}</Text></View><Pressable onPress={() => setIsDownloadPickerOpen(false)} style={({ pressed }) => [styles.closePicker, pressed && styles.pressed]}><Text style={styles.closePickerText}>收起</Text></Pressable></View>{downloadError ? <Text style={styles.downloadError}>{downloadError}</Text> : null}<FlatList data={source.episodes} key={`download-${source.name}`} numColumns={3} scrollEnabled={false} keyExtractor={(item, index) => `${item.name}-${index}`} contentContainerStyle={styles.downloadList} columnWrapperStyle={source.episodes.length ? styles.episodeRow : undefined} renderItem={({ item }) => { const cached = downloads[item.url]; const task = tasks.find((entry) => entry.remoteUrl === item.url); const supported = isOfflineDownloadSupported(item.url); const status = cached ? "已缓存" : task?.status === "downloading" ? "下载中" : task?.status === "queued" ? "队列中" : task?.status === "paused" ? "继续" : task?.status === "failed" ? "重试" : supported ? "下载" : "不支持"; const action = task?.status === "failed" ? () => retry(task.id) : task?.status === "paused" ? () => resumeTask(task.id) : () => download(item.name, item.url); return <Pressable disabled={!supported || task?.status === "downloading" || task?.status === "queued" || Boolean(cached)} onPress={() => void action()} style={({ pressed }) => [styles.downloadEpisode, cached && styles.episodeCached, task?.status === "failed" && styles.episodeFailed, (!supported || task?.status === "downloading" || task?.status === "queued") && !cached && styles.downloadDisabled, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.episodeActionText, cached && styles.episodeCachedText]}>{item.name} · {status}</Text></Pressable>; }} /></View> : null}</View> : null}
  </ScrollView></ScreenContainer><GlobalBottomNavigation /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0A0F12" },
  content: { padding: 18, paddingBottom: 112 },
  topBar: { height: 54, flexDirection: "row", alignItems: "center" },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#20293A", alignItems: "center", justifyContent: "center" },
  backLabel: { color: "#F2F4F8", fontWeight: "500", fontSize: 39, lineHeight: 41, marginTop: -5 },
  topBrand: { color: "#A5B0C1", fontSize: 12, lineHeight: 18, fontWeight: "800", marginLeft: 10 },
  heroPoster: { width: "100%", height: 280, borderRadius: 23, marginTop: 10 },
  title: { color: "#F5F6F9", fontSize: 29, lineHeight: 38, fontWeight: "900", marginTop: 21 },
  metadata: { color: "#A3AEBD", fontSize: 13, lineHeight: 19, marginTop: 6 },
  typePill: { alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: "#20293A", marginTop: 15 },
  typeText: { color: "#C6CFDC", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  playButton: { height: 62, borderRadius: 17, backgroundColor: "#F5B64B", marginTop: 24, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 11 },
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
  playlistDownloadText: { color: "#F5CF86", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  downloadError: { color: "#F3BF7B", fontSize: 11, lineHeight: 17, backgroundColor: "#30252C", borderRadius: 8, padding: 8, marginTop: 10 },
  episodeList: { gap: 9, marginTop: 15 },
  episodeRow: { gap: 9, marginBottom: 9 },
  playEpisode: { flex: 1, minWidth: 0, height: 42, paddingHorizontal: 7, borderRadius: 10, backgroundColor: "#20293A", alignItems: "center", justifyContent: "center" },
  episodeText: { color: "#E5EAF2", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  downloadPicker: { marginTop: 22, padding: 13, borderRadius: 14, backgroundColor: "#151E31", borderWidth: 1, borderColor: "#394B6C" },
  downloadPickerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  downloadPickerTitle: { color: "#EEF2F8", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  downloadPickerMeta: { color: "#93A1B5", fontSize: 11, lineHeight: 16, marginTop: 2 },
  closePicker: { height: 29, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: "#415474", justifyContent: "center" },
  closePickerText: { color: "#B9D4EF", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  downloadList: { gap: 9, marginTop: 13 },
  downloadEpisode: { flex: 1, minWidth: 0, height: 38, paddingHorizontal: 6, borderRadius: 9, backgroundColor: "#263A57", alignItems: "center", justifyContent: "center" },
  episodeActionText: { color: "#A8CBEF", fontSize: 10, lineHeight: 14, fontWeight: "900" },
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
