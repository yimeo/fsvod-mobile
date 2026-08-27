import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { VodCard } from "@/components/vod-card";
import { fetchVodPage, type MacCmsVod } from "@/lib/maccms";
import { rememberSearch } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

export default function SearchScreen() {
  const router = useRouter();
  const { endpoint } = useVodSource();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [items, setItems] = useState<MacCmsVod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (rawValue?: string) => {
    const keyword = (rawValue ?? query).trim();
    if (!keyword || !endpoint) return;
    Keyboard.dismiss();
    setIsLoading(true);
    setError(null);
    setSubmittedQuery(keyword);
    try {
      const page = await fetchVodPage(endpoint, { page: 1, keyword });
      setItems(page.items);
      await rememberSearch(keyword);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "搜索失败");
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, query]);

  if (!endpoint) {
    return <ScreenContainer className="px-6 pt-8" containerClassName="bg-background"><View style={styles.empty}><Text style={styles.emptyTitle}>尚未配置数据源</Text><Text style={styles.emptyText}>请先在设置中填写 MACCMS 站点域名。</Text><Pressable onPress={() => router.push("/settings" as never)} style={({ pressed }) => [styles.configButton, pressed && styles.pressed]}><Text style={styles.configText}>前往设置</Text></Pressable></View></ScreenContainer>;
  }

  return (
    <ScreenContainer containerClassName="bg-background">
      <FlatList
        data={items}
        numColumns={2}
        key="search-grid"
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <View style={styles.gridCell}><VodCard item={item} onPress={(vod) => router.push({ pathname: "/vod/[id]", params: { id: vod.id } } as never)} /></View>}
        columnWrapperStyle={items.length ? styles.gridRow : undefined}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View><Text style={styles.eyebrow}>DISCOVER</Text><Text style={styles.heading}>搜索影片</Text><Text style={styles.lead}>片名、演员、关键词，快速找到想看的作品。</Text><View style={styles.searchBox}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="输入片名、演员或关键词" placeholderTextColor="#7A879F" style={styles.input} returnKeyType="search" /><Pressable accessibilityRole="button" accessibilityLabel="提交搜索" onPress={() => void search()} style={({ pressed }) => [styles.submit, pressed && styles.pressed]}><Text style={styles.submitText}>搜索</Text></Pressable></View>{error ? <Text style={styles.error}>{error}</Text> : null}{submittedQuery ? <Text style={styles.resultText}>“{submittedQuery}” 的搜索结果</Text> : <Text style={styles.hint}>输入关键词，查看当前数据源中可用的影视内容。</Text>}</View>}
        ListEmptyComponent={isLoading ? <View style={styles.loading}><ActivityIndicator color="#F5B64B" size="large" /></View> : submittedQuery ? <View style={styles.empty}><Text style={styles.emptyTitle}>没有找到相关影片</Text><Text style={styles.emptyText}>尝试缩短关键词，或检查数据源的搜索能力。</Text></View> : <View style={styles.empty}><Text style={styles.emptyTitle}>开始搜索</Text><Text style={styles.emptyText}>输入片名、演员或你感兴趣的内容。</Text></View>}
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
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
  empty: { alignItems: "center", paddingHorizontal: 25, paddingVertical: 50 },
  emptyTitle: { color: "#F4F6FA", fontSize: 16, fontWeight: "700", lineHeight: 22, textAlign: "center" },
  emptyText: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
  configButton: { marginTop: 20, backgroundColor: "#F5B64B", height: 42, paddingHorizontal: 16, justifyContent: "center", borderRadius: 12 },
  configText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
