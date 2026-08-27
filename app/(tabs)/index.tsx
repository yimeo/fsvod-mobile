import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { VodCard } from "@/components/vod-card";
import { VodPoster } from "@/components/vod-poster";
import { fetchVodPage, mergeMacCmsPages, type MacCmsCategory, type MacCmsVod } from "@/lib/maccms";
import { getWatchHistory, type WatchHistoryEntry } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

const ALL_CATEGORY: MacCmsCategory = { id: "all", name: "全部", parentId: null, children: [] };

export default function HomeScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ typeId?: string }>();
  const { endpoint, categories, isBooting, sourceError, refreshCategories } = useVodSource();
  const [activeRootId, setActiveRootId] = useState("all");
  const [activeTypeId, setActiveTypeId] = useState<string | undefined>();
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);

  const rootCategories = useMemo(() => [ALL_CATEGORY, ...categories], [categories]);
  const selectedRoot = useMemo(() => rootCategories.find((category) => category.id === activeRootId) ?? ALL_CATEGORY, [activeRootId, rootCategories]);
  const childCategories = useMemo(() => selectedRoot.children, [selectedRoot]);
  const childCategoryChoices = useMemo(
    () => selectedRoot.id === "all" ? [] : [{ id: selectedRoot.id, name: "全部内容", parentId: null, children: [] }, ...childCategories],
    [childCategories, selectedRoot.id],
  );

  useEffect(() => { void getWatchHistory().then(setHistory); }, []);

  useEffect(() => {
    const targetTypeId = Array.isArray(routeParams.typeId) ? routeParams.typeId[0] : routeParams.typeId;
    if (!targetTypeId) return;
    const root = categories.find((category) => category.id === targetTypeId) ?? categories.find((category) => category.children.some((child) => child.id === targetTypeId));
    if (!root) return;
    setActiveRootId(root.id);
    setActiveTypeId(targetTypeId);
  }, [categories, routeParams.typeId]);

  const loadPage = useCallback(async (requestedPage: number, append = false) => {
    if (!endpoint) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const shouldAggregateChildren = activeRootId !== "all" && activeTypeId === selectedRoot.id && selectedRoot.children.length > 0;
      const result = shouldAggregateChildren
        ? mergeMacCmsPages(await Promise.all([selectedRoot, ...selectedRoot.children].map((category) => fetchVodPage(endpoint, { page: requestedPage, typeId: category.id }))))
        : await fetchVodPage(endpoint, { page: requestedPage, typeId: activeTypeId });
      setItems((current) => append ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))] : result.items);
      setPage(result.page);
      setPageCount(result.pageCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "影视列表加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [activeRootId, activeTypeId, endpoint, selectedRoot]);

  useEffect(() => { if (endpoint) void loadPage(1); }, [endpoint, activeTypeId, loadPage]);

  const chooseRoot = (id: string) => {
    setActiveRootId(id);
    setActiveTypeId(id === "all" ? undefined : id);
  };
  const chooseChild = (id: string) => setActiveTypeId(id);
  const refresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadPage(1), refreshCategories(), getWatchHistory().then(setHistory)]);
    setIsRefreshing(false);
  };

  if (isBooting) return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#F5B64B" size="large" /></ScreenContainer>;
  if (!endpoint) return <ScreenContainer className="px-6 pt-8" containerClassName="bg-background"><View style={styles.emptyHero}><Image source={require("@/assets/images/icon.png")} style={styles.emptyIcon} /><Text style={styles.emptyBrand}>飞鸿影院</Text><Text style={styles.emptyTitle}>接入你的影视数据源</Text><Text style={styles.emptyText}>填入 MACCMS 站点域名后，即可浏览你喜爱的作品。</Text><Pressable onPress={() => router.push("/settings" as never)} style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}><Text style={styles.primaryButtonText}>配置数据源</Text></Pressable></View></ScreenContainer>;

  const latestHistory = history[0];
  const featuredType = categories[0]?.id ?? "all";
  const sectionTitle = activeTypeId === selectedRoot.id && selectedRoot.children.length > 0 ? `${selectedRoot.name} · 全部内容` : activeTypeId ? (childCategories.find((item) => item.id === activeTypeId)?.name ?? selectedRoot.name) : selectedRoot.name;

  const renderHeader = () => <View>
    <View style={styles.appHeader}><View style={styles.brandLine}><Image source={require("@/assets/images/icon.png")} style={styles.headerIcon} /><Text style={styles.brandName}>飞鸿影院</Text></View><Pressable accessibilityRole="button" accessibilityLabel="打开搜索" onPress={() => router.push("/search" as never)} style={({ pressed }) => [styles.searchButton, pressed && styles.buttonPressed]}><Text style={styles.searchIcon}>⌕</Text></Pressable></View>
    <View style={styles.heroCard}><View style={styles.heroOrb} /><Text style={styles.heroKicker}>现在开始</Text><Text style={styles.heroTitle}>发现下一部{`\n`}值得观看的作品</Text><Text style={styles.heroText}>精选分区和持续更新的内容，打造简洁专注的观影入口。</Text><Pressable onPress={() => chooseRoot(featuredType)} style={({ pressed }) => [styles.heroAction, pressed && styles.buttonPressed]}><Text style={styles.heroActionIcon}>▶</Text><Text style={styles.heroActionText}>开始浏览</Text></Pressable></View>
    <FlatList horizontal data={rootCategories} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList} renderItem={({ item }) => <CategoryChip label={item.name} active={activeRootId === item.id} onPress={() => chooseRoot(item.id)} />} />
    {childCategoryChoices.length > 0 ? <FlatList horizontal data={childCategoryChoices} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subcategoryList} renderItem={({ item }) => <CategoryChip label={item.name} compact active={activeTypeId === item.id} onPress={() => chooseChild(item.id)} />} /> : null}
    {latestHistory ? <View style={styles.continueSection}><Text style={styles.sectionTitle}>继续观看</Text><Text style={styles.sectionSubtitle}>从上次离开的地方继续</Text><Pressable onPress={() => router.push({ pathname: "/vod/[id]", params: { id: latestHistory.id } } as never)} style={({ pressed }) => [styles.continueCard, pressed && styles.buttonPressed]}><VodPoster title={latestHistory.name} url={latestHistory.posterUrl} style={styles.continuePoster} /><View style={styles.continueInfo}><Text numberOfLines={2} style={styles.continueTitle}>{latestHistory.name}</Text><Text style={styles.continueMeta}>{latestHistory.sourceName} · {latestHistory.episodeName}</Text><View style={styles.continueLine}><View style={styles.continueProgress} /></View></View></Pressable></View> : null}
    <View style={styles.contentHeading}><View><Text style={styles.sectionTitle}>正在热映</Text><Text style={styles.sectionSubtitle}>{sectionTitle} · 来自当前数据源的更新内容</Text></View><Pressable onPress={() => chooseRoot("all")} style={({ pressed }) => [styles.moreButton, pressed && styles.buttonPressed]}><Text style={styles.moreText}>更多 ›</Text></Pressable></View>
    {sourceError ? <Text style={styles.warning}>{sourceError}</Text> : null}{loadError ? <Text style={styles.warning}>{loadError}</Text> : null}
  </View>;

  return <ScreenContainer containerClassName="bg-background"><FlatList data={items} numColumns={2} key="vod-grid" keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>} ListHeaderComponent={renderHeader} ListEmptyComponent={!isLoading ? <View style={styles.noResults}><Text style={styles.noResultsTitle}>暂无可展示影片</Text><Text style={styles.noResultsText}>请切换分类，或在设置中确认数据源接口可访问。</Text></View> : null} ListFooterComponent={isLoading ? <View style={styles.footer}><ActivityIndicator color="#F5B64B" /></View> : page < pageCount ? <Pressable style={({ pressed }) => [styles.loadMoreButton, pressed && styles.buttonPressed]} onPress={() => void loadPage(page + 1, true)}><Text style={styles.loadMoreText}>加载更多</Text></Pressable> : items.length > 0 ? <Text style={styles.endText}>已经到底了</Text> : null} contentContainerStyle={styles.content} columnWrapperStyle={items.length ? styles.gridRow : undefined} refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor="#F5B64B" colors={["#F5B64B"]} />} onEndReached={() => { if (!isLoading && page < pageCount) void loadPage(page + 1, true); }} onEndReachedThreshold={0.7} showsVerticalScrollIndicator={false} /></ScreenContainer>;
}

