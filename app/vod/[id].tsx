import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { VodPoster } from "@/components/vod-poster";
import { fetchVodDetail, type MacCmsVodDetail } from "@/lib/maccms";
import { cacheVodDetail, getCachedVodDetail, saveWatchHistory } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

export default function VodDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { endpoint } = useVodSource();
  const [detail, setDetail] = useState<MacCmsVodDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setIsLoading(true);
      setError(null);
      const cached = await getCachedVodDetail(id);
      if (cached) {
        setDetail(cached);
        setIsLoading(false);
      }
      if (!endpoint) {
        if (!cached) setError("未找到数据源配置");
        return;
      }
      try {
        const fresh = await fetchVodDetail(endpoint, id);
        setDetail(fresh);
        await cacheVodDetail(fresh);
      } catch (loadError) {
        if (!cached) setError(loadError instanceof Error ? loadError.message : "影片详情加载失败");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [endpoint, id]);

  const source = useMemo(() => detail?.sources[sourceIndex] ?? null, [detail, sourceIndex]);

  const play = async (episodeName: string, url: string) => {
    if (!detail || !source) return;
    await saveWatchHistory({ id: detail.id, name: detail.name, posterUrl: detail.posterUrl, sourceName: source.name, episodeName, watchedAt: new Date().toISOString() });
    router.push({ pathname: "/player", params: { url, title: detail.name, episode: episodeName, source: source.name } } as never);
  };

  if (isLoading && !detail) return <View style={styles.page}><ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#F5B64B" size="large" /></ScreenContainer><GlobalBottomNavigation /></View>;
  if (!detail) return <View style={styles.page}><ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background"><Text style={styles.errorTitle}>无法加载影片</Text><Text style={styles.errorText}>{error ?? "影片不存在或已被删除"}</Text><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>返回</Text></Pressable></ScreenContainer><GlobalBottomNavigation /></View>;

  const metadata = [detail.year, detail.area, detail.language].filter(Boolean).join(" · ");
  return (
    <View style={styles.page}>
    <ScreenContainer containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backLabel}>‹ 返回</Text></Pressable>
        <View style={styles.hero}><VodPoster title={detail.name} url={detail.posterUrl} style={styles.poster} /><View style={styles.heroInfo}><Text style={styles.title}>{detail.name}</Text><Text style={styles.metadata}>{metadata || detail.typeName || "影视"}</Text>{detail.remarks ? <Text style={styles.remark}>{detail.remarks}</Text> : null}<Text numberOfLines={4} style={styles.contentText}>{detail.content || "暂无剧情简介"}</Text></View></View>
        {(detail.actor || detail.director) ? <View style={styles.creditBox}>{detail.director ? <Text style={styles.credit}>导演：{detail.director}</Text> : null}{detail.actor ? <Text style={styles.credit}>主演：{detail.actor}</Text> : null}</View> : null}
        <View style={styles.titleRow}><Text style={styles.sectionTitle}>播放线路</Text><Text style={styles.cacheLabel}>已缓存到本机</Text></View>
        <FlatList horizontal data={detail.sources} keyExtractor={(item) => item.name} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceList} renderItem={({ item, index }) => <Pressable onPress={() => setSourceIndex(index)} style={({ pressed }) => [styles.sourceChip, sourceIndex === index && styles.sourceChipActive, pressed && styles.pressed]}><Text style={[styles.sourceText, sourceIndex === index && styles.sourceTextActive]}>{item.name}</Text></Pressable>} />
        {source ? <><Text style={styles.episodeLabel}>{source.name} · {source.episodes.length} 集</Text><FlatList horizontal data={source.episodes} keyExtractor={(item, index) => `${item.name}-${index}`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.episodeList} renderItem={({ item }) => <Pressable onPress={() => void play(item.name, item.url)} style={({ pressed }) => [styles.episode, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.episodeText}>{item.name}</Text></Pressable>} /></> : <Text style={styles.noSource}>数据源未提供可用播放线路。</Text>}
      </ScrollView>
    </ScreenContainer>
    <GlobalBottomNavigation />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 18, paddingBottom: 112 },
  back: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 12, marginBottom: 12 },
  backLabel: { color: "#B9D7F6", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  hero: { flexDirection: "row", gap: 15 },
  poster: { width: 126, aspectRatio: 2 / 3, borderRadius: 14 },
  heroInfo: { flex: 1, paddingTop: 2 },
  title: { color: "#F6F7FB", fontWeight: "800", fontSize: 21, lineHeight: 28 },
  metadata: { color: "#9CA7BE", fontSize: 12, lineHeight: 18, marginTop: 7 },
  remark: { color: "#F8D28D", fontWeight: "700", fontSize: 12, lineHeight: 18, marginTop: 6 },
  contentText: { color: "#BDC7D8", fontSize: 12, lineHeight: 19, marginTop: 10 },
  creditBox: { marginTop: 16, borderRadius: 12, backgroundColor: "#151E34", padding: 12 },
  credit: { color: "#AAB6CA", fontSize: 12, lineHeight: 19 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 23, marginBottom: 11 },
  sectionTitle: { color: "#F6F7FB", fontSize: 18, lineHeight: 25, fontWeight: "800" },
  cacheLabel: { color: "#76BEF5", fontSize: 11, lineHeight: 16 },
  sourceList: { gap: 9, paddingRight: 18 },
  sourceChip: { height: 35, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#354969", justifyContent: "center", backgroundColor: "#151E34" },
  sourceChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  sourceText: { color: "#C4CEDF", fontSize: 13, fontWeight: "700" },
  sourceTextActive: { color: "#11192B" },
  episodeLabel: { color: "#AAB6C8", fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  episodeList: { gap: 9, paddingRight: 18 },
  episode: { minWidth: 82, maxWidth: 130, height: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#1A2945", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#314566" },
  episodeText: { color: "#D8E2F0", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  noSource: { color: "#9CA7BE", fontSize: 13, lineHeight: 20, paddingVertical: 18 },
  errorTitle: { color: "#F4F6FA", fontSize: 18, lineHeight: 25, fontWeight: "800", textAlign: "center" },
  errorText: { color: "#AAB7CA", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  backButton: { marginTop: 20, backgroundColor: "#F5B64B", borderRadius: 11, paddingHorizontal: 16, height: 42, justifyContent: "center" },
  backText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
