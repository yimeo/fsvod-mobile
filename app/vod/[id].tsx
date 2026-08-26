import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { VodPoster } from "@/components/vod-poster";
import { fetchVodDetail, type MacCmsVodDetail } from "@/lib/maccms";
import { getOfflineDownloads, isOfflineDownloadSupported, type OfflineDownload } from "@/lib/offline-downloads";
import { useDownloadQueue } from "@/lib/download-queue-context";
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

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      const cached = await getCachedVodDetail(id);
      if (cached) {
        setDetail(cached);
        setIsLoading(false);
      }
      if (!endpoint) {
        if (!cached) setError("未找到数据源配置");
        return;
      }
      try {
        const fresh = await fetchVodDetail(endpoint, id);
        setDetail(fresh);
        await cacheVodDetail(fresh);
      } catch (loadError) {
        if (!cached) setError(loadError instanceof Error ? loadError.message : "影片详情加载失败");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [endpoint, id]);

  useEffect(() => {
    const loadDownloads = async () => {
      const saved = await getOfflineDownloads();
      setDownloads(Object.fromEntries(saved.map((item) => [item.remoteUrl, item])));
    };
    void loadDownloads();
  }, [id]);

  const source = useMemo(() => detail?.sources[sourceIndex] ?? null, [detail, sourceIndex]);

  const play = async (episodeName: string, url: string) => {
    if (!detail || !source) return;
    await saveWatchHistory({ id: detail.id, name: detail.name, posterUrl: detail.posterUrl, sourceName: source.name, episodeName, watchedAt: new Date().toISOString() });
    const offline = downloads[url];
    router.push({ pathname: "/player", params: { url: offline?.localUri ?? url, title: detail.name, episode: episodeName, source: source.name, offline: offline ? "1" : "0" } } as never);
  };

  const download = async (episodeName: string, url: string) => {
    if (!detail || !source || downloads[url]) return;
    setDownloadError(null);
    const count = await enqueue([{ vodId: detail.id, vodName: detail.name, sourceName: source.name, episodeName, remoteUrl: url }]);
    if (count === 0) setDownloadError("该剧集已在下载队列中或当前线路不支持离线缓存");
  };

  const downloadSource = async () => {
    if (!detail || !source) return;
    setDownloadError(null);
    const count = await enqueue(source.episodes.filter((episode) => !downloads[episode.url] && isOfflineDownloadSupported(episode.url)).map((episode) => ({ vodId: detail.id, vodName: detail.name, sourceName: source.name, episodeName: episode.name, remoteUrl: episode.url })));
    if (count === 0) setDownloadError("本线路没有可加入的新下载任务");
  };

  if (isLoading && !detail) return <View style={styles.page}><ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#F5B64B" size="large" /></ScreenContainer><GlobalBottomNavigation /></View>;
  if (!detail) return <View style={styles.page}><ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>无法加载影片</Text><Text style={styles.errorText}>{error ?? "影片不存在或已被删除"}</Text><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回</Text></Pressable></ScreenContainer><GlobalBottomNavigation /></View>;

  const metadata = [detail.year, detail.area, detail.language].filter(Boolean).join(" · ");
  return (
    <View style={styles.page}>
    <ScreenContainer containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹ 返回</Text></Pressable>
        <View style={styles.hero}><VodPoster title={detail.name} url={detail.posterUrl} style={styles.poster} /><View style={styles.heroInfo}><Text style={styles.title}>{detail.name}</Text><Text style={styles.metadata}>{metadata || detail.typeName || "影视"}</Text>{detail.remarks ? <Text style={styles.remark}>{detail.remarks}</Text> : null}<Text numberOfLines={4} style={styles.contentText}>{detail.content || "暂无剧情简介"}</Text></View></View>
        {(detail.actor || detail.director) ? <View style={styles.creditBox}>{detail.director ? <Text style={styles.credit}>导演：{detail.director}</Text> : null}{detail.actor ? <Text style={styles.credit}>主演：{detail.actor}</Text> : null}</View> : null}
        <View style={styles.titleRow}><Text style={styles.sectionTitle}>播放线路</Text><Text style={styles.cacheLabel}>已缓存到本机</Text></View>
        <FlatList horizontal data={detail.sources} keyExtractor={(item) => item.name} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceList} renderItem={({ item, index }) => <Pressable onPress={() => setSourceIndex(index)} style={({ pressed }) => [styles.sourceChip, sourceIndex === index && styles.sourceChipActive, pressed && styles.pressed]}><Text style={[styles.sourceText, sourceIndex === index && styles.sourceTextActive]}>{item.name}</Text></Pressable>} />
        {source ? <><View style={styles.episodeHeader}><View><Text style={styles.episodeLabel}>{source.name} · {source.episodes.length} 集</Text><Text style={styles.episodeHint}>{settings?.wifiOnly ? (isWifi ? "Wi‑Fi 下将自动继续下载" : "等待 Wi‑Fi 后自动继续下载") : "前台打开时自动继续下载"}</Text></View><Pressable onPress={() => void downloadSource()} style={({ pressed }) => [styles.batchButton, pressed && styles.pressed]}><Text style={styles.batchText}>下载本线路</Text></Pressable></View>{downloadError ? <Text style={styles.downloadError}>{downloadError}</Text> : null}<FlatList data={source.episodes} key={`episodes-${source.name}`} numColumns={4} scrollEnabled={false} keyExtractor={(item, index) => `${item.name}-${index}`} contentContainerStyle={styles.episodeList} columnWrapperStyle={source.episodes.length ? styles.episodeRow : undefined} renderItem={({ item }) => { const cached = downloads[item.url]; const task = tasks.find((entry) => entry.remoteUrl === item.url); const supported = isOfflineDownloadSupported(item.url); const progressText = cached ? "已缓存" : task?.status === "downloading" ? (task.progress?.fraction !== null && task.progress?.fraction !== undefined ? `${Math.round(task.progress.fraction * 100)}%` : "下载中") : task?.status === "queued" ? "队列中" : task?.status === "paused" ? "已暂停" : task?.status === "failed" ? "重试" : supported ? "下载" : "仅播放"; const action = task?.status === "failed" ? () => retry(task.id) : task?.status === "paused" ? () => resumeTask(task.id) : () => download(item.name, item.url); return <View style={styles.episodeCell}><Pressable onPress={() => void play(item.name, item.url)} style={({ pressed }) => [styles.episode, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.episodeText}>{item.name}</Text></Pressable><Pressable disabled={!supported || task?.status === "downloading" || task?.status === "queued" || Boolean(cached)} onPress={() => void action()} style={({ pressed }) => [styles.downloadButton, cached && styles.downloadCached, task?.status === "failed" && styles.downloadFailed, (!supported || task?.status === "downloading" || task?.status === "queued") && !cached && styles.downloadDisabled, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.downloadText, cached && styles.downloadCachedText]}>{progressText}</Text></Pressable></View>; }} /></> : <Text style={styles.noSource}>数据源未提供可用播放线路。</Text>}
      </ScrollView>
    </ScreenContainer>
    <GlobalBottomNavigation />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 18, paddingBottom: 112 },
  back: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 12, marginBottom: 12 },
  backLabel: { color: "#B9D7F6", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  hero: { flexDirection: "row", gap: 15 },
  poster: { width: 126, aspectRatio: 2 / 3, borderRadius: 14 },
  heroInfo: { flex: 1, paddingTop: 2 },
  title: { color: "#F6F7FB", fontWeight: "800", fontSize: 21, lineHeight: 28 },
  metadata: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 7 },
  remark: { color: "#F8D28D", fontWeight: "700", fontSize: 12, lineHeight: 18, marginTop: 6 },
  contentText: { color: "#BDC7D8", fontSize: 12, lineHeight: 19, marginTop: 10 },
  creditBox: { marginTop: 16, borderRadius: 12, backgroundColor: "#151E34", padding: 12 },
  credit: { color: "#AAB6CA", fontSize: 12, lineHeight: 19 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 23, marginBottom: 11 },
  sectionTitle: { color: "#F6F7FB", fontSize: 18, lineHeight: 25, fontWeight: "800" },
  cacheLabel: { color: "#76BEF5", fontSize: 11, lineHeight: 16 },
  sourceList: { gap: 9, paddingRight: 18 },
  sourceChip: { height: 35, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#354969", justifyContent: "center", backgroundColor: "#151E34" },
  sourceChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  sourceText: { color: "#C4CEDF", fontSize: 13, fontWeight: "700" },
  sourceTextActive: { color: "#11192B" },
  episodeHeader: { marginTop: 18, marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  episodeLabel: { color: "#AAB6C8", fontSize: 13, lineHeight: 19, fontWeight: "700" },
  episodeHint: { color: "#75839B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  batchButton: { height: 32, borderRadius: 9, paddingHorizontal: 10, justifyContent: "center", backgroundColor: "#F5B64B" },
  batchText: { color: "#11192B", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  downloadError: { color: "#F5BF77", fontSize: 11, lineHeight: 17, backgroundColor: "#30252C", borderRadius: 8, padding: 8, marginBottom: 10 },
  episodeList: { gap: 9 },
  episodeRow: { gap: 8, marginBottom: 9 },
  episodeCell: { flex: 1, minWidth: 0 },
  episode: { height: 38, paddingHorizontal: 6, borderTopLeftRadius: 9, borderTopRightRadius: 9, backgroundColor: "#1A2945", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#314566" },
  episodeText: { color: "#D8E2F0", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  downloadButton: { height: 24, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: "#203858", justifyContent: "center", alignItems: "center", borderWidth: 1, borderTopWidth: 0, borderColor: "#314566" },
  downloadText: { color: "#AAD2FC", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  downloadCached: { backgroundColor: "#1F523F", borderColor: "#397861" },
  downloadCachedText: { color: "#A9E2BE" },
  downloadFailed: { backgroundColor: "#553040", borderColor: "#96576C" },
  downloadDisabled: { opacity: 0.52 },
  noSource: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, paddingVertical: 18 },
  errorTitle: { color: "#F4F6FA", fontSize: 18, lineHeight: 25, fontWeight: "800", textAlign: "center" },
  errorText: { color: "#AAB7CA", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  backButton: { marginTop: 20, backgroundColor: "#F5B64B", borderRadius: 11, paddingHorizontal: 16, height: 42, justifyContent: "center" },
  backText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
