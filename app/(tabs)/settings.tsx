import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { clearVideoCacheAsync, getCurrentVideoCacheSize } from "expo-video";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { clearLocalVodData, getLocalCacheSummary, type SavedMacCmsSource } from "@/lib/vod-storage";
import { clearOfflineDownloads, getOfflineSummary } from "@/lib/offline-downloads";
import { useVodSource } from "@/lib/vod-context";
import { useDownloadQueue } from "@/lib/download-queue-context";
import { clearQueueTasks, formatStorageLimit } from "@/lib/download-queue";

interface CacheSummary { playbackLists: number; searches: number; history: number; videoBytes: number | null; offlineCount: number; offlineBytes: number }

export default function SettingsScreen() {
  const { endpoint, sources, categories, configureSource, switchSource, deleteSource, checkSource, renameSource, reorderSource, sourceError } = useVodSource();
  const { settings } = useDownloadQueue();
  const router = useRouter();
  const [domain, setDomain] = useState(endpoint?.inputDomain ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceDisplayName, setSourceDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [cache, setCache] = useState<CacheSummary>({ playbackLists: 0, searches: 0, history: 0, videoBytes: null, offlineCount: 0, offlineBytes: 0 });
  const activeSource = sources.find((source) => source.id === endpoint?.apiUrl);

  const loadCacheSummary = useCallback(async () => {
    const local = await getLocalCacheSummary();
    const offline = await getOfflineSummary();
    const videoBytes = Platform.OS === "android" ? getCurrentVideoCacheSize() : null;
    setCache({ ...local, videoBytes, offlineCount: offline.count, offlineBytes: offline.sizeBytes });
  }, []);

  useEffect(() => {
    setDomain(endpoint?.inputDomain ?? "");
    void loadCacheSummary();
  }, [endpoint, loadCacheSummary]);

  const detectAndSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await configureSource(domain);
      setDomain(result.inputDomain);
      setMessage("已识别并保存 MACCMS 数据接口。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据源识别失败");
    } finally {
      setIsSaving(false);
    }
  };

  const runCheck = async (id: string) => {
    setCheckingId(id);
    await checkSource(id);
    setCheckingId(null);
  };

  const confirmDeleteSource = (source: SavedMacCmsSource) => {
    Alert.alert("删除数据源", `确定删除 ${source.displayName} 吗？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { void deleteSource(source.id); } },
    ]);
  };

  const beginRename = (source: SavedMacCmsSource) => {
    setEditingSourceId(source.id);
    setSourceDisplayName(source.displayName);
  };

  const saveSourceName = async (id: string) => {
    await renameSource(id, sourceDisplayName);
    setEditingSourceId(null);
    setMessage("数据源名称已保存。");
  };

  const clearCaches = () => {
    Alert.alert("清理本地缓存", "将清除已缓存的播放列表、搜索与观看记录，以及海报缓存。", [
      { text: "取消", style: "cancel" },
      {
        text: "清理",
        style: "destructive",
        onPress: () => { void runClearCaches(); },
      },
    ]);
  };

  const runClearCaches = async () => {
    try {
      await clearLocalVodData();
      await clearOfflineDownloads();
      await clearQueueTasks();
      await Image.clearMemoryCache();
      await Image.clearDiskCache();
      if (Platform.OS === "android") await clearVideoCacheAsync();
      await loadCacheSummary();
      setMessage("本地缓存已清理；数据源配置会继续保留。");
    } catch {
      setMessage("部分缓存正在被播放器占用，请退出播放页后重试。");
    }
  };

  return (
    <ScreenContainer containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.profileHeader}><Image source={require("@/assets/images/icon.png")} style={styles.profileIcon} /><View style={styles.profileCopy}><Text style={styles.heading}>我的飞鸿影院</Text><Text numberOfLines={1} style={styles.lead}>{activeSource?.displayName || "本地影视内容库"}</Text></View></View>
        <View style={styles.overviewList}><Pressable onPress={() => router.navigate("/history" as never)} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}><View style={styles.overviewIcon}><Text style={styles.overviewGlyph}>◷</Text></View><View style={styles.overviewCopy}><Text style={styles.overviewTitle}>观看记录</Text><Text style={styles.overviewText}>{cache.history ? `${cache.history} 条记录，可继续观看` : "暂无观看记录"}</Text></View><Text style={styles.overviewArrow}>›</Text></Pressable><Pressable onPress={() => router.navigate("/downloads" as never)} style={({ pressed }) => [styles.overviewCard, styles.downloadOverview, pressed && styles.pressed]}><View style={[styles.overviewIcon, styles.downloadOverviewIcon]}><Text style={[styles.overviewGlyph, styles.downloadOverviewGlyph]}>↓</Text></View><View style={styles.overviewCopy}><Text style={styles.overviewTitle}>已下载剧集</Text><Text style={styles.overviewText}>{cache.offlineCount ? `${cache.offlineCount} 集 · ${formatBytes(cache.offlineBytes)}` : "暂无已下载剧集"}</Text></View><Text style={[styles.overviewArrow, styles.downloadOverviewGlyph]}>›</Text></Pressable></View>
        <View style={styles.preferenceCard}><View style={styles.preferenceRow}><View><Text style={styles.preferenceTitle}>仅在 Wi‑Fi 下载</Text><Text style={styles.preferenceText}>{settings?.wifiOnly ? "开启后不会使用移动数据下载剧集" : "已允许使用移动数据下载"}</Text></View><View style={[styles.preferencePill, settings?.wifiOnly && styles.preferencePillActive]}><Text style={styles.preferencePillText}>{settings?.wifiOnly ? "已开启" : "已关闭"}</Text></View></View><View style={styles.preferenceDivider} /><View style={styles.preferenceRow}><View><Text style={styles.preferenceTitle}>最大缓存容量</Text><Text style={styles.preferenceText}>当前 {formatBytes(cache.offlineBytes)} / {settings ? formatStorageLimit(settings.storageLimitBytes) : "—"}</Text></View><Pressable onPress={() => router.navigate("/downloads" as never)} style={({ pressed }) => [styles.preferenceLink, pressed && styles.pressed]}><Text style={styles.preferenceLinkText}>管理 ›</Text></Pressable></View></View>
        <View style={styles.section}>
          <Text style={styles.label}>MACCMS 站点域名</Text>
          <TextInput value={domain} onChangeText={setDomain} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={() => void detectAndSave()} placeholder="例如：https://example.com" placeholderTextColor="#71809B" style={styles.input} />
          <Pressable disabled={isSaving} onPress={() => void detectAndSave()} style={({ pressed }) => [styles.primaryButton, (pressed || isSaving) && styles.pressed, isSaving && styles.disabled]}>
            {isSaving ? <ActivityIndicator color="#10182B" /> : <Text style={styles.primaryText}>添加并识别数据源</Text>}
          </Pressable>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {sourceError ? <Text style={styles.error}>{sourceError}</Text> : null}
        </View>
        <View style={styles.section}>
          <View style={styles.sourceHeading}><View><Text style={styles.sectionTitle}>数据源管理</Text><Text style={styles.sourceIntro}>可添加、重命名、排序、切换与检测 MACCMS API。</Text></View><Text style={styles.sourceCount}>{sources.length} 个</Text></View>
          {sources.length ? sources.map((source, index) => (
            <View key={source.id} style={[styles.sourceItem, endpoint?.apiUrl === source.id && styles.sourceItemActive]}>
              {editingSourceId === source.id ? (
                <View style={styles.renameRow}>
                  <TextInput value={sourceDisplayName} onChangeText={setSourceDisplayName} autoFocus returnKeyType="done" onSubmitEditing={() => void saveSourceName(source.id)} placeholder="数据源名称" placeholderTextColor="#71809B" style={styles.renameInput} />
                  <Pressable onPress={() => void saveSourceName(source.id)} style={({ pressed }) => [styles.renameSave, pressed && styles.pressed]}><Text style={styles.renameSaveText}>保存</Text></Pressable>
                  <Pressable onPress={() => setEditingSourceId(null)} style={({ pressed }) => [styles.renameCancel, pressed && styles.pressed]}><Text style={styles.miniActionText}>取消</Text></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => void switchSource(source.id)} style={({ pressed }) => [styles.sourceMain, pressed && styles.pressed]}>
                  <View style={[styles.healthDot, source.health === "healthy" ? styles.healthGood : source.health === "unhealthy" ? styles.healthBad : styles.healthUnknown]} />
                  <View style={styles.sourceInfo}><Text numberOfLines={1} style={styles.sourceName}>{source.displayName}</Text><Text numberOfLines={1} style={styles.sourceMeta}>{source.endpoint.inputDomain} · {source.health === "healthy" ? "连接正常" : source.health === "unhealthy" ? source.lastError || "连接异常" : "尚未检测"}{source.lastCheckedAt ? ` · ${new Date(source.lastCheckedAt).toLocaleString("zh-CN")}` : ""}</Text></View>
                  {endpoint?.apiUrl === source.id ? <Text style={styles.currentTag}>当前</Text> : null}
                </Pressable>
              )}
              <View style={styles.sourceActions}>
                <Pressable onPress={() => beginRename(source)} style={({ pressed }) => [styles.miniAction, pressed && styles.pressed]}><Text style={styles.miniActionText}>改名</Text></Pressable>
                <Pressable onPress={() => void reorderSource(source.id, -1)} disabled={index === 0} style={({ pressed }) => [styles.miniAction, index === 0 && styles.disabled, pressed && styles.pressed]}><Text style={styles.miniActionText}>上移</Text></Pressable>
                <Pressable onPress={() => void reorderSource(source.id, 1)} disabled={index === sources.length - 1} style={({ pressed }) => [styles.miniAction, index === sources.length - 1 && styles.disabled, pressed && styles.pressed]}><Text style={styles.miniActionText}>下移</Text></Pressable>
                <Pressable onPress={() => void runCheck(source.id)} disabled={checkingId === source.id} style={({ pressed }) => [styles.miniAction, (pressed || checkingId === source.id) && styles.pressed]}>{checkingId === source.id ? <ActivityIndicator color="#B7D6F7" size="small" /> : <Text style={styles.miniActionText}>检测</Text>}</Pressable>
                <Pressable onPress={() => confirmDeleteSource(source)} style={({ pressed }) => [styles.miniAction, styles.removeAction, pressed && styles.pressed]}><Text style={styles.removeActionText}>删除</Text></Pressable>
              </View>
            </View>
          )) : <Text style={styles.meta}>尚未配置数据源</Text>}
          {endpoint ? <><Text numberOfLines={1} style={styles.endpoint}>{endpoint.apiUrl}</Text><Text style={styles.meta}>当前已识别 {categories.length} 个一级分类</Text></> : null}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>本地缓存</Text>
          <View style={styles.cacheGrid}>
            <CacheItem label="播放列表" value={String(cache.playbackLists)} />
            <CacheItem label="搜索记录" value={String(cache.searches)} />
            <CacheItem label="观看记录" value={String(cache.history)} />
            <CacheItem label="视频缓存" value={cache.videoBytes === null ? "—" : formatBytes(cache.videoBytes)} />
            <CacheItem label="离线剧集" value={`${cache.offlineCount} · ${formatBytes(cache.offlineBytes)}`} />
          </View>
          <Pressable onPress={clearCaches} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryText}>清理本地缓存</Text></Pressable>
          <Text style={styles.cacheHint}>影片播放线路和剧集信息会保存在设备中；海报使用磁盘缓存。已下载的 MP4、WebM 或无加密点播 HLS 会保存在应用离线空间，可在无网络时播放。</Text>
        </View>
        <View style={styles.note}><Text style={styles.noteTitle}>播放说明</Text><Text style={styles.noteText}>支持直接播放的常见 MP4、M3U8 等地址会进入原生播放器。其他网页型地址会保留清晰提示，以便你在浏览器中打开。</Text></View>
      </ScrollView>
    </ScreenContainer>
  );
}

function CacheItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.cacheItem}><Text style={styles.cacheValue}>{value}</Text><Text style={styles.cacheLabel}>{label}</Text></View>;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingTop: 23, paddingBottom: 36 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 19 },
  profileIcon: { width: 49, height: 49, borderRadius: 15 },
  profileCopy: { flex: 1, minWidth: 0 },
  heading: { color: "#F6F7FB", fontSize: 27, fontWeight: "800", lineHeight: 35 },
  lead: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 1 },
  overviewList: { gap: 11 },
  overviewCard: { minHeight: 82, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderRadius: 17, backgroundColor: "#202B3D", borderWidth: 1, borderColor: "#2C3A53" },
  downloadOverview: { backgroundColor: "#143A31", borderColor: "#317360" },
  overviewIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: "#162138", alignItems: "center", justifyContent: "center" },
  downloadOverviewIcon: { backgroundColor: "#0C3028" },
  overviewGlyph: { color: "#F7C46B", fontSize: 23, lineHeight: 26, fontWeight: "900" },
  downloadOverviewGlyph: { color: "#89E0BF" },
  overviewCopy: { flex: 1, minWidth: 0, marginLeft: 12 },
  overviewTitle: { color: "#F4F7FA", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  overviewText: { color: "#AAB5C7", fontSize: 11, lineHeight: 17, marginTop: 2 },
  overviewArrow: { color: "#B5C3D7", fontSize: 28, lineHeight: 31, fontWeight: "500" },
  preferenceCard: { marginTop: 15, borderRadius: 17, paddingHorizontal: 16, paddingVertical: 15, backgroundColor: "#151928", borderWidth: 1, borderColor: "#2B344A" },
  preferenceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  preferenceTitle: { color: "#EDF1F7", fontSize: 14, lineHeight: 20, fontWeight: "900" },
  preferenceText: { color: "#99A6BA", fontSize: 11, lineHeight: 17, marginTop: 2 },
  preferencePill: { minWidth: 53, height: 28, borderRadius: 14, paddingHorizontal: 9, backgroundColor: "#3E3440", justifyContent: "center", alignItems: "center" },
  preferencePillActive: { backgroundColor: "#806026" },
  preferencePillText: { color: "#F4D393", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  preferenceDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#344058", marginVertical: 13 },
  preferenceLink: { height: 31, paddingHorizontal: 9, justifyContent: "center", borderRadius: 8, backgroundColor: "#1F2A3E" },
  preferenceLinkText: { color: "#F6C36A", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  section: { marginTop: 22, padding: 16, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#283452" },
  label: { color: "#DCE2EE", fontWeight: "700", fontSize: 13, lineHeight: 19, marginBottom: 9 },
  input: { height: 47, borderRadius: 11, borderWidth: 1, borderColor: "#344464", backgroundColor: "#0F1729", color: "#F6F7FB", fontSize: 14, paddingHorizontal: 12, paddingVertical: 0 },
  primaryButton: { height: 45, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "#F5B64B", marginTop: 12 },
  primaryText: { color: "#11192B", fontWeight: "800", fontSize: 14 },
  message: { color: "#93D6AE", fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { color: "#F8C174", fontSize: 12, lineHeight: 18, marginTop: 10 },
  sectionTitle: { color: "#F4F6FA", fontSize: 15, fontWeight: "800", lineHeight: 21, marginBottom: 10 },
  sourceHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  sourceIntro: { color: "#8896AD", fontSize: 11, lineHeight: 16, marginTop: -6, marginBottom: 10 },
  sourceCount: { color: "#F5C66E", fontSize: 11, lineHeight: 16, fontWeight: "800", backgroundColor: "#2A2533", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sourceItem: { backgroundColor: "#0F1729", borderWidth: 1, borderColor: "#2C3953", borderRadius: 11, marginTop: 8, padding: 10 },
  sourceItemActive: { borderColor: "#C99037", backgroundColor: "#1C2133" },
  sourceMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  healthGood: { backgroundColor: "#69C89B" },
  healthBad: { backgroundColor: "#E27878" },
  healthUnknown: { backgroundColor: "#9AA8BC" },
  sourceInfo: { flex: 1, minWidth: 0 },
  sourceName: { color: "#EEF2F8", fontSize: 13, lineHeight: 19, fontWeight: "800" },
  sourceMeta: { color: "#8E9CB0", fontSize: 10, lineHeight: 15, marginTop: 1 },
  renameRow: { flexDirection: "row", gap: 7, alignItems: "center" },
  renameInput: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, borderColor: "#536B92", color: "#F6F7FB", backgroundColor: "#0B1221", fontSize: 12, paddingHorizontal: 9, paddingVertical: 0 },
  renameSave: { height: 30, paddingHorizontal: 9, borderRadius: 7, justifyContent: "center", backgroundColor: "#F5B64B" },
  renameSaveText: { color: "#10182B", fontSize: 10, fontWeight: "900" },
  renameCancel: { height: 30, paddingHorizontal: 8, borderWidth: 1, borderColor: "#3D5577", borderRadius: 7, justifyContent: "center" },
  currentTag: { color: "#11192B", fontSize: 10, fontWeight: "900", backgroundColor: "#F5B64B", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  sourceActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 9 },
  miniAction: { minWidth: 48, height: 27, paddingHorizontal: 9, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#3D5577", borderRadius: 7 },
  miniActionText: { color: "#B7D6F7", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  removeAction: { borderColor: "#70414D" },
  removeActionText: { color: "#E8A8AF", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  endpoint: { color: "#A6CEF6", fontSize: 12, lineHeight: 19, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), backgroundColor: "#0F1729", padding: 10, borderRadius: 9 },
  meta: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 9 },
  cacheGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  cacheItem: { width: "48%", backgroundColor: "#0F1729", paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  cacheValue: { color: "#F6F7FB", fontSize: 16, lineHeight: 22, fontWeight: "800" },
  cacheLabel: { color: "#8290A8", fontSize: 11, lineHeight: 16, marginTop: 2 },
  secondaryButton: { borderWidth: 1, borderColor: "#48648D", height: 42, borderRadius: 11, justifyContent: "center", alignItems: "center", marginTop: 14 },
  secondaryText: { color: "#B7D6F7", fontWeight: "700", fontSize: 13 },
  cacheHint: { color: "#8592AB", fontSize: 11, lineHeight: 17, marginTop: 10 },
  note: { marginTop: 16, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 14, backgroundColor: "#192945" },
  noteTitle: { color: "#F8D28D", fontSize: 13, fontWeight: "800", lineHeight: 19 },
  noteText: { color: "#B5C1D5", fontSize: 12, lineHeight: 19, marginTop: 4 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.6 },
});
