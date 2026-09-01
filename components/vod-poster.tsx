import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useEffect, useState } from "react";

import { recordPosterCache } from "@/lib/poster-cache";

interface VodPosterProps {
  title: string;
  url: string | null;
  thumbnailUrl?: string | null;
  cacheKey?: string;
  style?: object;
}

const BLUR_HASH = "L35E8c%L?bof00j[IUj[?bofD%j[";

function generatedTone(title: string): { start: string; end: string } {
  const tones = [
    { start: "#182B50", end: "#51306B" },
    { start: "#153B42", end: "#1B5A63" },
    { start: "#392235", end: "#724D3C" },
    { start: "#253042", end: "#4B3D61" },
  ];
  const index = [...title].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % tones.length;
  return tones[index];
}

export function VodPoster({ title, url, thumbnailUrl, cacheKey = "global", style }: VodPosterProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const hasDistinctThumbnail = Boolean(thumbnailUrl && thumbnailUrl !== url);
  const useThumbnail = hasDistinctThumbnail && !thumbnailFailed;
  const shouldLoadFull = !hasDistinctThumbnail || thumbnailFailed || thumbnailLoaded;

  useEffect(() => {
    setThumbnailFailed(false);
    setThumbnailLoaded(false);
    setFullFailed(false);
    setFullLoaded(false);
  }, [thumbnailUrl, url]);

  if ((url && !fullFailed) || (useThumbnail && thumbnailUrl)) {
    return (
      <View style={[styles.posterFrame, style]} accessibilityLabel={`${title} 海报`}>
        {useThumbnail && thumbnailUrl ? <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" priority="high" placeholder={{ blurhash: BLUR_HASH }} placeholderContentFit="cover" recyclingKey={`thumb-${cacheKey}-${thumbnailUrl}`} onLoad={() => { setThumbnailLoaded(true); recordPosterCache(thumbnailUrl); }} onError={() => setThumbnailFailed(true)} /> : null}
        {url && !fullFailed && shouldLoadFull ? <Image source={{ uri: url }} style={[StyleSheet.absoluteFill, useThumbnail && !fullLoaded && styles.fullImageHidden]} contentFit="cover" cachePolicy="memory-disk" priority="high" transition={120} recyclingKey={`full-${cacheKey}-${url}`} onLoad={() => { setFullLoaded(true); recordPosterCache(url); }} onError={() => setFullFailed(true)} /> : null}
      </View>
    );
  }

  const tone = generatedTone(title);
  return (
    <View style={[styles.generated, style]} accessibilityLabel={`${title} 自动生成海报`}>
      <Svg width="100%" height="100%" viewBox="0 0 180 270" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="posterGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={tone.start} />
            <Stop offset="1" stopColor={tone.end} />
          </LinearGradient>
        </Defs>
        <Rect width="180" height="270" fill="url(#posterGradient)" />
        <Circle cx="146" cy="51" r="42" fill="rgba(245,182,75,0.18)" />
        <Circle cx="29" cy="223" r="54" fill="rgba(93,183,255,0.12)" />
        <Rect x="15" y="18" width="3" height="235" fill="rgba(255,255,255,0.16)" />
      </Svg>
      <View style={styles.generatedTopline} />
      <Text numberOfLines={3} style={styles.generatedTitle}>{title}</Text>
      <Text style={styles.generatedCaption}>飞鸿 · 影院</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  posterFrame: { overflow: "hidden", backgroundColor: "#151E34" },
  fullImageHidden: { opacity: 0 },
  generated: { overflow: "hidden", justifyContent: "flex-end", padding: 13, backgroundColor: "#202B46" },
  generatedTopline: { width: 28, height: 3, borderRadius: 4, backgroundColor: "#F5B64B", marginBottom: 8 },
  generatedTitle: { color: "#FFFFFF", fontSize: 19, lineHeight: 25, fontWeight: "800", letterSpacing: 0.4, textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 8 },
  generatedCaption: { color: "#D8DEEA", fontSize: 10, letterSpacing: 1.5, marginTop: 9, fontWeight: "700" },
});
