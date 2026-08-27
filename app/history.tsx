import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";

import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { ScreenContainer } from "@/components/screen-container";
import { VodPoster } from "@/components/vod-poster";
import { buildHistoryPlaybackParams } from "@/lib/history-playback";
import { clearWatchHistory, getWatchHistory, type WatchHistoryEntry } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

export default function HistoryScreen() {
  const router = useRouter();
  const { endpoint } = useVodSource();
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = async () => {
    setIsLoading(true);
    try { setHistory(await getWatchHistory()); }
    finally { setIsLoading(false); }
  };

  useEffect(() => { void loadHistory(); }, []);

  const confirmClear = () => {
    if (!history.length) return;
    Alert.alert("清空观看记录", "仅清除本设备的观看记录，不会删除缓存和已下载剧集。", [
      { text: "取消", style: "cancel" },
      { text: "清空", style: "destructive", onPress: () => { void clearWatchHistory().then(() => setHistory([])); } },
    ]);
  };

  const resumeHistory = async (entry: WatchHistoryEntry) => {
    if (!endpoint) { Alert.alert("无法继续播放", "请先在“我的”页面配置可用的数据源。"); return; }
    try {
      const params = await buildHistoryPlaybackParams(entry, endpoint);
      router.push({ pathname: "/player", params } as never);
    } catch (error) {
      Alert.alert("无法继续播放", error instanceof Error ? error.message : "该记录暂时无法恢复播放位置。");
    }
  };

  return <View style={styles.page}><ScreenContainer containerClassName="bg-background"><FlatList data={history} keyExtractor={(item, index) => `${item.id}-${item.episodeName}-${item.watchedAt}-${index}`} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} ListHeaderComponent={<View style={styles.header}><View><Text style={styles.eyebrow}>WATCH HISTORY</Text><Text style={styles.heading}>观看记录</Text><Text style={styles.lead}>{history.length ? `共 ${history.length} 条记录，选择影片即可继续观看。` : "最近看过的影片会保存在本机。"}</Text></View><Pressable disabled={!history.length} onPress={confirmClear} style={({ pressed }) => [styles.clearButton, !history.length && styles.disabled, pressed && styles.pressed]}><Text style={styles.clearText}>清空</Text></Pressable></View>} renderItem={({ item }) => <Pressable onPress={() => void resumeHistory(item)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}><VodPoster title={item.name} url={item.posterUrl} style={styles.poster} /><View style={styles.itemCopy}><Text numberOfLines={2} style={styles.itemTitle}>{item.name}</Text><Text numberOfLines={1} style={styles.itemMeta}>{item.sourceName} · {item.episodeName || "影视内容"}</Text><Text style={styles.itemTime}>{item.positionSeconds ? `已看到 ${formatDuration(item.positionSeconds)} · ` : ""}{formatWatchedAt(item.watchedAt)}</Text></View><Text style={styles.itemArrow}>›</Text></Pressable>} ListEmptyComponent={isLoading ? <View style={styles.loading}><ActivityIndicator size="large" color="#FFB84D" /></View> : <View style={styles.empty}><Text style={styles.emptyGlyph}>◷</Text><Text style={styles.emptyTitle}>暂无观看记录</Text><Text style={styles.emptyText}>开始播放影片后，记录会自动出现在这里。</Text><Pressable onPress={() => router.navigate("/" as never)} style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}><Text style={styles.homeText}>去首页浏览</Text></Pressable></View>} refreshControl={undefined} /></ScreenContainer><GlobalBottomNavigation /></View>;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatWatchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近观看";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 18, paddingBottom: 112 },
  header: { paddingTop: 9, paddingBottom: 19, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  eyebrow: { color: "#FFB84D", fontSize: 10, lineHeight: 15, letterSpacing: 1.6, fontWeight: "900" },
  heading: { color: "#F7F9FC", fontSize: 29, lineHeight: 37, fontWeight: "900", marginTop: 2 },
  lead: { color: "#98A6BA", fontSize: 12, lineHeight: 18, marginTop: 3, maxWidth: 255 },
  clearButton: { height: 31, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: "#70414D", justifyContent: "center" },
  clearText: { color: "#E6A5AD", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  item: { minHeight: 108, flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 16, backgroundColor: "#171F30", borderWidth: 1, borderColor: "#2A3650", marginBottom: 10 },
  poster: { width: 58, height: 84, borderRadius: 10 },
  itemCopy: { flex: 1, minWidth: 0, paddingHorizontal: 12 },
  itemTitle: { color: "#F1F4F8", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  itemMeta: { color: "#B3BFCE", fontSize: 11, lineHeight: 16, marginTop: 5 },
  itemTime: { color: "#8190A7", fontSize: 11, lineHeight: 16, marginTop: 5 },
  itemArrow: { color: "#F4BE61", fontSize: 28, lineHeight: 30, paddingHorizontal: 4 },
  loading: { paddingVertical: 70, alignItems: "center" },
  empty: { alignItems: "center", paddingVertical: 75, paddingHorizontal: 30 },
  emptyGlyph: { color: "#FFB84D", fontSize: 40, lineHeight: 48, fontWeight: "900" },
  emptyTitle: { color: "#EDF2F8", fontSize: 18, lineHeight: 25, fontWeight: "900", marginTop: 10 },
  emptyText: { color: "#94A1B4", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 6 },
  homeButton: { height: 42, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#FFB84D", justifyContent: "center", marginTop: 19 },
  homeText: { color: "#151821", fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
