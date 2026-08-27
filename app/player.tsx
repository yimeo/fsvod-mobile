import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { isDirectVideoUrl } from "@/lib/maccms";

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

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string; episode?: string; source?: string; offline?: string; playlist?: string; episodeIndex?: string }>();
  const router = useRouter();
  const url = getParam(params.url);
  const title = getParam(params.title, "影片播放");
  const episode = getParam(params.episode);
  const source = getParam(params.source);
  const offline = getParam(params.offline) === "1";
  const playlist = useMemo(() => parsePlaylist(getParam(params.playlist)), [params.playlist]);
  const preferredIndex = Number.parseInt(getParam(params.episodeIndex), 10);
  const currentIndex = useMemo(() => {
    const fromUrl = playlist.findIndex((item) => item.url === url);
    return fromUrl >= 0 ? fromUrl : Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < playlist.length ? preferredIndex : -1;
  }, [playlist, preferredIndex, url]);
  const directPlayable = Boolean(url && isDirectVideoUrl(url));
  const player = useVideoPlayer(null);

  useEffect(() => {
    if (!directPlayable) { player.pause(); return; }
    let active = true;
    void player.replaceAsync({ uri: url, useCaching: Platform.OS === "android" }).then(() => { if (active) player.play(); });
    return () => { active = false; player.pause(); };
  }, [directPlayable, player, url]);

  const openExternal = async () => {
    if (!url) return;
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  };

  const playEpisodeAt = (index: number) => {
    const next = playlist[index];
    if (!next) return;
    router.replace({ pathname: "/player", params: { url: next.url, title, episode: next.name, source, offline: "0", episodeIndex: String(index), playlist: JSON.stringify(playlist) } } as never);
  };

  if (!url) return <View style={styles.page}><ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>播放地址无效</Text><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回详情</Text></Pressable></ScreenContainer><GlobalBottomNavigation /></View>;

  return <View style={styles.page}><ScreenContainer containerClassName="bg-background" edges={["top", "bottom", "left", "right"]}><View style={styles.header}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹ 返回</Text></Pressable><View style={styles.headerInfo}><Text numberOfLines={1} style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.episode}>{episode || "正在播放"}{source ? ` · ${source}` : ""}</Text></View></View>{directPlayable ? <View style={styles.playerWrap}><VideoView style={styles.video} player={player} nativeControls allowsFullscreen allowsPictureInPicture contentFit="contain" surfaceType="textureView" /><View style={styles.statusRow}>{offline ? <Text style={styles.offlineBadge}>离线播放</Text> : <ActivityIndicator size="small" color="#F5B64B" />}<Text style={styles.statusText}>{offline ? "正在使用设备中的本地下载媒体。" : "正在播放网络媒体。"}</Text></View></View> : <View style={styles.unsupported}><Text style={styles.unsupportedTitle}>此线路不是可直接播放的视频地址</Text><Text style={styles.unsupportedText}>该数据源提供了网页型或解析型地址。你可以切换剧集、返回详情切换线路，或在浏览器中打开。</Text><Pressable onPress={() => void openExternal()} style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}><Text style={styles.externalText}>在浏览器打开</Text></Pressable></View>}{playlist.length ? <View style={styles.playlistPanel}><View style={styles.episodeHeading}><View><Text style={styles.playlistTitle}>播放列表</Text><Text style={styles.playlistMeta}>{playlist.length} 集 · 当前第 {currentIndex >= 0 ? currentIndex + 1 : 1} 集</Text></View><View style={styles.switchActions}><Pressable disabled={currentIndex <= 0} onPress={() => playEpisodeAt(currentIndex - 1)} style={({ pressed }) => [styles.switchButton, currentIndex <= 0 && styles.switchDisabled, pressed && styles.pressed]}><Text style={styles.switchText}>上一集</Text></Pressable><Pressable disabled={currentIndex < 0 || currentIndex >= playlist.length - 1} onPress={() => playEpisodeAt(currentIndex + 1)} style={({ pressed }) => [styles.switchButton, currentIndex < 0 || currentIndex >= playlist.length - 1 ? styles.switchDisabled : styles.switchPrimary, pressed && styles.pressed]}><Text style={[styles.switchText, currentIndex >= 0 && currentIndex < playlist.length - 1 && styles.switchPrimaryText]}>下一集</Text></Pressable></View></View><FlatList horizontal data={playlist} keyExtractor={(item, index) => `${item.url}-${index}`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.playlistList} renderItem={({ item, index }) => <Pressable onPress={() => playEpisodeAt(index)} style={({ pressed }) => [styles.playlistItem, index === currentIndex && styles.playlistItemActive, pressed && styles.pressed]}><Text numberOfLines={1} style={[styles.playlistItemText, index === currentIndex && styles.playlistItemTextActive]}>{item.name}</Text></Pressable>} /></View> : null}</ScreenContainer><GlobalBottomNavigation /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  header: { height: 66, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#283452" },
  back: { paddingVertical: 9, paddingRight: 14 },
  backLabel: { color: "#B8D8FA", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: "#F4F6FA", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  episode: { color: "#9CA7BE", fontSize: 11, lineHeight: 16, marginTop: 1 },
  playerWrap: { paddingTop: 18 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#050812" },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 18, paddingTop: 11 },
  statusText: { color: "#8796B0", fontSize: 12, lineHeight: 18 },
  offlineBadge: { color: "#A9E2BE", fontSize: 11, lineHeight: 17, fontWeight: "800", backgroundColor: "#1F523F", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
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
  playlistList: { gap: 8, marginTop: 14, paddingRight: 8 },
  playlistItem: { minWidth: 68, maxWidth: 108, height: 35, paddingHorizontal: 10, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "#20293A" },
  playlistItemActive: { backgroundColor: "#F5B64B" },
  playlistItemText: { color: "#D5DEEA", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  playlistItemTextActive: { color: "#151821" },
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
