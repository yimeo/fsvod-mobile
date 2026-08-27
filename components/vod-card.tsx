import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";

import { VodPoster } from "@/components/vod-poster";
import { fetchVodDetail, type MacCmsVod } from "@/lib/maccms";
import { cacheVodDetail, getCachedVodDetail } from "@/lib/vod-storage";
import { useVodSource } from "@/lib/vod-context";

interface VodCardProps {
  item: MacCmsVod;
  onPress: (item: MacCmsVod) => void;
}

type PosterPair = Pick<MacCmsVod, "posterUrl" | "thumbnailUrl">;
const detailPosterCache = new Map<string, PosterPair>();
const requestedDetails = new Set<string>();

export function VodCard({ item, onPress }: VodCardProps) {
  const { endpoint } = useVodSource();
  const [enrichedPoster, setEnrichedPoster] = useState<PosterPair | null>(null);
  const subtitle = [item.year, item.area].filter(Boolean).join(" · ") || item.typeName || "影视";
  const hasListPoster = Boolean(item.posterUrl || item.thumbnailUrl);

  useEffect(() => {
    const cacheKey = `${endpoint?.apiUrl ?? ""}:${item.id}`;
    let active = true;
    if (hasListPoster || !endpoint) {
      setEnrichedPoster(null);
      return () => { active = false; };
    }
    const memoryHit = detailPosterCache.get(cacheKey);
    if (memoryHit) {
      setEnrichedPoster(memoryHit);
      return () => { active = false; };
    }
    if (requestedDetails.has(cacheKey)) return () => { active = false; };
    requestedDetails.add(cacheKey);
    const enrich = async () => {
      try {
        const cachedDetail = await getCachedVodDetail(item.id);
        const detail = cachedDetail ?? await fetchVodDetail(endpoint, item.id);
        if (!cachedDetail) await cacheVodDetail(detail);
        const poster = { posterUrl: detail.posterUrl, thumbnailUrl: detail.thumbnailUrl };
        detailPosterCache.set(cacheKey, poster);
        if (active && (poster.posterUrl || poster.thumbnailUrl)) setEnrichedPoster(poster);
      } catch {
        // 保留文字海报：数据源未提供或详情接口无法访问时不阻断列表滚动。
      } finally {
        requestedDetails.delete(cacheKey);
      }
    };
    void enrich();
    return () => { active = false; };
  }, [endpoint, hasListPoster, item.id]);

  const posterUrl = item.posterUrl ?? enrichedPoster?.posterUrl ?? null;
  const thumbnailUrl = item.thumbnailUrl ?? enrichedPoster?.thumbnailUrl ?? null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${item.name}`} onPress={() => onPress(item)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}><VodPoster title={item.name} url={posterUrl} thumbnailUrl={thumbnailUrl} style={styles.poster} />{item.remarks ? <View style={styles.remark}><Text numberOfLines={1} style={styles.remarkText}>{item.remarks}</Text></View> : null}<Text numberOfLines={1} style={styles.title}>{item.name}</Text><Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, marginBottom: 20 },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: 12, backgroundColor: "#151E34" },
  remark: { position: "absolute", right: 7, top: 8, maxWidth: "76%", borderRadius: 7, backgroundColor: "rgba(11,16,32,0.82)", paddingHorizontal: 7, paddingVertical: 4 },
  remarkText: { color: "#F8D28D", fontWeight: "700", fontSize: 10, lineHeight: 14 },
  title: { color: "#F6F7FB", fontWeight: "700", marginTop: 9, fontSize: 14, lineHeight: 20 },
  subtitle: { color: "#9CA7BE", marginTop: 2, fontSize: 12, lineHeight: 17 },
});
