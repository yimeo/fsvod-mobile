import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { VodCard } from "@/components/vod-card";
import { fetchVodPage, type MacCmsVod } from "@/lib/maccms";
import { getCategoryClassicPageSize, getCategoryPageMode, rememberSearch, type CategoryClassicPageSize, type CategoryPageMode } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

export default function SearchScreen() {
  const router = useRouter();
  const { endpoint } = useVodSource();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageMode, setPageMode] = useState<CategoryPageMode>("manual");
  const [classicPageSize, setClassicPageSize] = useState<CategoryClassicPageSize>(20);
  const listRef = useRef<FlatList<MacCmsVod>>(null);

  useFocusEffect(useCallback(() => {
    void Promise.all([getCategoryPageMode(), getCategoryClassicPageSize()]).then(([mode, size]) => {
      setPageMode(mode);
      setClassicPageSize(size);
    });
  }, []));

  const loadPage = useCallback(async (keyword: string, requestedPage: number, append = false) => {
    if (!keyword || !endpoint) return;
    setIsLoading(true);
    setError(null);
    try {
      const pageSize = pageMode === "classic" ? classicPageSize : 20;
      const result = await fetchVodPage(endpoint, { page: requestedPage, pageSize, keyword });
      const pageItems = pageMode === "classic" ? result.items.slice(0, classicPageSize) : result.items;
      setItems((current) => append ? [...current, ...pageItems.filter((item) => !current.some((existing) => existing.id === item.id))] : pageItems);
      setPage(result.page);
      setPageCount(result.pageCount);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "搜索失败");
    } finally {
      setIsLoading(false);
    }
  }, [classicPageSize, endpoint, pageMode]);

  const search = useCallback(async (rawValue?: string) => {
    const keyword = (rawValue ?? query).trim();
    if (!keyword || !endpoint) return;
    Keyboard.dismiss();
    setSubmittedQuery(keyword);
    setItems([]);
    setPage(1);
    setPageCount(1);
    await Promise.all([loadPage(keyword, 1), rememberSearch(keyword)]);
  }, [endpoint, loadPage, query]);

  const goToClassicPage = (targetPage: number) => {
    if (isLoading || !submittedQuery || targetPage < 1 || targetPage > pageCount || targetPage === page) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    void loadPage(submittedQuery, targetPage);
  };

  if (!endpoint) {
    return <ScreenContainer className="px-6 pt-8" containerClassName="bg-background"><View style={styles.empty}><Text style={styles.emptyTitle}>尚未配置数据源</Text><Text style={styles.emptyText}>请先在设置中填写 MACCMS 站点域名。</Text><Pressable onPress={() => router.push("/settings" as never)} style={({ pressed }) => [styles.configButton, pressed && styles.pressed]}><Text style={styles.configText}>前往设置</Text></Pressable></View></ScreenContainer>;
  }

  const listHeader = <View><Text style={styles.eyebrow}>DISCOVER</Text><Text style={styles.heading}>搜索影片</Text><Text style={styles.lead}>片名、演员、关键词，快速找到想看的作品。</Text><View style={styles.searchBox}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="输入片名、演员或关键词" placeholderTextColor="#7A879F" style={styles.input} returnKeyType="search" /><Pressable accessibilityRole="button" accessibilityLabel="提交搜索" onPress={() => void search()} style={({ pressed }) => [styles.submit, pressed && styles.pressed]}><Text style={styles.submitText}>搜索</Text></Pressable></View>{error ? <Text style={styles.error}>{error}</Text> : null}{submittedQuery ? <Text style={styles.resultText}>“{submittedQuery}” 的搜索结果</Text> : <Text style={styles.hint}>输入关键词，查看当前数据源中可用的影视内容。</Text>}</View>;
  const footer = isLoading
    ? <View style={styles.footer}><ActivityIndicator color="#F5B64B" /></View>
    : submittedQuery && pageMode === "classic" && pageCount > 1
      ? <ClassicPager page={page} pageCount={pageCount} onChange={goToClassicPage} />
      : submittedQuery && page < pageCount
        ? pageMode === "manual"
          ? <Pressable onPress={() => void loadPage(submittedQuery, page + 1, true)} style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}><Text style={styles.loadMoreText}>加载更多</Text></Pressable>
          : <View style={styles.autoHint}><Text style={styles.autoHintText}>滚动到底自动加载下一页</Text></View>
        : items.length ? <Text style={styles.endText}>已经到底了</Text> : null;

  return <ScreenContainer containerClassName="bg-background"><FlatList ref={listRef} data={items} numColumns={2} key="search-grid" keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>} columnWrapperStyle={items.length ? styles.gridRow : undefined} contentContainerStyle={styles.content} ListHeaderComponent={listHeader} ListEmptyComponent={isLoading ? <View style={styles.loading}><ActivityIndicator color="#F5B64B" size="large" /></View> : submittedQuery ? <View style={styles.empty}><Text style={styles.emptyTitle}>没有找到相关影片</Text><Text style={styles.emptyText}>尝试缩短关键词，或检查数据源的搜索能力。</Text></View> : <View style={styles.empty}><Text style={styles.emptyTitle}>开始搜索</Text><Text style={styles.emptyText}>输入片名、演员或你感兴趣的内容。</Text></View>} ListFooterComponent={footer} onEndReached={() => { if (pageMode === "auto" && submittedQuery && !isLoading && page < pageCount) void loadPage(submittedQuery, page + 1, true); }} onEndReachedThreshold={0.65} showsVerticalScrollIndicator={false} /></ScreenContainer>;
}

