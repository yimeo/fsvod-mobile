import { ActivityIndicator, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoView, useVideoPlayer } from "expo-video";

import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { ScreenContainer } from "@/components/screen-container";
import { isDirectVideoUrl, type MacCmsPlaySource } from "@/lib/maccms";
import { getOfflineDownload, getOfflineDownloads } from "@/lib/offline-downloads";
import { saveWatchHistory } from "@/lib/vod-storage";

interface PlaylistEpisode { name: string; url: string; }

function getParam(value: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function parsePlaylist(value: string): PlaylistEpisode[] {
  try {
    const data = JSON.parse(value) as unknown;
    return Array.isArray(data) ? data.filter((item): item is PlaylistEpisode => Boolean(item && typeof item === "object" && typeof (item as PlaylistEpisode).name === "string" && typeof (item as PlaylistEpisode).url === "string")) : [];
  } catch { return []; }
}

function parsePlaySources(value: string): MacCmsPlaySource[] {
  try {
    const data = JSON.parse(value) as unknown;
    return Array.isArray(data) ? data.filter((item): item is MacCmsPlaySource => Boolean(item && typeof item === "object" && typeof (item as MacCmsPlaySource).name === "string" && Array.isArray((item as MacCmsPlaySource).episodes))) : [];
  } catch { return []; }
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ url: string; episodeUrl?: string; title?: string; episode?: string; source?: string; offline?: string; playlist?: string; playSources?: string; episodeIndex?: string; vodId?: string; posterUrl?: string; resumePosition?: string }>();
  const router = useRouter();
  const url = getParam(params.url);
  const title = getParam(params.title, "影片播放");
  const episode = getParam(params.episode);
  const source = getParam(params.source);
  const vodId = getParam(params.vodId);
  const posterUrl = getParam(params.posterUrl) || null;
  const episodeUrl = getParam(params.episodeUrl, url);
  const offline = getParam(params.offline) === "1";
  const playlist = useMemo(() => parsePlaylist(getParam(params.playlist)), [params.playlist]);
  const parsedSources = useMemo(() => parsePlaySources(getParam(params.playSources)), [params.playSources]);
  const playSources = useMemo(() => parsedSources.length ? parsedSources : source ? [{ name: source, episodes: playlist }] : [], [parsedSources, playlist, source]);
  const [offlineUri, setOfflineUri] = useState<string | null>(offline ? url : null);
  const [offlineUrls, setOfflineUrls] = useState<Set<string>>(() => new Set());
  const [offlineSizes, setOfflineSizes] = useState<Map<string, number>>(() => new Map());
  const [isOfflineResolved, setIsOfflineResolved] = useState(false);
  const preferredIndex = Number.parseInt(getParam(params.episodeIndex), 10);
  const currentIndex = useMemo(() => {
    const rawUrlIndex = playlist.findIndex((item) => item.url === episodeUrl || item.url === url);
    return rawUrlIndex >= 0 ? rawUrlIndex : Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < playlist.length ? preferredIndex : -1;
  }, [episodeUrl, playlist, preferredIndex, url]);
  const playbackUrl = isOfflineResolved ? offlineUri ?? url : "";
  const isUsingOffline = Boolean(offlineUri);
  const directPlayable = Boolean(playbackUrl && isDirectVideoUrl(playbackUrl));
  const player = useVideoPlayer(null);
  const lastSavedPosition = useRef(0);
  const resumePositionValue = Number(getParam(params.resumePosition, "0"));
  const resumePosition = Number.isFinite(resumePositionValue) && resumePositionValue > 3 ? resumePositionValue : 0;

  const persistProgress = useCallback((positionSeconds: number) => {
    if (!vodId || !episodeUrl || !Number.isFinite(positionSeconds)) return;
    const safePosition = Math.max(0, Math.floor(positionSeconds));
    if (safePosition > 0 && Math.abs(safePosition - lastSavedPosition.current) < 4) return;
    lastSavedPosition.current = safePosition;
    void saveWatchHistory({ id: vodId, name: title, posterUrl, sourceName: source, episodeName: episode || "影视内容", episodeUrl, episodeIndex: currentIndex >= 0 ? currentIndex : 0, playlist, playSources, positionSeconds: safePosition, durationSeconds: Number.isFinite(player.duration) ? player.duration : undefined, watchedAt: new Date().toISOString() });
  }, [currentIndex, episode, episodeUrl, playSources, player.duration, playlist, posterUrl, source, title, vodId]);

  useEffect(() => {
    lastSavedPosition.current = 0;
  }, [episodeUrl]);

  useEffect(() => {
    let mounted = true;
    setIsOfflineResolved(false);
    void Promise.all([getOfflineDownload(episodeUrl), getOfflineDownloads()]).then(([current, downloads]) => {
      if (!mounted) return;
      setOfflineUri(current?.localUri ?? (offline ? url : null));
      setOfflineUrls(new Set(downloads.map((item) => item.remoteUrl)));
      setOfflineSizes(new Map(downloads.map((item) => [item.remoteUrl, item.sizeBytes])));
      setIsOfflineResolved(true);
    });
    return () => { mounted = false; };
  }, [episodeUrl, offline, url]);

  useEffect(() => {
    if (!directPlayable) { player.pause(); return; }
    let active = true;
    void player.replaceAsync({ uri: playbackUrl, useCaching: Platform.OS === "android" }).then(() => {
      if (!active) return;
      if (resumePosition > 0) player.currentTime = resumePosition;
      player.play();
    });
    return () => { active = false; player.pause(); };
  }, [directPlayable, playbackUrl, player, resumePosition]);

  useEffect(() => {
    if (!directPlayable) return;
    player.timeUpdateEventInterval = 5;
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => persistProgress(currentTime));
    return () => { subscription.remove(); persistProgress(player.currentTime); };
  }, [directPlayable, persistProgress, player]);

  useFocusEffect(useCallback(() => {
    return () => {
      persistProgress(player.currentTime);
      player.pause();
    };
  }, [persistProgress, player]));

  const openExternal = async () => {
    if (!url) return;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  };

  const returnToDetail = useCallback(() => {
    if (vodId) {
      router.replace({ pathname: "/vod/[id]", params: { id: vodId } } as never);
      return;
    }
    router.back();
  }, [router, vodId]);

  const openEpisode = useCallback(async (targetSource: MacCmsPlaySource, index: number) => {
    const next = targetSource.episodes[index];
    if (!next) return;
    const downloaded = await getOfflineDownload(next.url);
    router.replace({ pathname: "/player", params: { url: downloaded?.localUri ?? next.url, episodeUrl: next.url, title, episode: next.name, source: targetSource.name, offline: downloaded ? "1" : "0", episodeIndex: String(index), playlist: JSON.stringify(targetSource.episodes), playSources: JSON.stringify(playSources), vodId, ...(posterUrl ? { posterUrl } : {}) } } as never);
  }, [playSources, posterUrl, router, title, vodId]);

  const playEpisodeAt = (index: number) => {
    const currentSource = playSources.find((item) => item.name === source) ?? { name: source, episodes: playlist };
    void openEpisode(currentSource, index);
  };

  const switchSource = (nextSource: MacCmsPlaySource) => {
    if (!nextSource.episodes.length || nextSource.name === source) return;
    const matchingIndex = nextSource.episodes.findIndex((item) => item.name === episode);
    void openEpisode(nextSource, matchingIndex >= 0 ? matchingIndex : 0);
  };

  useEffect(() => {
    if (!directPlayable || currentIndex < 0 || currentIndex >= playlist.length - 1) return;
    const subscription = player.addListener("playToEnd", () => playEpisodeAt(currentIndex + 1));
    return () => subscription.remove();
  }, [currentIndex, directPlayable, player, playlist.length, source, title]);

  if (!url) return <View style={styles.page}><ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>播放地址无效</Text><Pressable onPress={returnToDetail} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回详情</Text></Pressable></ScreenContainer><GlobalBottomNavigation /></View>;

  return <View style={styles.page}><ScreenContainer containerClassName="bg-background" edges={["top", "bottom", "left", "right"]}><ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><View style={styles.header}><Pressable onPress={returnToDetail} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹ 返回</Text></Pressable><View style={styles.headerInfo}><Text numberOfLines={1} style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.episode}>{episode || "正在播放"}{source ? ` · ${source}` : ""}</Text></View></View>{directPlayable ? <View style={styles.playerWrap}><VideoView style={styles.video} player={player} nativeControls allowsFullscreen allowsPictureInPicture contentFit="contain" surfaceType="textureView" /><View style={styles.statusRow}>{isUsingOffline ? <Text style={styles.offlineBadge}>已下载</Text> : null}<Text style={styles.statusText}>{isUsingOffline ? "正在优先使用本机已下载的剧集资源。" : "正在播放网络媒体。"}{resumePosition > 0 ? ` 已从 ${formatDuration(resumePosition)} 继续播放。` : ""}{currentIndex >= 0 && currentIndex < playlist.length - 1 ? " 播放结束后将自动进入下一集。" : ""}</Text></View></View> : <View style={styles.unsupported}><Text style={styles.unsupportedTitle}>此线路不是可直接播放的视频地址</Text><Text style={styles.unsupportedText}>该数据源提供了网页型或解析型地址。你可以切换播放源、切换剧集，或在浏览器中打开。</Text><Pressable onPress={() => void openExternal()} style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}><Text style={styles.externalText}>在浏览器打开</Text></Pressable></View>}{playSources.length ? <View style={styles.sourcePanel}><Text style={styles.sourceTitle}>选择播放源</Text><Text style={styles.sourceHint}>选择线路后可直接切换播放。</Text><View style={styles.sourceList}>{playSources.map((item) => { const downloadedCount = item.episodes.filter((entry) => offlineUrls.has(entry.url)).length; return <Pressable key={item.name} onPress={() => switchSource(item)} style={({ pressed }) => [styles.sourceChip, item.name === source && styles.sourceChipActive, pressed && styles.pressed]}><Text style={[styles.sourceChipText, item.name === source && styles.sourceChipTextActive]}>{item.name}{downloadedCount ? ` · ${downloadedCount} 已下载` : ""}</Text></Pressable>; })}</View></View> : null}{playlist.length ? <View style={styles.playlistPanel}><View style={styles.episodeHeading}><View><Text style={styles.playlistTitle}>播放列表</Text><Text style={styles.playlistMeta}>{source || "当前线路"} · {playlist.length} 集 · 当前第 {currentIndex >= 0 ? currentIndex + 1 : 1} 集</Text></View><View style={styles.switchActions}><Pressable disabled={currentIndex <= 0} onPress={() => playEpisodeAt(currentIndex - 1)} style={({ pressed }) => [styles.switchButton, currentIndex <= 0 && styles.switchDisabled, pressed && styles.pressed]}><Text style={styles.switchText}>上一集</Text></Pressable><Pressable disabled={currentIndex < 0 || currentIndex >= playlist.length - 1} onPress={() => playEpisodeAt(currentIndex + 1)} style={({ pressed }) => [styles.switchButton, currentIndex < 0 || currentIndex >= playlist.length - 1 ? styles.switchDisabled : styles.switchPrimary, pressed && styles.pressed]}><Text style={[styles.switchText, currentIndex >= 0 && currentIndex < playlist.length - 1 && styles.switchPrimaryText]}>下一集</Text></Pressable></View></View><FlatList data={playlist} key="playlist-grid" numColumns={4} scrollEnabled={false} keyExtractor={(item, index) => `${item.url}-${index}`} contentContainerStyle={styles.playlistList} columnWrapperStyle={playlist.length ? styles.playlistRow : undefined} renderItem={({ item, index }) => { const downloaded = offlineUrls.has(item.url); const size = offlineSizes.get(item.url); return <Pressable onPress={() => playEpisodeAt(index)} style={({ pressed }) => [styles.playlistItem, downloaded && styles.playlistItemDownloaded, index === currentIndex && styles.playlistItemActive, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.playlistItemText, index === currentIndex && styles.playlistItemTextActive]}>{item.name}</Text>{downloaded ? <Text style={[styles.downloadedTag, index === currentIndex && styles.downloadedTagActive]}>已下载 · {formatFileSize(size ?? 0)}</Text> : null}</Pressable>; }} /></View> : null}</ScrollView></ScreenContainer><GlobalBottomNavigation /></View>;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  scrollContent: { paddingBottom: 108 },
  header: { height: 66, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#283452" },
  back: { paddingVertical: 9, paddingRight: 14 },
  backLabel: { color: "#B8D8FA", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: "#F4F6FA", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  episode: { color: "#9CA7BE", fontSize: 11, lineHeight: 16, marginTop: 1 },
  playerWrap: { paddingTop: 18 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#050812" },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 18, paddingTop: 11 },
  statusText: { color: "#8796B0", fontSize: 12, lineHeight: 18, flex: 1 },
  offlineBadge: { color: "#A9E2BE", fontSize: 11, lineHeight: 17, fontWeight: "800", backgroundColor: "#1F523F", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  sourcePanel: { marginHorizontal: 18, marginTop: 22 },
  sourceTitle: { color: "#F2F4F8", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  sourceHint: { color: "#8F9CAF", fontSize: 10, lineHeight: 15, marginTop: 1 },
  sourceList: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 11 },
  sourceChip: { minHeight: 37, paddingHorizontal: 13, justifyContent: "center", borderRadius: 10, backgroundColor: "#20293A", borderWidth: 1, borderColor: "#3A4965" },
  sourceChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  sourceChipText: { color: "#C9D5E5", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  sourceChipTextActive: { color: "#151821" },
  playlistPanel: { marginHorizontal: 18, marginTop: 24, padding: 14, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2C3B58" },
  episodeHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  playlistTitle: { color: "#F2F4F8", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  playlistMeta: { color: "#8F9CAF", fontSize: 11, lineHeight: 16, marginTop: 2 },
  switchActions: { flexDirection: "row", gap: 7 },
  switchButton: { height: 30, paddingHorizontal: 9, borderRadius: 8, justifyContent: "center", borderWidth: 1, borderColor: "#40516D", backgroundColor: "#202B40" },
  switchPrimary: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  switchDisabled: { opacity: 0.38 },
  switchText: { color: "#C5D7EE", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  switchPrimaryText: { color: "#141821" },
  playlistList: { paddingTop: 14 },
  playlistRow: { justifyContent: "space-between", marginBottom: 8 },
  playlistItem: { width: "23.5%", height: 45, paddingHorizontal: 5, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "#20293A" },
  playlistItemDownloaded: { backgroundColor: "#1A4036", borderWidth: 1, borderColor: "#317B66" },
  playlistItemActive: { backgroundColor: "#F5B64B" },
  playlistItemText: { color: "#D5DEEA", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  playlistItemTextActive: { color: "#151821" },
  downloadedTag: { color: "#9CE0BE", fontSize: 8, lineHeight: 11, fontWeight: "900", marginTop: 1 },
  downloadedTagActive: { color: "#514116" },
  unsupported: { padding: 28, margin: 18, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2F4163" },
  unsupportedTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 16, lineHeight: 23 },
  unsupportedText: { color: "#AEB9CB", fontSize: 13, lineHeight: 21, marginTop: 9 },
  externalButton: { alignSelf: "flex-start", marginTop: 18, height: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 11, backgroundColor: "#F5B64B" },
  externalText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  errorTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 18, lineHeight: 25 },
  backButton: { height: 42, paddingHorizontal: 16, justifyContent: "center", borderRadius: 11, backgroundColor: "#F5B64B", marginTop: 18 },
  backText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
