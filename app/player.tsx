import { useEffect } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { isDirectVideoUrl } from "@/lib/maccms";

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string; episode?: string; source?: string }>();
  const router = useRouter();
  const url = Array.isArray(params.url) ? params.url[0] : params.url;
  const title = Array.isArray(params.title) ? params.title[0] : (params.title ?? "影片播放");
  const episode = Array.isArray(params.episode) ? params.episode[0] : (params.episode ?? "");
  const directPlayable = Boolean(url && isDirectVideoUrl(url));
  const player = useVideoPlayer(directPlayable ? { uri: url, useCaching: Platform.OS === "android" } : null, (instance) => { instance.play(); });

  useEffect(() => () => { player.pause(); }, [player]);

  const openExternal = async () => {
    if (!url) return;
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
  };

  if (!url) return <ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>播放地址无效</Text><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回详情</Text></Pressable></ScreenContainer>;

  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹ 返回</Text></Pressable><View style={styles.headerInfo}><Text numberOfLines={1} style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.episode}>{episode || "正在播放"}</Text></View></View>
      {directPlayable ? <View style={styles.playerWrap}><VideoView style={styles.video} player={player} nativeControls allowsFullscreen allowsPictureInPicture contentFit="contain" surfaceType="textureView" /><View style={styles.statusRow}><ActivityIndicator size="small" color="#F5B64B" /><Text style={styles.statusText}>播放器正在准备媒体；视频缓存由系统自动管理。</Text></View></View> : <View style={styles.unsupported}><Text style={styles.unsupportedTitle}>此线路不是可直接播放的视频地址</Text><Text style={styles.unsupportedText}>该数据源提供了网页型或解析型地址。你可以返回详情页切换线路，或在浏览器中打开。</Text><Pressable onPress={() => void openExternal()} style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}><Text style={styles.externalText}>在浏览器打开</Text></Pressable></View>}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { height: 66, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#283452" },
  back: { paddingVertical: 9, paddingRight: 14 },
  backLabel: { color: "#B8D8FA", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: "#F4F6FA", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  episode: { color: "#9CA7BE", fontSize: 11, lineHeight: 16, marginTop: 1 },
  playerWrap: { paddingTop: 28 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#050812" },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 18, paddingTop: 13 },
  statusText: { color: "#8796B0", fontSize: 12, lineHeight: 18 },
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