function ClassicPager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  const pageNumbers = getClassicPageNumbers(page, pageCount);
  const control = (label: string, target: number, disabled: boolean, wide = false) => <Pressable key={label} disabled={disabled} onPress={() => onChange(target)} style={({ pressed }) => [styles.pagerButton, wide && styles.pagerWideButton, disabled && styles.pagerDisabled, pressed && styles.pressed]}><Text style={styles.pagerText}>{label}</Text></Pressable>;
  return <View style={styles.classicPager}>{control("首页", 1, page === 1, true)}{control("上一页", page - 1, page === 1, true)}{pageNumbers.map((number) => <Pressable key={number} onPress={() => onChange(number)} style={({ pressed }) => [styles.pagerButton, number === page && styles.pagerButtonActive, pressed && styles.pressed]}><Text style={[styles.pagerText, number === page && styles.pagerTextActive]}>{number}</Text></Pressable>)}{control("下一页", page + 1, page === pageCount, true)}{control("尾页", pageCount, page === pageCount, true)}</View>;
}

function getClassicPageNumbers(page: number, pageCount: number): number[] {
  const size = Math.min(5, pageCount);
  const start = Math.max(1, Math.min(page - Math.floor(size / 2), pageCount - size + 1));
  return Array.from({ length: size }, (_, index) => start + index);
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 30 },
  eyebrow: { color: "#F5B64B", fontSize: 10, lineHeight: 15, fontWeight: "900", letterSpacing: 1.5, paddingTop: 15 },
  heading: { color: "#F6F7FB", fontSize: 28, fontWeight: "900", lineHeight: 36, marginTop: 2 },
  lead: { color: "#94A1B4", fontSize: 12, lineHeight: 18, marginTop: 3, marginBottom: 16 },
  searchBox: { height: 49, borderRadius: 14, flexDirection: "row", backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2B3958", paddingLeft: 14, alignItems: "center" },
  input: { flex: 1, color: "#F6F7FB", fontSize: 14, lineHeight: 20, paddingVertical: 0, paddingRight: 10 },
  submit: { backgroundColor: "#F5B64B", height: 37, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, marginRight: 6 },
  submitText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  hint: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 18 },
  resultText: { color: "#C9D1E1", fontSize: 13, lineHeight: 19, marginTop: 13, marginBottom: 18 },
  error: { color: "#F8C174", fontSize: 12, lineHeight: 18, marginTop: 10 },
  gridRow: { gap: 13 },
  gridCell: { flex: 1, maxWidth: "50%" },
  loading: { paddingVertical: 45, alignItems: "center" },
  footer: { paddingVertical: 20, alignItems: "center" },
  loadMore: { alignSelf: "center", height: 40, paddingHorizontal: 18, justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: "#334157", backgroundColor: "#171F2D", marginBottom: 14 },
  loadMoreText: { color: "#F7BE5C", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  autoHint: { paddingVertical: 18, alignItems: "center" },
  autoHintText: { color: "#77869C", fontSize: 11, lineHeight: 16 },
  classicPager: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 5, paddingTop: 2, paddingBottom: 18 },
  pagerButton: { width: 28, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center", backgroundColor: "#182235", borderWidth: 1, borderColor: "#334157" },
  pagerWideButton: { width: 39 },
  pagerButtonActive: { backgroundColor: "#FFB84D", borderColor: "#FFB84D" },
  pagerDisabled: { opacity: 0.35 },
  pagerText: { color: "#C9D5E5", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  pagerTextActive: { color: "#141821" },
  endText: { color: "#68778E", textAlign: "center", paddingBottom: 14, fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 25, paddingVertical: 50 },
  emptyTitle: { color: "#F4F6FA", fontSize: 16, fontWeight: "700", lineHeight: 22, textAlign: "center" },
  emptyText: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  configButton: { marginTop: 20, backgroundColor: "#F5B64B", height: 42, paddingHorizontal: 16, justifyContent: "center", borderRadius: 12 },
  configText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
