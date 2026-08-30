import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "expo-image";

import { ScreenContainer } from "@/components/screen-container";
import { SourceQuickSwitcher } from "@/components/source-quick-switcher";
import { VodCard } from "@/components/vod-card";
import { VodPoster } from "@/components/vod-poster";
import { buildHistoryPlaybackParams } from "@/lib/history-playback";
import { loadIndexAds, type IndexAd } from "@/lib/index-ad";
import { fetchVodPage, mergeMacCmsPages, sortVodItems, type MacCmsCategory, type MacCmsVod } from "@/lib/maccms";
import { DEFAULT_LIST_PAGE_SIZE, getSourceTypeLabel, getWatchHistory, type WatchHistoryEntry } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

const EMPTY_CATEGORY: MacCmsCategory = { id: "", name: "", parentId: null, children: [] };
const HOME_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function HomeScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ typeId?: string; sort?: string }>();
  const { endpoint, sources, categories, isBooting, sourceError, refreshCategories } = useVodSource();
  const [activeRootId, setActiveRootId] = useState("");
  const [activeTypeId, setActiveTypeId] = useState("");
  const [sortMode, setSortMode] = useState<"latest" | "hot">("latest");
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [indexAds, setIndexAds] = useState<IndexAd[]>([]);
  const [activeAdIndex, setActiveAdIndex] = useState(0);
  const [failedAdIds, setFailedAdIds] = useState<string[]>([]);

  const selectedRoot = useMemo(() => categories.find((category) => category.id === activeRootId) ?? categories[0] ?? EMPTY_CATEGORY, [activeRootId, categories]);

  useEffect(() => { void getWatchHistory().then(setHistory); }, []);

  useEffect(() => {
    // Load the official api.json data source first. Ads are non-critical and
    // must never compete with the initial catalogue request for startup time.
    if (isBooting || !endpoint || isLoading || (!categories.length && !sourceError)) return;
    let active = true;
    const delay = setTimeout(() => {
      void loadIndexAds().then(({ ads }) => {
        if (!active) return;
        setIndexAds(ads);
        setActiveAdIndex(0);
        setFailedAdIds([]);
      });
    }, 1_200);
    return () => { active = false; clearTimeout(delay); };
  }, [categories.length, endpoint, isBooting, isLoading, sourceError]);

  const displayAds = useMemo(() => indexAds.filter((ad) => !failedAdIds.includes(ad.id)), [failedAdIds, indexAds]);
  const activeAd = displayAds.length ? displayAds[activeAdIndex % displayAds.length] : null;

  useEffect(() => {
    if (!activeAd || displayAds.length < 2) return;
    const timer = setTimeout(() => setActiveAdIndex((current) => (current + 1) % displayAds.length), activeAd.durationSeconds * 1000);
    return () => clearTimeout(timer);
  }, [activeAd, displayAds.length]);

  useEffect(() => {
    if (categories.length && !categories.some((category) => category.id === activeRootId)) {
      setActiveRootId(categories[0].id);
      setActiveTypeId(categories[0].id);
    }
  }, [activeRootId, categories]);

  useEffect(() => {
    const targetTypeId = Array.isArray(routeParams.typeId) ? routeParams.typeId[0] : routeParams.typeId;
    const routeSort = Array.isArray(routeParams.sort) ? routeParams.sort[0] : routeParams.sort;
    setSortMode(routeSort === "hot" ? "hot" : "latest");
    if (!targetTypeId) return;
    const root = categories.find((category) => category.id === targetTypeId) ?? categories.find((category) => category.children.some((child) => child.id === targetTypeId));
    if (!root) return;
    setActiveRootId(root.id);
    setActiveTypeId(targetTypeId);
  }, [categories, routeParams.sort, routeParams.typeId]);

  const loadPage = useCallback(async (requestedPage: number, append = false) => {
    if (!endpoint || !selectedRoot.id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const shouldAggregateChildren = activeTypeId === selectedRoot.id && selectedRoot.children.length > 0;
      const result = shouldAggregateChildren
        ? mergeMacCmsPages(await Promise.all([selectedRoot, ...selectedRoot.children].map((category) => fetchVodPage(endpoint, { page: requestedPage, pageSize: HOME_PAGE_SIZE, typeId: category.id, sort: sortMode }))))
        : await fetchVodPage(endpoint, { page: requestedPage, pageSize: HOME_PAGE_SIZE, typeId: activeTypeId || selectedRoot.id, sort: sortMode });
      const pageItems = result.items.slice(0, HOME_PAGE_SIZE);
      if (!append && pageItems.length === 0) {
        const currentRootIndex = categories.findIndex((category) => category.id === selectedRoot.id);
        const nextCategory = categories.slice(Math.max(0, currentRootIndex + 1)).find((category) => category.id !== selectedRoot.id);
        if (nextCategory) {
          setItems([]);
          setPage(1);
          setPageCount(1);
          setActiveRootId(nextCategory.id);
          setActiveTypeId(nextCategory.id);
          return;
        }
      }
      setItems((current) => sortVodItems(append ? [...current, ...pageItems.filter((item) => !current.some((existing) => existing.id === item.id))] : pageItems, sortMode));
      setPage(result.page);
      setPageCount(result.pageCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "影视列表加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [activeTypeId, categories, endpoint, selectedRoot, sortMode]);

  useEffect(() => { if (selectedRoot.id) void loadPage(1); }, [loadPage, selectedRoot.id]);

  const chooseRoot = (id: string) => {
    setActiveRootId(id);
    setActiveTypeId(id);
  };

  const refresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadPage(1), refreshCategories(), getWatchHistory().then(setHistory)]);
    setIsRefreshing(false);
  };

  const latestHistory = history[0];
  const displayItems = items;
  const currentSource = sources.find((source) => source.id === endpoint?.apiUrl);
  const sourceCaption = currentSource?.displayName?.trim() || endpoint?.inputDomain || "";
  const sourceTypeLabel = currentSource ? getSourceTypeLabel(currentSource) : "普通";
  const sourceConnectionTone = currentSource?.health === "healthy"
    ? "healthy"
    : currentSource?.health === "unhealthy"
      ? "unhealthy"
      : "unknown";
  const continueProgress = latestHistory?.durationSeconds && latestHistory.positionSeconds ? Math.min(100, Math.max(0, Math.round((latestHistory.positionSeconds / latestHistory.durationSeconds) * 100))) : 0;

  const resumeHistory = async (entry: WatchHistoryEntry) => {
    if (!endpoint) { setLoadError("请先在“我的”页面配置可用的数据源。"); return; }
    try {
      const params = await buildHistoryPlaybackParams(entry, endpoint);
      router.push({ pathname: "/player", params } as never);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法恢复该剧集的播放位置");
    }
  };

  const openIndexAd = useCallback(async () => {
    const target = activeAd?.target;
    if (!target) return;
    if (target.type === "vod") {
      router.push({ pathname: "/vod/[id]", params: { id: target.vodId } } as never);
      return;
    }
    const externalUrl = target.url;
    Alert.alert("转向外部网页", "请使用手机默认浏览器打开外部网址访问", [
      { text: "取消", style: "cancel" },
      {
        text: "打开浏览器",
        onPress: () => {
          // Linking.openURL delegates directly to the device's default browser.
          void Linking.openURL(externalUrl).catch(() => undefined);
        },
      },
    ]);
  }, [activeAd, router]);

  const markAdImageFailed = useCallback((id: string) => {
    setFailedAdIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveAdIndex(0);
  }, []);

  if (isBooting) return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><View style={styles.bootScreen}><Image source={require("@/assets/images/icon.png")} style={styles.bootIcon} contentFit="cover" /><Text style={styles.bootBrand}>飞鸿影院</Text><ActivityIndicator color="#FFB84D" size="large" /><Text style={styles.bootTitle}>正在连接官方数据源</Text><Text style={styles.bootHint}>FSVOD启动正在加载分类，请稍候…</Text></View></ScreenContainer>;
  if (!endpoint) return <ScreenContainer className="px-6" containerClassName="bg-background"><View style={styles.emptyHero}><Image source={require("@/assets/images/icon.png")} style={styles.emptyIcon} contentFit="cover" /><Text style={styles.emptyBrand}>飞鸿影院</Text><Text style={styles.emptyTitle}>接入你的影视数据源</Text><Text style={styles.emptyText}>填入 MACCMS 站点域名后，即可浏览你喜爱的作品。</Text><Pressable onPress={() => router.push("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>配置数据源</Text></Pressable></View></ScreenContainer>;

  const listHeader = <View>
    <View style={styles.appHeader}><View style={styles.headerIdentity}><Text style={styles.brandName}>飞鸿影院</Text><SourceQuickSwitcher style={styles.sourceMetaRow}><View style={[styles.sourceConnectionDot, sourceConnectionTone === "healthy" && styles.sourceConnectionDotHealthy, sourceConnectionTone === "unhealthy" && styles.sourceConnectionDotUnhealthy]} /><Text numberOfLines={1} style={styles.sourceCaption}>{sourceCaption}</Text>{endpoint ? <Text style={[styles.sourceTypeTag, sourceTypeLabel === "普通" && styles.sourceTypeTagNormal]}>{sourceTypeLabel}</Text> : null}</SourceQuickSwitcher></View><Pressable accessibilityRole="button" accessibilityLabel="打开搜索" onPress={() => router.push("/search" as never)} style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}><Text style={styles.searchIcon}>⌕</Text></Pressable></View>
    {activeAd ? <Pressable accessibilityRole="button" accessibilityLabel={activeAd.target ? `打开广告：${activeAd.title}` : `广告：${activeAd.title}`} onPress={activeAd.target ? () => void openIndexAd() : undefined} style={({ pressed }) => [styles.heroCard, styles.adHeroCard, pressed && activeAd.target && styles.pressed]}><Image source={{ uri: activeAd.imageUrl }} style={styles.adImage} contentFit="cover" transition={180} onError={() => markAdImageFailed(activeAd.id)} /><View style={styles.adScrim} /><View style={styles.adContent}><Text style={styles.adKicker}>推广</Text><Text numberOfLines={2} style={styles.heroTitle}>{activeAd.title}</Text>{activeAd.subtitle ? <Text numberOfLines={2} style={styles.heroText}>{activeAd.subtitle}</Text> : null}</View>{displayAds.length > 1 ? <View style={styles.adPagination}>{displayAds.map((ad, index) => <Pressable key={ad.id} accessibilityLabel={`切换至广告 ${index + 1}`} onPress={() => setActiveAdIndex(index)} style={[styles.adDot, index === activeAdIndex % displayAds.length && styles.adDotActive]} />)}</View> : null}</Pressable> : <View style={styles.heroCard}><View style={styles.heroOrb} /><Text style={styles.heroKicker}>现在开始</Text><Text style={styles.heroTitle}>发现下一部{`\n`}值得观看的作品</Text><Text style={styles.heroText}>以精选分区和持续更新的内容，打造简洁专注的观影入口。</Text><Pressable onPress={() => router.navigate("/categories" as never)} style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}><Text style={styles.heroActionIcon}>▶</Text><Text style={styles.heroActionText}>开始浏览</Text></Pressable></View>}
    {sourceError ? <View style={styles.warning}><Text style={styles.warningText}>{items.length ? "网络不可用，正在展示本地已缓存内容。请尝试更换数据源。" : "网络不可用，暂时无法加载内容。请尝试更换数据源。"}</Text></View> : null}
    <FlatList horizontal data={categories} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList} renderItem={({ item }) => <CategoryChip label={item.name} active={item.id === selectedRoot.id} onPress={() => chooseRoot(item.id)} />} />
    {latestHistory ? <View style={styles.continueSection}><View style={styles.continueHeading}><View><Text style={styles.sectionTitle}>继续观看</Text><Text style={styles.sectionSubtitle}>从上次离开的地方继续</Text></View><Pressable onPress={() => router.push("/history" as never)} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}><Text style={styles.moreText}>更多 ›</Text></Pressable></View><Pressable onPress={() => void resumeHistory(latestHistory)} style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}><VodPoster title={latestHistory.name} url={latestHistory.posterUrl} style={styles.continuePoster} /><View style={styles.continueInfo}><Text numberOfLines={2} style={styles.continueTitle}>{latestHistory.name}</Text><Text numberOfLines={1} style={styles.continueMeta}>{latestHistory.episodeName || "影视内容"}{latestHistory.positionSeconds ? ` · ${formatDuration(latestHistory.positionSeconds)}` : ""}</Text><View style={styles.continueLine}><View style={[styles.continueProgress, { width: `${continueProgress}%` }]} /></View></View></Pressable></View> : null}
    <View style={styles.contentHeading}><View><Text style={styles.sectionTitle}>正在热映{selectedRoot.name}</Text><Text style={styles.sectionSubtitle}>来自当前数据源的最新内容</Text></View><Pressable accessibilityLabel={`查看${selectedRoot.name || "电影"}更多影片`} onPress={() => router.navigate({ pathname: "/categories", params: { rootId: selectedRoot.id } } as never)} style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}><Text style={styles.moreText}>更多 ›</Text></Pressable></View>
    {loadError ? <Text style={styles.loadError}>{loadError}</Text> : null}
  </View>;

  return <ScreenContainer containerClassName="bg-background"><FlatList data={displayItems} numColumns={3} key="home-grid" keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>} ListHeaderComponent={listHeader} ListEmptyComponent={!isLoading ? <View style={styles.noResults}><Text style={styles.noResultsTitle}>暂无可展示影片</Text><Text style={styles.noResultsText}>请在“我的”中检查数据源状态。</Text></View> : null} ListFooterComponent={isLoading ? <View style={styles.footer}><ActivityIndicator color="#FFB84D" /></View> : page < pageCount ? <Pressable style={({ pressed }) => [styles.loadMoreButton, pressed && styles.pressed]} onPress={() => void loadPage(page + 1, true)}><Text style={styles.loadMoreText}>加载更多</Text></Pressable> : items.length > 0 ? <Text style={styles.endText}>已经到底了</Text> : null} contentContainerStyle={styles.content} columnWrapperStyle={displayItems.length ? styles.gridRow : undefined} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor="#FFB84D" colors={["#FFB84D"]} />} showsVerticalScrollIndicator={false} /></ScreenContainer>;
}

function CategoryChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  bootScreen: { alignItems: "center", justifyContent: "center", paddingBottom: 70 },
  bootIcon: { width: 84, height: 84, borderRadius: 24, marginBottom: 14 },
  bootBrand: { color: "#F5B64B", fontSize: 22, lineHeight: 30, fontWeight: "900", marginBottom: 24 },
  bootTitle: { color: "#E8EDF5", fontSize: 15, lineHeight: 22, fontWeight: "800", marginTop: 18 },
  bootHint: { color: "#8E9AB0", fontSize: 11, lineHeight: 17, marginTop: 5 },
  content: { paddingHorizontal: 18, paddingBottom: 34 },
  appHeader: { height: 70, paddingTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerIdentity: { flex: 1, minWidth: 0, paddingRight: 12 },
  brandName: { color: "#F6F7FB", fontSize: 20, lineHeight: 26, fontWeight: "900", letterSpacing: 0.1, flexShrink: 0 },
  sourceMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  sourceCaption: { color: "#9FAABD", fontSize: 11, lineHeight: 16, maxWidth: 150, flexShrink: 1 },
  sourceTypeTag: { color: "#B8F1E0", backgroundColor: "#1E554B", fontSize: 9, lineHeight: 14, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  sourceTypeTagNormal: { color: "#D6DCE6", backgroundColor: "#4A5568" },
  sourceConnectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#77869D", flexShrink: 0 },
  sourceConnectionDotHealthy: { backgroundColor: "#78D3A4" },
  sourceConnectionDotUnhealthy: { backgroundColor: "#F39A79" },
  searchButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#20293A", justifyContent: "center", alignItems: "center" },
  searchIcon: { color: "#F6F7FB", fontWeight: "700", fontSize: 28, lineHeight: 30, transform: [{ rotate: "-20deg" }] },
  heroCard: { minHeight: 307, overflow: "hidden", backgroundColor: "#1E2238", borderRadius: 24, padding: 28 },
  adHeroCard: { padding: 0, position: "relative", justifyContent: "flex-end" },
  adImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  adScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(9, 12, 25, 0.42)" },
  adContent: { minHeight: 307, justifyContent: "flex-end", padding: 28 },
  adKicker: { color: "#FFC158", fontSize: 12, lineHeight: 18, fontWeight: "900", letterSpacing: 1.1, marginBottom: 7 },
  adPagination: { position: "absolute", right: 20, bottom: 19, flexDirection: "row", gap: 6 },
  adDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.48)" },
  adDotActive: { width: 20, backgroundColor: "#FFB84D" },
  heroOrb: { position: "absolute", width: 235, height: 235, borderRadius: 118, right: -43, top: -58, backgroundColor: "#62513B", opacity: 0.85 },
  heroKicker: { color: "#FFC158", fontSize: 13, lineHeight: 19, fontWeight: "900" },
  heroTitle: { color: "#F8F8FA", fontSize: 29, lineHeight: 38, fontWeight: "900", marginTop: 11, maxWidth: 275 },
  heroText: { color: "#D1D6E0", fontSize: 13, lineHeight: 21, marginTop: 12, maxWidth: 290 },
  heroAction: { alignSelf: "flex-start", height: 50, paddingHorizontal: 19, borderRadius: 14, backgroundColor: "#FFB84D", marginTop: 21, flexDirection: "row", alignItems: "center", gap: 9 },
  heroActionIcon: { color: "#15131A", fontSize: 13, lineHeight: 18 },
  heroActionText: { color: "#15131A", fontSize: 14, lineHeight: 20, fontWeight: "900" },
  warning: { marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, backgroundColor: "#312E1E", borderWidth: 1, borderColor: "#6D5E2B" },
  warningText: { color: "#F4CC7E", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  categoryList: { gap: 10, paddingVertical: 23, paddingRight: 18 },
  chip: { height: 45, paddingHorizontal: 18, justifyContent: "center", borderRadius: 23, backgroundColor: "#20293A", borderWidth: 1, borderColor: "#303C52" },
  chipActive: { backgroundColor: "#FFB84D", borderColor: "#FFB84D" },
  chipText: { color: "#D9DFEA", fontWeight: "900", fontSize: 13, lineHeight: 18 },
  chipTextActive: { color: "#171821" },
  continueSection: { marginBottom: 28 },
  continueHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  sectionTitle: { color: "#F5F6FA", fontSize: 22, lineHeight: 30, fontWeight: "900" },
  sectionSubtitle: { color: "#96A2B7", fontSize: 12, lineHeight: 18, marginTop: 2 },
  continueCard: { flexDirection: "row", gap: 13, marginTop: 15, alignItems: "center", alignSelf: "flex-start" },
  continuePoster: { width: 113, height: 158, borderRadius: 15 },
  continueInfo: { width: 157, minHeight: 158, justifyContent: "flex-end", paddingBottom: 7 },
  continueTitle: { color: "#F0F2F7", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  continueMeta: { color: "#9CA9BC", fontSize: 12, lineHeight: 18, marginTop: 5 },
  continueLine: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: "#263249", marginTop: 13 },
  continueProgress: { height: "100%", backgroundColor: "#FFB84D" },
  contentHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingBottom: 15 },
  moreButton: { height: 28, justifyContent: "center", paddingLeft: 3 },
  moreText: { color: "#FFBE59", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  gridRow: { gap: 12 },
  gridCell: { flex: 1, maxWidth: "33.34%" },
  footer: { paddingVertical: 20, alignItems: "center" },
  loadMoreButton: { alignSelf: "center", paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: "#20293D", borderWidth: 1, borderColor: "#33405A", marginBottom: 9 },
  loadMoreText: { color: "#E5E9F1", fontWeight: "800", fontSize: 13 },
  endText: { color: "#67748A", textAlign: "center", paddingTop: 4, paddingBottom: 12, fontSize: 12 },
  loadError: { color: "#F8C174", fontSize: 12, lineHeight: 18, backgroundColor: "#2B2630", padding: 10, borderRadius: 10, marginBottom: 12 },
  noResults: { paddingVertical: 48, alignItems: "center", paddingHorizontal: 28 },
  noResultsTitle: { color: "#E7EAF0", fontWeight: "800", fontSize: 16, lineHeight: 23 },
  noResultsText: { color: "#9CA7BE", textAlign: "center", marginTop: 7, fontSize: 13, lineHeight: 20 },
  emptyHero: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 70 },
  emptyIcon: { height: 84, width: 84, borderRadius: 24, marginBottom: 17 },
  emptyBrand: { color: "#FFB84D", fontSize: 21, lineHeight: 29, fontWeight: "900" },
  emptyTitle: { color: "#F6F7FB", fontWeight: "900", fontSize: 23, lineHeight: 31, textAlign: "center", marginTop: 7 },
  emptyText: { color: "#9CA7BE", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 290 },
  primaryButton: { marginTop: 25, backgroundColor: "#FFB84D", paddingHorizontal: 20, height: 46, justifyContent: "center", borderRadius: 13 },
  primaryButtonText: { color: "#10182B", fontWeight: "900", fontSize: 14 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
