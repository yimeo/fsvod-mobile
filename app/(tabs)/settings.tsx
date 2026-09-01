import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { clearVideoCacheAsync, getCurrentVideoCacheSize } from "expo-video";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { ScreenContainer } from "@/components/screen-container";
import { SourceQuickSwitcher } from "@/components/source-quick-switcher";
import { DEFAULT_LIST_PAGE_SIZE, clearPlaybackLists, clearSearches, clearWatchHistory, getCategoryClassicPageSize, getCategoryPageMode, getLocalCacheSummary, getSourceTypeLabel, saveCategoryClassicPageSize, saveCategoryPageMode, type CategoryClassicPageSize, type CategoryPageMode, type SavedMacCmsSource } from "@/lib/vod-storage";
import { clearPosterCache, getPosterCacheSummary, subscribePosterCacheChanges } from "@/lib/poster-cache";
import { clearOfflineDownloads, getOfflineSummary, getVideoCacheSummary } from "@/lib/offline-downloads";
import { useVodSource } from "@/lib/vod-context";
import { clearCompletedQueueTasks } from "@/lib/download-queue";
import { toChineseNetworkError } from "@/lib/network-error";

interface CacheSummary { playbackLists: number; searches: number; history: number; posterCount: number; posterBytes: number; videoBytes: number; offlineCount: number; offlineBytes: number }

type CacheClearTarget = "playlist" | "searches" | "posters" | "history" | "offline" | "video";

const CACHE_CLEAR_LABELS: Record<CacheClearTarget, string> = {
  playlist: "播放列表",
  searches: "搜索记录",
  posters: "海报缓存",
  history: "观看记录",
  offline: "离线剧集",
  video: "视频缓存",
};