function CategoryChip({ label, active, compact = false, onPress }: { label: string; active: boolean; compact?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, compact && styles.chipCompact, active && styles.chipActive, pressed && styles.buttonPressed]}><Text style={[styles.chipText, compact && styles.chipTextCompact, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 34 },
  appHeader: { height: 58, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIcon: { width: 28, height: 28, borderRadius: 8 },
  brandName: { color: "#F6F7FB", fontSize: 18, lineHeight: 25, fontWeight: "900", letterSpacing: 0.3 },
  searchButton: { width: 41, height: 41, borderRadius: 14, backgroundColor: "#1D263B", justifyContent: "center", alignItems: "center" },
  searchIcon: { color: "#F6F7FB", fontWeight: "700", fontSize: 28, lineHeight: 30, transform: [{ rotate: "-20deg" }] },
  heroCard: { minHeight: 266, overflow: "hidden", backgroundColor: "#20233A", borderRadius: 25, padding: 27, marginTop: 10 },
  heroOrb: { position: "absolute", width: 238, height: 238, borderRadius: 119, right: -40, top: -62, backgroundColor: "#62513B", opacity: 0.84 },
  heroKicker: { color: "#F8BF54", fontSize: 13, lineHeight: 19, fontWeight: "900" },
  heroTitle: { color: "#F8F8FA", fontSize: 29, lineHeight: 37, fontWeight: "900", marginTop: 10, maxWidth: 270 },
  heroText: { color: "#CFD4E0", fontSize: 13, lineHeight: 20, marginTop: 12, maxWidth: 280 },
  heroAction: { alignSelf: "flex-start", height: 50, paddingHorizontal: 18, borderRadius: 14, backgroundColor: "#F5B64B", marginTop: 20, flexDirection: "row", alignItems: "center", gap: 9 },
  heroActionIcon: { color: "#15131A", fontSize: 13, lineHeight: 18 },
  heroActionText: { color: "#15131A", fontSize: 14, lineHeight: 20, fontWeight: "900" },
  categoryList: { gap: 10, paddingVertical: 22, paddingRight: 18 },
  subcategoryList: { gap: 8, paddingBottom: 14, paddingRight: 18, marginTop: -10 },
  chip: { height: 43, paddingHorizontal: 18, justifyContent: "center", borderRadius: 22, backgroundColor: "#20293D", borderWidth: 1, borderColor: "#33405A" },
  chipCompact: { height: 33, paddingHorizontal: 13, borderRadius: 10, backgroundColor: "#151E32" },
  chipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  chipText: { color: "#D9DFEA", fontWeight: "800", fontSize: 13, lineHeight: 18 },
  chipTextCompact: { fontSize: 12 },
  chipTextActive: { color: "#171821" },
  continueSection: { marginBottom: 25 },
  sectionTitle: { color: "#F5F6FA", fontSize: 21, lineHeight: 29, fontWeight: "900" },
  sectionSubtitle: { color: "#96A2B7", fontSize: 12, lineHeight: 18, marginTop: 2 },
  continueCard: { flexDirection: "row", gap: 13, marginTop: 13, alignItems: "center" },
  continuePoster: { width: 104, height: 145, borderRadius: 15 },
  continueInfo: { flex: 1, alignSelf: "stretch", justifyContent: "flex-end", paddingBottom: 10 },
  continueTitle: { color: "#F0F2F7", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  continueMeta: { color: "#9CA9BC", fontSize: 12, lineHeight: 18, marginTop: 5 },
  continueLine: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: "#263249", marginTop: 13 },
  continueProgress: { width: "42%", height: "100%", backgroundColor: "#F5B64B" },
  contentHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingBottom: 15 },
  moreButton: { paddingVertical: 4, paddingLeft: 12 },
  moreText: { color: "#F5B64B", fontSize: 13, lineHeight: 19, fontWeight: "900" },
  warning: { color: "#F8C174", fontSize: 12, lineHeight: 18, backgroundColor: "#2B2630", padding: 10, borderRadius: 10, marginBottom: 12 },
  gridRow: { gap: 13 },
  gridCell: { flex: 1, maxWidth: "50%" },
  footer: { paddingVertical: 20, alignItems: "center" },
  loadMoreButton: { alignSelf: "center", paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: "#20293D", borderWidth: 1, borderColor: "#33405A", marginBottom: 9 },
  loadMoreText: { color: "#E5E9F1", fontWeight: "800", fontSize: 13 },
  endText: { color: "#67748A", textAlign: "center", paddingTop: 4, paddingBottom: 12, fontSize: 12 },
  noResults: { paddingVertical: 48, alignItems: "center", paddingHorizontal: 28 },
  noResultsTitle: { color: "#E7EAF0", fontWeight: "800", fontSize: 16, lineHeight: 23 },
  noResultsText: { color: "#9CA7BE", textAlign: "center", marginTop: 7, fontSize: 13, lineHeight: 20 },
  emptyHero: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 70 },
  emptyIcon: { height: 88, width: 88, borderRadius: 25, marginBottom: 18 },
  emptyBrand: { color: "#F5B64B", fontSize: 22, lineHeight: 30, fontWeight: "900" },
  emptyTitle: { color: "#F6F7FB", fontWeight: "900", fontSize: 23, lineHeight: 31, textAlign: "center", marginTop: 7 },
  emptyText: { color: "#9CA7BE", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 10, maxWidth: 290 },
  primaryButton: { marginTop: 25, backgroundColor: "#F5B64B", paddingHorizontal: 20, height: 46, justifyContent: "center", borderRadius: 13 },
  primaryButtonText: { color: "#10182B", fontWeight: "900", fontSize: 14 },
  buttonPressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