export default function SettingsScreen() {
  const { endpoint, sources, categories, configureSource, switchSource, deleteSource, checkSource, updateSource, reorderSource, sourceError, officialResourceSync, syncOfficialResources } = useVodSource();
  const router = useRouter();
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceAddress, setNewSourceAddress] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [completedCheckIds, setCompletedCheckIds] = useState<string[]>([]);
  const [switchingSourceId, setSwitchingSourceId] = useState<string | null>(null);
  const [isOfficialSyncing, setIsOfficialSyncing] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceDisplayName, setSourceDisplayName] = useState("");
  const [sourceAddress, setSourceAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isClearPanelOpen, setIsClearPanelOpen] = useState(false);
  const [selectedClearTargets, setSelectedClearTargets] = useState<CacheClearTarget[]>([]);
  const [cache, setCache] = useState<CacheSummary>({ playbackLists: 0, searches: 0, history: 0, posterCount: 0, posterBytes: 0, videoBytes: 0, offlineCount: 0, offlineBytes: 0 });
  const [categoryPageMode, setCategoryPageMode] = useState<CategoryPageMode>("auto");
  const [classicPageSize, setClassicPageSize] = useState<CategoryClassicPageSize>(DEFAULT_LIST_PAGE_SIZE);
  const activeSource = sources.find((source) => source.id === endpoint?.apiUrl || source.endpoint.apiUrl === endpoint?.apiUrl);
  const activeSourceTone = activeSource?.health === "healthy" ? "healthy" : activeSource?.health === "unhealthy" ? "unhealthy" : "unknown";
  const clearableRecordCount = cache.playbackLists + cache.searches + cache.history + cache.offlineCount;
  const clearableMediaBytes = cache.videoBytes + cache.offlineBytes;
  const displayedVideoBytes = cache.videoBytes;
  const availableClearTargets = ["playlist", "searches", "posters", "history", "video", "offline"] as CacheClearTarget[];
  const isAllClearTargetsSelected = availableClearTargets.every((target) => selectedClearTargets.includes(target));

  const loadCacheSummary = useCallback(async () => {
    const [local, posters] = await Promise.all([getLocalCacheSummary(), getPosterCacheSummary()]);
    const offline = await getOfflineSummary();
    let videoBytes = 0;
    if (Platform.OS === "android" || Platform.OS === "ios") {
      try {
        const nativeBytes = getCurrentVideoCacheSize();
        const scanned = await getVideoCacheSummary();
        videoBytes = Math.max(nativeBytes, scanned.sizeBytes);
      } catch {
        videoBytes = 0;
      }
    }
    setCache({ ...local, posterCount: posters.count, posterBytes: posters.bytes, videoBytes, offlineCount: offline.count, offlineBytes: offline.sizeBytes });
  }, []);

  useFocusEffect(useCallback(() => {
    void loadCacheSummary();
    return subscribePosterCacheChanges(() => { void loadCacheSummary(); });
  }, [loadCacheSummary]));

  useEffect(() => {
    void Promise.all([getCategoryPageMode(), getCategoryClassicPageSize()]).then(([mode, size]) => {
      setCategoryPageMode(mode);
      setClassicPageSize(size);
    });
  }, []);

  const setPageMode = (mode: CategoryPageMode) => {
    setCategoryPageMode(mode);
    void saveCategoryPageMode(mode);
  };

  const setClassicPageSizePreference = (size: CategoryClassicPageSize) => {
    setClassicPageSize(size);
    void saveCategoryClassicPageSize(size);
  };

  const detectAndSave = async () => {
    const address = newSourceAddress.trim();
    if (!address) { setMessage("请填写数据源地址。"); return; }
    setIsSaving(true);
    setMessage(null);
    try {
      const displayName = newSourceName.trim() || getDefaultSourceName(address);
      const result = await configureSource(address, displayName);
      setNewSourceAddress("");
      setNewSourceName("");
      setIsAddModalVisible(false);
      setMessage(`已识别并保存“${displayName || result.inputDomain}”数据源。`);
    } catch (error) {
      setMessage(toChineseNetworkError(error, "数据源识别失败，请检查地址后重试"));
    } finally {
      setIsSaving(false);
    }
  };

  const runCheck = async (id: string) => {
    if (isSaving || switchingSourceId || checkingId) return;
    setCheckingId(id);
    setCompletedCheckIds((current) => current.filter((item) => item !== id));
    try {
      await checkSource(id);
      setCompletedCheckIds((current) => [...current.filter((item) => item !== id), id]);
    } finally {
      setCheckingId(null);
    }
  };

  const runCheckAll = async () => {
    if (isSaving || switchingSourceId || checkingId || isCheckingAll || sources.length === 0) return;
    setIsCheckingAll(true);
    setMessage("正在检测全部数据源连接和速度，请稍候…");
    try {
      for (const source of sources) await runCheck(source.id);
    } finally {
      setIsCheckingAll(false);
    }
  };

  const runSwitch = async (id: string) => {
    if (isSaving || checkingId || switchingSourceId || endpoint?.apiUrl === id) return;
    const source = sources.find((item) => item.id === id);
    setSwitchingSourceId(id);
    setMessage(`正在验证并切换到“${source?.displayName || "数据源"}”，请稍候…`);
    try {
      const switched = await switchSource(id);
      setMessage(switched ? `已切换到“${source?.displayName || "数据源"}”。` : "数据源连接失败，已保留当前数据源。");
    } finally {
      setSwitchingSourceId(null);
    }
  };

  const runOfficialSync = async () => {
    setIsOfficialSyncing(true);
    try {
      const result = await syncOfficialResources(true);
      setMessage(result.success ? `官方资源已检查，当前可用 ${result.state.resourceCount} 个资源站。` : "官方资源暂时无法访问，已保留现有数据源。");
    } finally {
      setIsOfficialSyncing(false);
    }
  };

  const confirmDeleteSource = (source: SavedMacCmsSource) => {
    Alert.alert("删除数据源", `确定删除 ${source.displayName} 吗？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { void deleteSource(source.id); } },
    ]);
  };

  const beginRename = (source: SavedMacCmsSource) => {
    if (isSaving || checkingId || switchingSourceId) return;
    setEditingSourceId(source.id);
    setSourceDisplayName(source.displayName);
    setSourceAddress(source.endpoint.apiUrl);
  };

  const saveSourceEdits = async (id: string) => {
    setIsSaving(true);
    try {
      await updateSource(id, sourceAddress, sourceDisplayName);
      setEditingSourceId(null);
      setMessage("数据源名称和地址已重新识别并保存。");
    } catch (error) {
      setMessage(toChineseNetworkError(error, "数据源更新失败，请检查地址后重试"));
    } finally {
      setIsSaving(false);
    }
  };

  const openCacheClearPanel = () => {
    if (isClearingCache) return;
    setIsClearPanelOpen(true);
    setSelectedClearTargets(availableClearTargets.filter((target) => target !== "offline"));
    setCacheMessage(null);
  };

  const toggleClearTarget = (target: CacheClearTarget) => {
    setSelectedClearTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target]);
  };

  const selectAllClearTargets = () => {
    setSelectedClearTargets(isAllClearTargetsSelected ? [] : availableClearTargets);
  };

  const runSelectedCacheClear = async () => {
    if (isClearingCache || selectedClearTargets.length === 0) return;
    setIsClearingCache(true);
    const selectedLabels = selectedClearTargets.map((target) => CACHE_CLEAR_LABELS[target]).join("、");
    setCacheMessage(`正在清理${selectedLabels}…`);
    const tasks = selectedClearTargets.map((target) => {
      if (target === "playlist") return clearPlaybackLists();
      if (target === "searches") return clearSearches();
      if (target === "posters") return clearPosterCache();
      if (target === "history") return clearWatchHistory();
      if (target === "offline") return Promise.all([clearOfflineDownloads(), clearCompletedQueueTasks()]);
      return Platform.OS === "android" || Platform.OS === "ios" ? Promise.resolve().then(() => clearVideoCacheAsync()) : Promise.resolve();
    });
    const results = await Promise.allSettled(tasks);
    try {
      await loadCacheSummary();
      setCacheMessage(results.some((result) => result.status === "rejected") ? "部分已选缓存未能清理，可退出播放页后再次尝试。" : `${selectedLabels}已清理。`);
      setSelectedClearTargets([]);
      setIsClearPanelOpen(false);
    } catch {
      setCacheMessage("缓存已开始清理，但统计刷新失败；请退出播放页后重试。");
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <ScreenContainer containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.profileHeader}><Image source={require("@/assets/images/icon.png")} style={styles.profileIcon} /><View style={styles.profileCopy}><Text style={styles.heading}>我的飞鸿影院</Text><SourceQuickSwitcher style={styles.profileLeadRow}><View style={[styles.profileStatusDot, activeSourceTone === "healthy" && styles.profileStatusDotHealthy, activeSourceTone === "unhealthy" && styles.profileStatusDotUnhealthy]} /><Text numberOfLines={1} style={styles.lead}>{activeSource?.displayName || "本地影视内容库"}</Text>{activeSource ? <Text style={[styles.sourceTypeTag, getSourceTypeLabel(activeSource) === "普通" && styles.sourceTypeTagNormal]}>{getSourceTypeLabel(activeSource)}</Text> : null}</SourceQuickSwitcher></View></View>
        <View style={styles.overviewList}><Pressable onPress={() => router.navigate("/history" as never)} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}><View style={styles.overviewIcon}><Text style={styles.overviewGlyph}>◷</Text></View><View style={styles.overviewCopy}><Text style={styles.overviewTitle}>观看记录</Text><Text style={styles.overviewText}>{cache.history ? `${cache.history} 条记录，可继续观看` : "暂无观看记录"}</Text></View><Text style={styles.overviewArrow}>›</Text></Pressable><Pressable onPress={() => router.navigate("/downloads" as never)} style={({ pressed }) => [styles.overviewCard, styles.downloadOverview, pressed && styles.pressed]}><View style={[styles.overviewIcon, styles.downloadOverviewIcon]}><Text style={[styles.overviewGlyph, styles.downloadOverviewGlyph]}>↓</Text></View><View style={styles.overviewCopy}><Text style={styles.overviewTitle}>已下载剧集</Text><Text style={styles.overviewText}>{cache.offlineCount ? `${cache.offlineCount} 集 · ${formatBytes(cache.offlineBytes)}` : "暂无已下载剧集"}</Text></View><Text style={[styles.overviewArrow, styles.downloadOverviewGlyph]}>›</Text></Pressable></View>
        <View style={styles.section}>
          <View style={styles.sourceHeading}><View><Text style={styles.sectionTitle}>数据源管理</Text><Text style={styles.sourceIntro}>支持主流影视CMS资源站API</Text></View><View style={styles.sourceHeaderActions}><Text style={styles.sourceCount}>{sources.length} 个</Text><Pressable disabled={isCheckingAll || Boolean(checkingId) || Boolean(switchingSourceId)} onPress={() => void runCheckAll()} style={({ pressed }) => [styles.addSourceButton, (pressed || isCheckingAll) && styles.pressed]}>{isCheckingAll ? <ActivityIndicator size="small" color="#141821" /> : <Text style={styles.addSourceButtonText}>全部检测</Text>}</Pressable><Pressable disabled={isCheckingAll} onPress={() => { setNewSourceName(""); setNewSourceAddress(""); setIsAddModalVisible(true); }} style={({ pressed }) => [styles.addSourceButton, pressed && styles.pressed]}><Text style={styles.addSourceButtonText}>＋ 添加</Text></Pressable></View></View>
          <View style={[styles.officialSyncCard, officialResourceSync.lastError && styles.officialSyncCardWarning]}><View style={styles.officialSyncCopy}><View style={styles.officialSyncTitleRow}><Text style={styles.officialSyncTitle}>官方资源</Text><Text style={styles.officialSyncTag}>自动同步</Text></View><Text style={styles.officialSyncText}>{officialResourceSync.lastError ? "官方配置暂时无法访问，已保留现有数据源" : officialResourceSync.lastCheckedAt ? `已检查 ${officialResourceSync.resourceCount} 个资源站 · ${new Date(officialResourceSync.lastCheckedAt).toLocaleString("zh-CN")}` : "启动后会自动检查官方资源站更新"}</Text></View><Pressable disabled={isOfficialSyncing} onPress={() => void runOfficialSync()} style={({ pressed }) => [styles.officialSyncButton, (pressed || isOfficialSyncing) && styles.pressed]}>{isOfficialSyncing ? <ActivityIndicator size="small" color="#141821" /> : <Text style={styles.officialSyncButtonText}>检查更新</Text>}</Pressable></View>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {sourceError ? <Text style={styles.error}>{sourceError}</Text> : null}
          {sources.length ? sources.map((source, index) => (
            <View key={source.id} style={[styles.sourceItem, endpoint?.apiUrl === source.id && styles.sourceItemActive]}>
              {editingSourceId === source.id ? (
                <View style={styles.editForm}>
                  <TextInput value={sourceDisplayName} onChangeText={setSourceDisplayName} autoFocus autoCorrect={false} returnKeyType="next" placeholder="数据源名称" placeholderTextColor="#71809B" style={styles.renameInput} />
                  <TextInput value={sourceAddress} onChangeText={setSourceAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={() => void saveSourceEdits(source.id)} placeholder="数据源地址" placeholderTextColor="#71809B" style={styles.renameInput} />
                  <View style={styles.editActions}><Pressable disabled={isSaving} onPress={() => void saveSourceEdits(source.id)} style={({ pressed }) => [styles.renameSave, (pressed || isSaving) && styles.pressed]}>{isSaving ? <View style={styles.clearingButtonContent}><ActivityIndicator color="#10182B" size="small" /><Text style={styles.renameSaveText}>正在识别…</Text></View> : <Text style={styles.renameSaveText}>保存并识别</Text>}</Pressable><Pressable disabled={isSaving} onPress={() => setEditingSourceId(null)} style={({ pressed }) => [styles.renameCancel, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.miniActionText}>取消</Text></Pressable></View>
                </View>
              ) : (
                <View style={styles.sourceTop}>
                  <Pressable disabled={Boolean(isSaving || checkingId || switchingSourceId)} onPress={() => void runSwitch(source.id)} style={({ pressed }) => [styles.sourceMain, pressed && styles.pressed, switchingSourceId === source.id && styles.sourceMainBusy]}>
                    <View style={[styles.sourceMark, source.health === "healthy" && styles.sourceMarkHealthy, source.health === "unhealthy" && styles.sourceMarkUnhealthy]}><View style={[styles.sourceMarkDot, source.health === "healthy" && styles.sourceMarkDotHealthy, source.health === "unhealthy" && styles.sourceMarkDotUnhealthy]} /></View>
                    <View style={styles.sourceInfo}><View style={styles.sourceNameRow}><Text numberOfLines={1} style={styles.sourceName}>{source.displayName}</Text><Text style={[styles.sourceOfficialTag, getSourceTypeLabel(source) === "普通" && styles.sourceNormalTag]}>{getSourceTypeLabel(source)}</Text></View><Text numberOfLines={1} style={styles.sourceAddress}>{source.endpoint.apiUrl}</Text><Text numberOfLines={1} style={[styles.sourceStatus, source.health === "unhealthy" && styles.sourceStatusUnhealthy, source.health === "unknown" && styles.sourceStatusUnknown]}>{switchingSourceId === source.id ? "正在验证连接并切换，请稍候…" : source.health === "healthy" ? `连接正常${source.responseTimeMs != null ? ` · ${source.responseTimeMs} ms` : ""}` : source.health === "unhealthy" ? toChineseNetworkError(source.lastError, "连接异常，请稍后重试") : "尚未检测"}{!switchingSourceId && source.lastCheckedAt ? ` · ${new Date(source.lastCheckedAt).toLocaleString("zh-CN")}` : ""}</Text></View>
                  </Pressable>
                  <Pressable disabled={Boolean(isSaving || checkingId || switchingSourceId)} accessibilityLabel={`重命名 ${source.displayName}`} onPress={() => beginRename(source)} style={({ pressed }) => [styles.editSourceButton, pressed && styles.pressed, Boolean(isSaving || checkingId || switchingSourceId) && styles.disabled]}>{switchingSourceId === source.id ? <ActivityIndicator size="small" color="#F5C36B" /> : <Text style={styles.editSourceGlyph}>✎</Text>}</Pressable>
                </View>
              )}
              <View style={styles.sourceActions}>
                <Pressable onPress={() => void reorderSource(source.id, -1)} disabled={index === 0} style={({ pressed }) => [styles.miniAction, index === 0 && styles.disabled, pressed && styles.pressed]}><Text style={styles.miniActionText}>上移</Text></Pressable>
                <Pressable onPress={() => void reorderSource(source.id, 1)} disabled={index === sources.length - 1} style={({ pressed }) => [styles.miniAction, index === sources.length - 1 && styles.disabled, pressed && styles.pressed]}><Text style={styles.miniActionText}>下移</Text></Pressable>
                <Pressable onPress={() => void runCheck(source.id)} disabled={checkingId === source.id || isCheckingAll} style={({ pressed }) => [styles.checkAction, (pressed || checkingId === source.id || isCheckingAll) && styles.pressed]}>{checkingId === source.id ? <View style={styles.clearingButtonContent}><ActivityIndicator color="#FFCD75" size="small" /><Text style={styles.checkActionText}>检测中…</Text></View> : <Text style={styles.checkActionText}>{completedCheckIds.includes(source.id) ? "检测完成" : "检测连接"}</Text>}</Pressable>
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
            <CacheItem label="海报缓存" value={`${cache.posterCount} · ${formatBytes(cache.posterBytes)}`} />
            <CacheItem label="视频缓存" value={formatBytes(displayedVideoBytes)} />
            <CacheItem label="离线剧集" value={`${cache.offlineCount} · ${formatBytes(cache.offlineBytes)}`} />
          </View>
          <View style={styles.cacheClearPreview}><Text style={styles.cacheClearPreviewTitle}>清理前预估</Text><Text style={styles.cacheClearPreviewText}>可释放 {formatBytes(clearableMediaBytes)} 的视频与离线缓存，并按所选项目清理 {clearableRecordCount} 项本地数据；其中已命中的海报缓存为 {cache.posterCount} · {formatBytes(cache.posterBytes)}。</Text></View>
          <Pressable disabled={isClearingCache} onPress={openCacheClearPanel} style={({ pressed }) => [styles.secondaryButton, isClearingCache && styles.disabled, pressed && styles.pressed]}>{isClearingCache ? <View style={styles.clearingButtonContent}><ActivityIndicator color="#B7D6F7" size="small" /><Text style={styles.secondaryText}>正在清理…</Text></View> : <Text style={styles.secondaryText}>清理本地缓存</Text>}</Pressable>
          {isClearPanelOpen ? <View style={styles.clearSelectionPanel}><View style={styles.clearSelectionHeading}><View><Text style={styles.clearSelectionTitle}>选择要清理的内容</Text><Text style={styles.clearSelectionSubtitle}>支持单项、多项或全部勾选</Text></View><Pressable onPress={selectAllClearTargets} style={({ pressed }) => [styles.selectAllButton, pressed && styles.pressed]}><Text style={styles.selectAllText}>{isAllClearTargetsSelected ? "取消全选" : "全选"}</Text></Pressable></View>{availableClearTargets.map((target) => { const checked = selectedClearTargets.includes(target); const meta = target === "playlist" ? `${cache.playbackLists} 个列表` : target === "searches" ? `${cache.searches} 条记录` : target === "posters" ? `${cache.posterCount} · ${formatBytes(cache.posterBytes)}` : target === "history" ? `${cache.history} 条记录` : target === "offline" ? `${cache.offlineCount} 集 · ${formatBytes(cache.offlineBytes)}` : formatBytes(displayedVideoBytes); return <Pressable key={target} onPress={() => toggleClearTarget(target)} style={({ pressed }) => [styles.clearChoice, checked && styles.clearChoiceChecked, pressed && styles.pressed]}><View style={[styles.checkMark, checked && styles.checkMarkChecked]}><Text style={styles.checkMarkText}>{checked ? "✓" : ""}</Text></View><View style={styles.clearChoiceCopy}><Text style={styles.clearChoiceTitle}>{CACHE_CLEAR_LABELS[target]}</Text><Text style={styles.clearChoiceMeta}>{meta}</Text></View></Pressable>; })}<View style={styles.clearSelectionActions}><Pressable onPress={() => { setSelectedClearTargets([]); setIsClearPanelOpen(false); }} style={({ pressed }) => [styles.clearSelectionCancel, pressed && styles.pressed]}><Text style={styles.clearSelectionCancelText}>取消</Text></Pressable><Pressable disabled={isClearingCache || selectedClearTargets.length === 0} onPress={() => void runSelectedCacheClear()} style={({ pressed }) => [styles.clearSelectionConfirm, (pressed || selectedClearTargets.length === 0) && styles.disabled]}><Text style={styles.clearSelectionConfirmText}>确认清理（{selectedClearTargets.length}）</Text></Pressable></View></View> : null}
          {cacheMessage ? <Text style={styles.cacheMessage}>{cacheMessage}</Text> : null}
          <Text style={styles.cacheHint}>影片播放线路和剧集信息会保存在设备中；海报使用磁盘缓存，显示实际占用大小。已下载的 MP4、WebM 或无加密点播 HLS 会保存在应用离线空间，可在无网络时播放。</Text>
        </View>
        <View style={styles.paginationCard}><Text style={styles.paginationTitle}>分类与搜索翻页模式</Text><Text style={styles.paginationText}>默认自动加载；自动、手动和经典模式默认每页 24 条。</Text><View style={styles.paginationOptions}><Pressable onPress={() => setPageMode("auto")} style={({ pressed }) => [styles.paginationOption, categoryPageMode === "auto" && styles.paginationOptionActive, pressed && styles.pressed]}><Text style={[styles.paginationOptionText, categoryPageMode === "auto" && styles.paginationOptionTextActive]}>自动加载</Text></Pressable><Pressable onPress={() => setPageMode("manual")} style={({ pressed }) => [styles.paginationOption, categoryPageMode === "manual" && styles.paginationOptionActive, pressed && styles.pressed]}><Text style={[styles.paginationOptionText, categoryPageMode === "manual" && styles.paginationOptionTextActive]}>手动加载</Text></Pressable><Pressable onPress={() => setPageMode("classic")} style={({ pressed }) => [styles.paginationOption, categoryPageMode === "classic" && styles.paginationOptionActive, pressed && styles.pressed]}><Text style={[styles.paginationOptionText, categoryPageMode === "classic" && styles.paginationOptionTextActive]}>经典模式</Text></Pressable></View>{categoryPageMode === "classic" ? <View style={styles.classicPageSize}><View><Text style={styles.classicPageSizeTitle}>经典模式每页条数</Text><Text style={styles.classicPageSizeText}>当前每页显示 {classicPageSize} 条内容</Text></View><View style={styles.classicPageSizeOptions}>{([12, 24, 30, 60] as CategoryClassicPageSize[]).map((size) => <Pressable key={size} onPress={() => setClassicPageSizePreference(size)} style={({ pressed }) => [styles.classicPageSizeOption, classicPageSize === size && styles.classicPageSizeOptionActive, pressed && styles.pressed]}><Text style={[styles.classicPageSizeOptionText, classicPageSize === size && styles.classicPageSizeOptionTextActive]}>{size}</Text></Pressable>)}</View></View> : null}</View>
        <View style={styles.note}><Text style={styles.noteTitle}>播放说明</Text><Text style={styles.noteText}>支持直接播放的常见 MP4、M3U8 等地址会进入原生播放器。其他网页型地址会保留清晰提示，以便你在浏览器中打开。</Text></View>
        <View style={styles.versionFooter}><Text style={styles.versionText}>fsvod-mobile-1.3.4</Text></View>
      </ScrollView>
      <Modal visible={isAddModalVisible} transparent animationType="fade" onRequestClose={() => setIsAddModalVisible(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeading}><View><Text style={styles.modalTitle}>添加资源</Text><Text style={styles.modalSubtitle}>{isSaving ? "正在连接并识别数据源，请稍候…" : "名称和地址都可以随时编辑"}</Text></View><Pressable disabled={isSaving} onPress={() => setIsAddModalVisible(false)} style={({ pressed }) => [styles.modalClose, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.modalCloseText}>×</Text></Pressable></View><Text style={styles.label}>数据源名称</Text><TextInput editable={!isSaving} value={newSourceName} onChangeText={setNewSourceName} autoCorrect={false} returnKeyType="next" placeholder="可选，例如：主线路" placeholderTextColor="#71809B" style={styles.input} /><Text style={styles.fieldHint}>留空时自动使用域名，例如 example.com。</Text><Text style={[styles.label, styles.addressLabel]}>数据源地址</Text><TextInput editable={!isSaving} value={newSourceAddress} onChangeText={setNewSourceAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={() => void detectAndSave()} placeholder="例如：https://example.com" placeholderTextColor="#71809B" style={styles.input} /><View style={styles.modalActions}><Pressable disabled={isSaving} onPress={() => setIsAddModalVisible(false)} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.modalCancelText}>取消</Text></Pressable><Pressable disabled={isSaving} onPress={() => void detectAndSave()} style={({ pressed }) => [styles.modalConfirm, (pressed || isSaving) && styles.pressed]}>{isSaving ? <View style={styles.clearingButtonContent}><ActivityIndicator color="#10182B" size="small" /><Text style={styles.modalConfirmText}>正在识别…</Text></View> : <Text style={styles.modalConfirmText}>添加并识别</Text>}</Pressable></View></View></View>
      </Modal>
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

function getDefaultSourceName(address: string): string {
  return address.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/")[0] || "未命名数据源";
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingTop: 23, paddingBottom: 36 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 19 },
  profileIcon: { width: 49, height: 49, borderRadius: 15 },
  profileCopy: { flex: 1, minWidth: 0 },
  heading: { color: "#F6F7FB", fontSize: 27, fontWeight: "800", lineHeight: 35 },
  profileLeadRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  profileStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#77869D", flexShrink: 0 },
  profileStatusDotHealthy: { backgroundColor: "#78D3A4" },
  profileStatusDotUnhealthy: { backgroundColor: "#F39A79" },
  lead: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, flexShrink: 1 },
  sourceTypeTag: { color: "#B8F1E0", backgroundColor: "#1E554B", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  sourceTypeTagNormal: { color: "#D6DCE6", backgroundColor: "#4A5568" },
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
  paginationCard: { marginTop: 12, padding: 15, borderRadius: 17, backgroundColor: "#171F30", borderWidth: 1, borderColor: "#2A3650" },
  paginationTitle: { color: "#F3F6FB", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  paginationText: { color: "#9BA8BB", fontSize: 11, lineHeight: 16, marginTop: 3 },
  paginationOptions: { flexDirection: "row", gap: 7, marginTop: 13 },
  paginationOption: { flex: 1, height: 37, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "#20293A", borderWidth: 1, borderColor: "#36435B" },
  paginationOptionActive: { backgroundColor: "#FFB84D", borderColor: "#FFB84D" },
  paginationOptionText: { color: "#C3CEDD", fontSize: 10, lineHeight: 15, fontWeight: "900" },
  paginationOptionTextActive: { color: "#151821" },
  classicPageSize: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#35425B" },
  classicPageSizeTitle: { color: "#E7EDF6", fontSize: 12, lineHeight: 18, fontWeight: "900" },
  classicPageSizeText: { color: "#8F9DB1", fontSize: 10, lineHeight: 15, marginTop: 1 },
  classicPageSizeOptions: { flexDirection: "row", gap: 6 },
  classicPageSizeOption: { width: 31, height: 31, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#20293A", borderWidth: 1, borderColor: "#36435B" },
  classicPageSizeOptionActive: { backgroundColor: "#FFB84D", borderColor: "#FFB84D" },
  classicPageSizeOptionText: { color: "#C3CEDD", fontSize: 11, lineHeight: 15, fontWeight: "900" },
  classicPageSizeOptionTextActive: { color: "#151821" },
  section: { marginTop: 22, padding: 16, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#283452" },
  label: { color: "#DCE2EE", fontWeight: "700", fontSize: 13, lineHeight: 19, marginBottom: 9 },
  addressLabel: { marginTop: 13 },
  input: { height: 47, borderRadius: 11, borderWidth: 1, borderColor: "#344464", backgroundColor: "#0F1729", color: "#F6F7FB", fontSize: 14, paddingHorizontal: 12, paddingVertical: 0 },
  primaryButton: { height: 45, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "#F5B64B", marginTop: 12 },
  primaryText: { color: "#11192B", fontWeight: "800", fontSize: 14 },
  message: { color: "#93D6AE", fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { color: "#F8C174", fontSize: 12, lineHeight: 18, marginTop: 10 },
  sectionTitle: { color: "#F4F6FA", fontSize: 15, fontWeight: "800", lineHeight: 21, marginBottom: 10 },
  sourceHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  sourceHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceIntro: { color: "#8896AD", fontSize: 11, lineHeight: 16, marginTop: -6, marginBottom: 10 },
  officialSyncCard: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: 13, marginBottom: 11, backgroundColor: "#102B2D", borderWidth: 1, borderColor: "#256965" },
  officialSyncCardWarning: { backgroundColor: "#2C2630", borderColor: "#714F42" },
  officialSyncCopy: { flex: 1, minWidth: 0 },
  officialSyncTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  officialSyncTitle: { color: "#E9F6F4", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  officialSyncTag: { color: "#8AE2CA", backgroundColor: "#16463F", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  officialSyncText: { color: "#ADCEC8", fontSize: 10, lineHeight: 15, marginTop: 3 },
  officialSyncButton: { minWidth: 62, height: 33, paddingHorizontal: 8, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "#78D3B9" },
  officialSyncButtonText: { color: "#11211F", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  sourceCount: { color: "#F5C66E", fontSize: 11, lineHeight: 16, fontWeight: "800", backgroundColor: "#2A2533", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  addSourceButton: { height: 37, paddingHorizontal: 12, borderRadius: 11, justifyContent: "center", backgroundColor: "#FFB84D" },
  addSourceButtonText: { color: "#141821", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  sourceItem: { backgroundColor: "#11192A", borderWidth: 1, borderColor: "#2C3953", borderRadius: 16, marginTop: 10, padding: 14 },
  sourceItemActive: { borderColor: "#D99D40", backgroundColor: "#171D2D" },
  sourceTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  sourceMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0 },
  sourceMainBusy: { opacity: 0.72 },
  sourceMark: { width: 42, height: 42, borderRadius: 13, justifyContent: "center", alignItems: "center", backgroundColor: "#27334A", borderWidth: 1, borderColor: "#394964" },
  sourceMarkHealthy: { backgroundColor: "#143A31", borderColor: "#317360" },
  sourceMarkUnhealthy: { backgroundColor: "#37262C", borderColor: "#784A4E" },
  sourceMarkDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: "#8492A7" },
  sourceMarkDotHealthy: { backgroundColor: "#78D3A4" },
  sourceMarkDotUnhealthy: { backgroundColor: "#F39A79" },
  sourceInfo: { flex: 1, minWidth: 0 },
  sourceNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sourceName: { color: "#F2F5F9", fontSize: 15, lineHeight: 21, fontWeight: "900" },
  sourceOfficialTag: { color: "#B8F1E0", backgroundColor: "#1E554B", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  sourceNormalTag: { color: "#D6DCE6", backgroundColor: "#4A5568" },
  sourceAddress: { color: "#9AA9BE", fontSize: 10, lineHeight: 15, marginTop: 1, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
  sourceStatus: { color: "#7FD0A4", fontSize: 10, lineHeight: 15, marginTop: 1 },
  sourceStatusUnhealthy: { color: "#F2A17F" },
  sourceStatusUnknown: { color: "#93A0B5" },
  editSourceButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#202A3D", justifyContent: "center", alignItems: "center" },
  editSourceGlyph: { color: "#D5DFED", fontSize: 18, lineHeight: 21, fontWeight: "900" },
  editForm: { gap: 8 },
  editActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  renameInput: { height: 38, borderRadius: 9, borderWidth: 1, borderColor: "#536B92", color: "#F6F7FB", backgroundColor: "#0B1221", fontSize: 12, paddingHorizontal: 10, paddingVertical: 0 },
  renameSave: { height: 32, paddingHorizontal: 11, borderRadius: 8, justifyContent: "center", backgroundColor: "#F5B64B" },
  renameSaveText: { color: "#10182B", fontSize: 10, fontWeight: "900" },
  renameCancel: { height: 30, paddingHorizontal: 8, borderWidth: 1, borderColor: "#3D5577", borderRadius: 7, justifyContent: "center" },
  sourceActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 13 },
  miniAction: { minWidth: 48, height: 27, paddingHorizontal: 9, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#3D5577", borderRadius: 7 },
  miniActionText: { color: "#B7D6F7", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  checkAction: { flex: 1, height: 33, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "#202A3D" },
  checkActionText: { color: "#F7C66A", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  removeAction: { borderColor: "#70414D" },
  removeActionText: { color: "#E8A8AF", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  endpoint: { color: "#A6CEF6", fontSize: 12, lineHeight: 19, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), backgroundColor: "#0F1729", padding: 10, borderRadius: 9 },
  meta: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 9 },
  cacheGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  cacheItem: { width: "48%", backgroundColor: "#0F1729", paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  cacheValue: { color: "#F6F7FB", fontSize: 16, lineHeight: 22, fontWeight: "800" },
  cacheLabel: { color: "#8290A8", fontSize: 11, lineHeight: 16, marginTop: 2 },
  cacheClearPreview: { marginTop: 13, padding: 10, borderRadius: 10, backgroundColor: "#102438", borderWidth: 1, borderColor: "#284967" },
  cacheClearPreviewTitle: { color: "#B7D6F7", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  cacheClearPreviewText: { color: "#AAB9CA", fontSize: 10, lineHeight: 16, marginTop: 2 },
  secondaryButton: { borderWidth: 1, borderColor: "#48648D", height: 42, borderRadius: 11, justifyContent: "center", alignItems: "center", marginTop: 14 },
  clearSelectionPanel: { gap: 8, marginTop: 10, padding: 11, borderRadius: 12, backgroundColor: "#102238", borderWidth: 1, borderColor: "#345270" },
  clearSelectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 },
  clearSelectionTitle: { color: "#DDEBFA", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  clearSelectionSubtitle: { color: "#91A4BB", fontSize: 10, lineHeight: 15, marginTop: 1 },
  selectAllButton: { minHeight: 29, paddingHorizontal: 9, justifyContent: "center", borderRadius: 8, backgroundColor: "#213C58" },
  selectAllText: { color: "#B7D6F7", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  clearChoice: { minHeight: 46, paddingHorizontal: 10, borderRadius: 9, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#111C2E", borderWidth: 1, borderColor: "#2C425E" },
  clearChoiceChecked: { backgroundColor: "#16354A", borderColor: "#4C8AA1" },
  checkMark: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: "#617895", alignItems: "center", justifyContent: "center" },
  checkMarkChecked: { backgroundColor: "#79CDB6", borderColor: "#79CDB6" },
  checkMarkText: { color: "#102238", fontSize: 12, lineHeight: 14, fontWeight: "900" },
  clearChoiceCopy: { flex: 1, minWidth: 0 },
  clearChoiceTitle: { color: "#E1EAF5", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  clearChoiceMeta: { color: "#91A0B6", fontSize: 10, lineHeight: 14, marginTop: 1 },
  clearSelectionActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 4 },
  clearSelectionCancel: { height: 32, paddingHorizontal: 11, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "#4C6079" },
  clearSelectionCancelText: { color: "#C6D0DD", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  clearSelectionConfirm: { height: 32, paddingHorizontal: 12, justifyContent: "center", borderRadius: 8, backgroundColor: "#E47D70" },
  clearSelectionConfirmText: { color: "#291518", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  clearingButtonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryText: { color: "#B7D6F7", fontWeight: "700", fontSize: 13 },
  cacheMessage: { color: "#A9E2BE", fontSize: 11, lineHeight: 17, marginTop: 8, fontWeight: "700" },
  cacheHint: { color: "#8592AB", fontSize: 11, lineHeight: 17, marginTop: 10 },
  versionFooter: { alignItems: "center", paddingTop: 25, paddingBottom: 4 },
  versionText: { color: "#7F8FA8", fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 0.2 },
  versionHint: { color: "#59677B", fontSize: 10, lineHeight: 15, marginTop: 2 },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(2, 5, 12, 0.74)" },
  modalCard: { borderRadius: 20, padding: 18, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#35435D" },
  modalHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 19 },
  modalTitle: { color: "#F5F7FB", fontSize: 20, lineHeight: 27, fontWeight: "900" },
  modalSubtitle: { color: "#93A0B4", fontSize: 11, lineHeight: 16, marginTop: 2 },
  modalClose: { width: 30, height: 30, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "#222C40" },
  modalCloseText: { color: "#C8D3E2", fontSize: 23, lineHeight: 25, fontWeight: "500" },
  fieldHint: { color: "#8795AB", fontSize: 10, lineHeight: 15, marginTop: 5 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 21 },
  modalCancel: { flex: 1, height: 43, borderRadius: 12, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#42526F" },
  modalCancelText: { color: "#C9D5E5", fontSize: 13, lineHeight: 19, fontWeight: "900" },
  modalConfirm: { flex: 1.35, height: 43, borderRadius: 12, justifyContent: "center", alignItems: "center", backgroundColor: "#FFB84D" },
  modalConfirmText: { color: "#141821", fontSize: 13, lineHeight: 19, fontWeight: "900" },
  note: { marginTop: 16, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 14, backgroundColor: "#192945" },
  noteTitle: { color: "#F8D28D", fontSize: 13, fontWeight: "800", lineHeight: 19 },
  noteText: { color: "#B5C1D5", fontSize: 12, lineHeight: 19, marginTop: 4 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.6 },
});
