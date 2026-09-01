import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoView, useVideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { GlobalBottomNavigation } from "@/components/global-bottom-navigation";
import { ScreenContainer } from "@/components/screen-container";
import { isDirectVideoUrl, type MacCmsPlaySource } from "@/lib/maccms";
import { getOfflineDownload, getOfflineDownloads } from "@/lib/offline-downloads";
import { saveWatchHistory } from "@/lib/vod-storage";

interface PlaylistEpisode {
  name: string;
  url: string;
}

function getParam(value: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function parsePlaylist(value: string): PlaylistEpisode[] {
  try {
    const data = JSON.parse(value) as unknown;
    return Array.isArray(data)
      ? data.filter((item): item is PlaylistEpisode => Boolean(item && typeof item === "object" && typeof (item as PlaylistEpisode).name === "string" && typeof (item as PlaylistEpisode).url === "string"))
      : [];
  } catch {
    return [];
  }
}

function parsePlaySources(value: string): MacCmsPlaySource[] {
  try {
    const data = JSON.parse(value) as unknown;
    return Array.isArray(data)
      ? data.filter((item): item is MacCmsPlaySource => Boolean(item && typeof item === "object" && typeof (item as MacCmsPlaySource).name === "string" && Array.isArray((item as MacCmsPlaySource).episodes)))
      : [];
  } catch {
    return [];
  }
}

function safelyPause(player: { pause: () => void }): void {
  try {
    player.pause();
  } catch {
    // The hook owns the native player's release lifecycle. A late pause must not interrupt navigation.
  }
}

function formatNetworkSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "— MB/s";
  const kilobitsPerSecond = (bytesPerSecond * 8) / 1000;
  return `${kilobitsPerSecond >= 100 ? Math.round(kilobitsPerSecond) : kilobitsPerSecond.toFixed(1)} MB/s`;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5] as const;

function isHlsPlaybackUrl(url: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(url);
}

function formatPlaybackRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(rate).replace(/0+$/, "").replace(/\.$/, "");
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    episodeUrl?: string;
    title?: string;
    contentType?: string;
    episode?: string;
    source?: string;
    offline?: string;
    playlist?: string;
    playSources?: string;
    episodeIndex?: string;
    vodId?: string;
    posterUrl?: string;
    resumePosition?: string;
  }>();
  const router = useRouter();
  const routeUrl = getParam(params.url);
  const title = getParam(params.title, "影片播放");
  const routeEpisode = getParam(params.episode);
  const routeSource = getParam(params.source);
  const vodId = getParam(params.vodId);
  const posterUrl = getParam(params.posterUrl) || null;
  const routeEpisodeUrl = getParam(params.episodeUrl, routeUrl);
  const routeIsOffline = getParam(params.offline) === "1";
  const playlist = useMemo(() => parsePlaylist(getParam(params.playlist)), [params.playlist]);
  const parsedSources = useMemo(() => parsePlaySources(getParam(params.playSources)), [params.playSources]);
  const playSources = useMemo(
    () => (parsedSources.length ? parsedSources : routeSource ? [{ name: routeSource, episodes: playlist }] : []),
    [parsedSources, playlist, routeSource],
  );
  const requestedEpisodeIndex = Number.parseInt(getParam(params.episodeIndex), 10);
  const initialSourceIndex = useMemo(() => {
    const byName = playSources.findIndex((item) => item.name === routeSource);
    return byName >= 0 ? byName : 0;
  }, [playSources, routeSource]);
  const [activeSourceIndex, setActiveSourceIndex] = useState(initialSourceIndex);
  const initialEpisodeIndex = useMemo(() => {
    const initialSource = playSources[initialSourceIndex];
    const byUrl = initialSource?.episodes.findIndex((item) => item.url === routeEpisodeUrl || item.url === routeUrl) ?? -1;
    if (byUrl >= 0) return byUrl;
    return Number.isInteger(requestedEpisodeIndex) && requestedEpisodeIndex >= 0 && requestedEpisodeIndex < (initialSource?.episodes.length ?? 0)
      ? requestedEpisodeIndex
      : 0;
  }, [initialSourceIndex, playSources, requestedEpisodeIndex, routeEpisodeUrl, routeUrl]);
  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(initialEpisodeIndex);
  const activeSource = playSources[activeSourceIndex] ?? null;
  const activeEpisode = activeSource?.episodes[activeEpisodeIndex] ?? null;
  const activeEpisodeUrl = activeEpisode?.url || routeEpisodeUrl || routeUrl;
  const activeEpisodeName = activeEpisode?.name || routeEpisode || "正在播放";
  const activeSourceName = activeSource?.name || routeSource;
  const [offlineUri, setOfflineUri] = useState<string | null>(routeIsOffline ? routeUrl : null);
  const [offlineUrls, setOfflineUrls] = useState<Set<string>>(() => new Set());
  const [offlineSizes, setOfflineSizes] = useState<Map<string, number>>(() => new Map());
  const [isOfflineResolved, setIsOfflineResolved] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState<string | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"idle" | "loading" | "readyToPlay" | "error">("idle");
  const [bufferedPosition, setBufferedPosition] = useState(-1);
  const [networkSpeed, setNetworkSpeed] = useState("检测中…");
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isRatePickerOpen, setIsRatePickerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fullscreenOrientation, setFullscreenOrientation] = useState<"default" | "portrait" | "landscape">("default");
  const player = useVideoPlayer(null);
  const lastSavedPosition = useRef(0);
  const latestPosition = useRef(0);
  const replaceRequestId = useRef(0);
  const isLeaving = useRef(false);
  const resumePositionValue = Number(getParam(params.resumePosition, "0"));
  const resumePosition = Number.isFinite(resumePositionValue) && resumePositionValue > 3 ? resumePositionValue : 0;
  const playbackUrl = isOfflineResolved ? offlineUri ?? activeEpisodeUrl : "";
  const isUsingOffline = Boolean(offlineUri);
  const directPlayable = Boolean(playbackUrl && isDirectVideoUrl(playbackUrl));

  const persistProgress = useCallback((positionSeconds: number) => {
    if (!vodId || !activeEpisodeUrl || !Number.isFinite(positionSeconds)) return;
    const safePosition = Math.max(0, Math.floor(positionSeconds));
    if (safePosition > 0 && Math.abs(safePosition - lastSavedPosition.current) < 4) return;
    lastSavedPosition.current = safePosition;
    void saveWatchHistory({
      id: vodId,
      name: title,
      posterUrl,
      sourceName: activeSourceName,
      episodeName: activeEpisodeName,
      episodeUrl: activeEpisodeUrl,
      episodeIndex: activeEpisodeIndex,
      playlist: activeSource?.episodes ?? playlist,
      playSources,
      positionSeconds: safePosition,
      watchedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }, [activeEpisodeIndex, activeEpisodeName, activeEpisodeUrl, activeSource?.episodes, activeSourceName, playSources, playlist, posterUrl, title, vodId]);

  useEffect(() => {
    lastSavedPosition.current = 0;
    latestPosition.current = 0;
    setFullscreenOrientation("default");
  }, [activeEpisodeUrl]);

  useEffect(() => {
    let mounted = true;
    setIsOfflineResolved(false);
    setPlaybackMessage(null);
    setPlayerStatus("idle");
    setBufferedPosition(-1);
    setNetworkSpeed("检测中…");
    void Promise.all([getOfflineDownload(activeEpisodeUrl), getOfflineDownloads()])
      .then(([current, downloads]) => {
        if (!mounted) return;
        const isInitialRouteEpisode = activeEpisodeUrl === routeEpisodeUrl;
        setOfflineUri(current?.localUri ?? (routeIsOffline && isInitialRouteEpisode ? routeUrl : null));
        setOfflineUrls(new Set(downloads.map((item) => item.remoteUrl)));
        setOfflineSizes(new Map(downloads.map((item) => [item.remoteUrl, item.sizeBytes])));
        setIsOfflineResolved(true);
      })
      .catch(() => {
        if (!mounted) return;
        setOfflineUri(null);
        setIsOfflineResolved(true);
      });
    return () => {
      mounted = false;
    };
  }, [activeEpisodeUrl, routeEpisodeUrl, routeIsOffline, routeUrl]);

  useEffect(() => {
    const requestId = ++replaceRequestId.current;
    let cancelled = false;
    if (!directPlayable) {
      safelyPause(player);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        safelyPause(player);
        await player.replaceAsync({
          uri: playbackUrl,
          ...(isHlsPlaybackUrl(playbackUrl) ? { contentType: "hls" as const } : {}),
          // expo-video supports progressive-file caching on Android and iOS.
          // iOS still cannot cache HLS streams, but MP4/WebM can be cached.
          useCaching: true,
        });
        if (cancelled || requestId !== replaceRequestId.current || isLeaving.current) return;
        if (resumePosition > 0 && activeEpisodeUrl === routeEpisodeUrl) {
          try {
            player.currentTime = resumePosition;
            latestPosition.current = resumePosition;
          } catch {
            // Seeking is optional; playback can continue from the beginning if a source rejects a seek.
          }
        }
        player.play();
      } catch {
        if (!cancelled && requestId === replaceRequestId.current) {
          setPlaybackMessage("当前线路无法启动播放，请切换其他线路或在浏览器中打开。");
        }
      }
    })();

    return () => {
      cancelled = true;
      safelyPause(player);
    };
  }, [activeEpisodeUrl, directPlayable, playbackUrl, player, resumePosition, routeEpisodeUrl]);

  useEffect(() => {
    if (!directPlayable) return;
    try {
      player.playbackRate = playbackRate;
    } catch {
      // The current source may still be replacing; the ready state applies the chosen rate again.
    }
  }, [directPlayable, playbackRate, player]);

  useEffect(() => {
    if (!directPlayable) return;
    const updateOrientation = (track: { size?: { width?: number; height?: number } } | null | undefined) => {
      const width = track?.size?.width ?? 0;
      const height = track?.size?.height ?? 0;
      if (width > 0 && height > 0) setFullscreenOrientation(height > width ? "portrait" : "landscape");
    };
    const readCurrentTrack = () => updateOrientation(player.videoTrack ?? player.availableVideoTracks?.[0]);
    const sourceSubscription = player.addListener("sourceLoad", ({ availableVideoTracks }) => updateOrientation(availableVideoTracks?.[0]));
    const trackSubscription = player.addListener("videoTrackChange", ({ videoTrack }) => updateOrientation(videoTrack));
    const firstRetry = setTimeout(readCurrentTrack, 350);
    const secondRetry = setTimeout(readCurrentTrack, 1200);
    player.timeUpdateEventInterval = 5;
    const timeSubscription = player.addListener("timeUpdate", ({ currentTime, bufferedPosition: nextBufferedPosition }) => {
      if (Number.isFinite(currentTime)) {
        latestPosition.current = currentTime;
        persistProgress(currentTime);
      }
      if (Number.isFinite(nextBufferedPosition)) setBufferedPosition(nextBufferedPosition);
    });
    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
      setPlayerStatus(status);
      if (status === "error") setPlaybackMessage(error?.message || "当前线路加载失败，请切换其他线路。");
    });
    const playingSubscription = player.addListener("playingChange", ({ isPlaying: nextIsPlaying }) => setIsPlaying(nextIsPlaying));
    return () => {
      sourceSubscription.remove();
      trackSubscription.remove();
      clearTimeout(firstRetry);
      clearTimeout(secondRetry);
      timeSubscription.remove();
      statusSubscription.remove();
      playingSubscription.remove();
    };
  }, [directPlayable, persistProgress, player]);

  useEffect(() => {
    if (!directPlayable || isUsingOffline || !playbackUrl) return;
    let cancelled = false;
    const probeNetworkSpeed = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const startedAt = Date.now();
      if (!cancelled) setNetworkSpeed("测速中…");
      try {
        const response = await fetch(playbackUrl, { headers: { Range: "bytes=0-262143" }, cache: "no-store", signal: controller.signal });
        const declaredLength = Number(response.headers.get("content-length") || 0);
        // Never download a full video when a server ignores the Range header.
        if (response.status !== 206 && declaredLength > 512 * 1024) {
          if (!cancelled) setNetworkSpeed("— kbps");
          return;
        }
        const payload = await response.arrayBuffer();
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
        if (!cancelled) {
          setNetworkSpeed(formatNetworkSpeed(payload.byteLength / elapsedSeconds));
        }
      } catch {
        if (!cancelled) setNetworkSpeed("— kbps");
      } finally {
        clearTimeout(timeout);
      }
    };
    void probeNetworkSpeed();
    const interval = setInterval(() => void probeNetworkSpeed(), 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [directPlayable, isUsingOffline, playbackUrl]);

  useFocusEffect(useCallback(() => {
    return () => {
      persistProgress(latestPosition.current);
      safelyPause(player);
    };
  }, [persistProgress, player]));

  const returnToPreviousScreen = useCallback(() => {
    if (isLeaving.current) return;
    isLeaving.current = true;
    replaceRequestId.current += 1;
    persistProgress(latestPosition.current);
    safelyPause(player);
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (vodId) {
      router.replace({ pathname: "/vod/[id]", params: { id: vodId } } as never);
      return;
    }
    router.replace("/" as never);
  }, [persistProgress, player, router, vodId]);

  const openExternal = useCallback(async () => {
    if (!activeEpisodeUrl) return;
    Alert.alert("打开网页播放地址", "该线路是网页播放器，将使用手机默认浏览器打开，不会在 App 内打开。", [
      { text: "取消", style: "cancel" },
      {
        text: "打开浏览器",
        onPress: () => {
          void Linking.openURL(activeEpisodeUrl).catch(() => setPlaybackMessage("无法调用手机默认浏览器打开该播放地址。"));
        },
      },
    ]);
  }, [activeEpisodeUrl]);

  const togglePlayback = useCallback(() => {
    if (!directPlayable || playerStatus === "error" || playerStatus === "loading") return;
    try {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch {
      setPlaybackMessage("当前视频暂时无法切换播放状态。");
    }
  }, [directPlayable, player, playerStatus]);

  const setRate = useCallback((nextRate: number) => {
    try {
      // Change only the native player's rate. Do not replace the source or seek;
      // expo-video keeps currentTime when playbackRate changes in place.
      player.playbackRate = nextRate;
      setPlaybackRate(nextRate);
      setIsRatePickerOpen(false);
    } catch {
      setPlaybackMessage("当前线路暂不支持调整倍速。");
    }
  }, [player]);

  const doubleTap = useMemo(
    () => Gesture.Tap().numberOfTaps(2).maxDelay(260).runOnJS(true).onEnd((_event, success) => { if (success) togglePlayback(); }),
    [togglePlayback],
  );

  const playEpisodeAt = useCallback((index: number) => {
    if (!activeSource?.episodes[index] || index === activeEpisodeIndex || isLeaving.current) return;
    replaceRequestId.current += 1;
    persistProgress(latestPosition.current);
    safelyPause(player);
    setActiveEpisodeIndex(index);
  }, [activeEpisodeIndex, activeSource?.episodes, persistProgress, player]);

  const switchSource = useCallback((nextSourceIndex: number) => {
    const nextSource = playSources[nextSourceIndex];
    if (!nextSource || nextSourceIndex === activeSourceIndex || isLeaving.current) return;
    const byName = nextSource.episodes.findIndex((item) => item.name === activeEpisodeName);
    const nextEpisodeIndex = byName >= 0 ? byName : Math.min(activeEpisodeIndex, Math.max(nextSource.episodes.length - 1, 0));
    if (!nextSource.episodes[nextEpisodeIndex]) {
      setPlaybackMessage("该线路暂未提供可播放剧集。");
      return;
    }
    replaceRequestId.current += 1;
    persistProgress(latestPosition.current);
    safelyPause(player);
    setActiveSourceIndex(nextSourceIndex);
    setActiveEpisodeIndex(nextEpisodeIndex);
  }, [activeEpisodeIndex, activeEpisodeName, activeSourceIndex, persistProgress, playSources, player]);

  useEffect(() => {
    if (!directPlayable || !activeSource || activeEpisodeIndex >= activeSource.episodes.length - 1) return;
    const subscription = player.addListener("playToEnd", () => playEpisodeAt(activeEpisodeIndex + 1));
    return () => {
      subscription.remove();
    };
  }, [activeEpisodeIndex, activeSource, directPlayable, playEpisodeAt, player]);

  if (!routeUrl) {
    return (
      <View style={styles.page}>
        <ScreenContainer className="px-6 items-center justify-center" containerClassName="bg-background">
          <Text style={styles.errorTitle}>播放地址无效</Text>
          <Pressable onPress={returnToPreviousScreen} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backText}>返回详情</Text>
          </Pressable>
        </ScreenContainer>
        <GlobalBottomNavigation />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ScreenContainer containerClassName="bg-background" edges={["top", "bottom", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable onPress={returnToPreviousScreen} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
              <Text style={styles.backLabel}>‹ 返回</Text>
            </Pressable>
            <View style={styles.headerInfo}>
              <Text numberOfLines={1} style={styles.title}>{title}</Text>
              <Text numberOfLines={1} style={styles.episode}>{activeEpisodeName}{activeSourceName ? ` · ${activeSourceName}` : ""}</Text>
            </View>
          </View>

          {directPlayable ? (
            <View style={styles.playerWrap}>
              <View style={styles.videoStage}>
                <GestureDetector gesture={doubleTap}>
                  <View style={styles.videoTouchArea}>
                    <VideoView
                      style={styles.video}
                      player={player}
                      nativeControls
                      fullscreenOptions={{ enable: true, orientation: fullscreenOrientation, autoExitOnRotate: false }}
                      contentFit="contain"
                      surfaceType="textureView"
                      useExoShutter
                    />
                  </View>
                </GestureDetector>
                {(!isOfflineResolved || (playerStatus !== "readyToPlay" && playerStatus !== "error")) ? <View style={styles.loadingOverlay}><ActivityIndicator color="#F5B64B" size="large" /><Text style={styles.loadingTitle}>{!isOfflineResolved ? "正在准备影视…" : playerStatus === "loading" ? "正在加载影视…" : "正在连接播放源…"}</Text><Text style={styles.loadingMeta}>{isUsingOffline ? "正在读取本机缓存" : `网络速度 ${networkSpeed}`}</Text></View> : null}
              </View>
              <View style={styles.statusRow}>
                <Text style={isUsingOffline ? styles.offlineBadge : styles.networkBadge}>{isUsingOffline ? "离线播放" : "网络播放"}</Text>
                {!isUsingOffline ? <Pressable accessibilityRole="button" accessibilityLabel="选择播放倍速" onPress={() => setIsRatePickerOpen((current) => !current)} style={({ pressed }) => [styles.rateTrigger, isRatePickerOpen && styles.rateTriggerOpen, pressed && styles.pressed]}><Text style={styles.rateTriggerText}>倍速 {formatPlaybackRate(playbackRate)}×</Text></Pressable> : null}
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.statusText}>{isUsingOffline ? "状态：已连接 · 缓冲：本地" : `状态：${playerStatus === "readyToPlay" ? (isPlaying ? "播放中" : "已暂停") : playerStatus === "error" ? "连接异常" : "加载中"} · 网速：${networkSpeed} · 缓冲：${bufferedPosition >= 0 ? `${Math.max(0, bufferedPosition).toFixed(0)} 秒` : "检测中"}`}</Text>
              </View>
              {!isUsingOffline && isRatePickerOpen ? <View style={styles.ratePicker}>{PLAYBACK_RATES.map((rate) => <Pressable key={rate} accessibilityRole="button" accessibilityLabel={`设置 ${formatPlaybackRate(rate)} 倍速`} onPress={() => setRate(rate)} style={({ pressed }) => [styles.speedChip, playbackRate === rate && styles.speedChipActive, pressed && styles.pressed]}><Text style={[styles.speedChipText, playbackRate === rate && styles.speedChipTextActive]}>{formatPlaybackRate(rate)}×</Text></Pressable>)}</View> : null}
            </View>
          ) : (
            <View style={styles.unsupported}>
              <Text style={styles.unsupportedTitle}>此线路不是可直接播放的视频地址</Text>
              <Text style={styles.unsupportedText}>该数据源提供了网页型或解析型地址，不能在 App 内直接播放。点击下方按钮后，将使用手机默认浏览器打开。</Text>
              <Pressable onPress={() => void openExternal()} style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}>
                <Text style={styles.externalText}>在浏览器打开</Text>
              </Pressable>
            </View>
          )}
          {playbackMessage ? <Text style={styles.playbackMessage}>{playbackMessage}</Text> : null}

          {playSources.length ? (
            <View style={styles.sourcePanel}>
              <Text style={styles.sourceTitle}>选择播放线路</Text>
              <Text style={styles.sourceHint}>切换时不会离开播放页；同名剧集会自动匹配。</Text>
              <View style={styles.sourceList}>
                {playSources.map((item, index) => {
                  const downloadedCount = item.episodes.filter((entry) => offlineUrls.has(entry.url)).length;
                  return (
                    <Pressable key={`${item.name}-${index}`} onPress={() => switchSource(index)} style={({ pressed }) => [styles.sourceChip, index === activeSourceIndex && styles.sourceChipActive, pressed && styles.pressed]}>
                      <Text style={[styles.sourceChipText, index === activeSourceIndex && styles.sourceChipTextActive]}>{item.name}{downloadedCount ? ` · ${downloadedCount} 已下载` : ""}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {activeSource?.episodes.length ? (
            <View style={styles.playlistPanel}>
              <View style={styles.episodeHeading}>
                <View>
                  <Text style={styles.playlistTitle}>播放列表</Text>
                  <Text style={styles.playlistMeta}>{activeSourceName || "当前线路"} · {activeSource.episodes.length} 集 · 当前第 {activeEpisodeIndex + 1} 集</Text>
                </View>
                <View style={styles.switchActions}>
                  <Pressable disabled={activeEpisodeIndex <= 0} onPress={() => playEpisodeAt(activeEpisodeIndex - 1)} style={({ pressed }) => [styles.switchButton, activeEpisodeIndex <= 0 && styles.switchDisabled, pressed && styles.pressed]}>
                    <Text style={styles.switchText}>上一集</Text>
                  </Pressable>
                  <Pressable disabled={activeEpisodeIndex >= activeSource.episodes.length - 1} onPress={() => playEpisodeAt(activeEpisodeIndex + 1)} style={({ pressed }) => [styles.switchButton, activeEpisodeIndex >= activeSource.episodes.length - 1 ? styles.switchDisabled : styles.switchPrimary, pressed && styles.pressed]}>
                    <Text style={[styles.switchText, activeEpisodeIndex < activeSource.episodes.length - 1 && styles.switchPrimaryText]}>下一集</Text>
                  </Pressable>
                </View>
              </View>
              <FlatList
                data={activeSource.episodes}
                key="playlist-grid"
                numColumns={4}
                scrollEnabled={false}
                keyExtractor={(item, index) => `${item.url}-${index}`}
                contentContainerStyle={styles.playlistList}
                columnWrapperStyle={activeSource.episodes.length ? styles.playlistRow : undefined}
                renderItem={({ item, index }) => {
                  const downloaded = offlineUrls.has(item.url);
                  const size = offlineSizes.get(item.url);
                  return (
                    <Pressable onPress={() => playEpisodeAt(index)} style={({ pressed }) => [styles.playlistItem, downloaded && styles.playlistItemDownloaded, index === activeEpisodeIndex && styles.playlistItemActive, pressed && styles.pressed]}>
                      <Text numberOfLines={1} style={[styles.playlistItemText, index === activeEpisodeIndex && styles.playlistItemTextActive]}>{item.name}</Text>
                      {downloaded ? <Text style={[styles.downloadedTag, index === activeEpisodeIndex && styles.downloadedTagActive]}>已下载 · {formatFileSize(size ?? 0)}</Text> : null}
                    </Pressable>
                  );
                }}
              />
            </View>
          ) : null}
        </ScrollView>
      </ScreenContainer>
      <GlobalBottomNavigation />
    </View>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0B1020" },
  scrollContent: { paddingBottom: 108 },
  header: { height: 66, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#283452" },
  back: { paddingVertical: 9, paddingRight: 14 },
  backLabel: { color: "#B8D8FA", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  headerInfo: { flex: 1, minWidth: 0 },
  title: { color: "#F4F6FA", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  episode: { color: "#9CA7BE", fontSize: 11, lineHeight: 16, marginTop: 1 },
  playerWrap: { paddingTop: 18 },
  videoStage: { position: "relative" },
  videoTouchArea: { width: "100%", aspectRatio: 16 / 9 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#050812" },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5, 8, 18, 0.82)" },
  loadingTitle: { color: "#F4F6FA", fontSize: 14, lineHeight: 20, fontWeight: "800", marginTop: 10 },
  loadingMeta: { color: "#B8C5D8", fontSize: 11, lineHeight: 17, marginTop: 4 },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 18, paddingTop: 11 },
  statusText: { color: "#8796B0", fontSize: 11, lineHeight: 17, flex: 1, flexShrink: 1 },
  offlineBadge: { color: "#A9E2BE", fontSize: 11, lineHeight: 17, fontWeight: "800", backgroundColor: "#1F523F", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  networkBadge: { color: "#B9C8DB", fontSize: 11, lineHeight: 17, fontWeight: "800", backgroundColor: "#27344B", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  rateTrigger: { height: 23, paddingHorizontal: 7, justifyContent: "center", borderRadius: 6, backgroundColor: "#20293A", borderWidth: 1, borderColor: "#3A4965" },
  rateTriggerOpen: { backgroundColor: "#314C70", borderColor: "#7FB2E8" },
  rateTriggerText: { color: "#DDE9F8", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  ratePicker: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginHorizontal: 18, marginTop: 9, padding: 10, borderRadius: 12, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2C3B58" },
  playerTools: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 18, paddingTop: 11 },
  playToggle: { height: 30, minWidth: 48, paddingHorizontal: 10, justifyContent: "center", alignItems: "center", borderRadius: 8, backgroundColor: "#F5B64B" },
  playToggleText: { color: "#151821", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  speedChip: { height: 30, minWidth: 38, paddingHorizontal: 6, justifyContent: "center", alignItems: "center", borderRadius: 8, backgroundColor: "#20293A", borderWidth: 1, borderColor: "#3A4965" },
  speedChipActive: { backgroundColor: "#314C70", borderColor: "#7FB2E8" },
  speedChipText: { color: "#B9C8DB", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  speedChipTextActive: { color: "#F5F8FF" },
  fullscreenHint: { color: "#71809A", fontSize: 10, lineHeight: 15, marginLeft: 1 },
  playbackMessage: { color: "#F4BF83", fontSize: 12, lineHeight: 18, marginHorizontal: 18, marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: "#312632" },
  sourcePanel: { marginHorizontal: 18, marginTop: 22 },
  sourceTitle: { color: "#F2F4F8", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  sourceHint: { color: "#8F9CAF", fontSize: 10, lineHeight: 15, marginTop: 1 },
  sourceList: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 11 },
  sourceChip: { minHeight: 37, paddingHorizontal: 13, justifyContent: "center", borderRadius: 10, backgroundColor: "#20293A", borderWidth: 1, borderColor: "#3A4965" },
  sourceChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  sourceChipText: { color: "#C9D5E5", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  sourceChipTextActive: { color: "#151821" },
  playlistPanel: { marginHorizontal: 18, marginTop: 24, padding: 14, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2C3B58" },
  episodeHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  playlistTitle: { color: "#F2F4F8", fontSize: 16, lineHeight: 23, fontWeight: "900" },
  playlistMeta: { color: "#8F9CAF", fontSize: 11, lineHeight: 16, marginTop: 2 },
  switchActions: { flexDirection: "row", gap: 7 },
  switchButton: { height: 30, paddingHorizontal: 9, borderRadius: 8, justifyContent: "center", borderWidth: 1, borderColor: "#40516D", backgroundColor: "#202B40" },
  switchPrimary: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  switchDisabled: { opacity: 0.38 },
  switchText: { color: "#C5D7EE", fontSize: 10, lineHeight: 14, fontWeight: "900" },
  switchPrimaryText: { color: "#141821" },
  playlistList: { paddingTop: 14 },
  playlistRow: { justifyContent: "space-between", marginBottom: 8 },
  playlistItem: { width: "23.5%", height: 45, paddingHorizontal: 5, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "#20293A" },
  playlistItemDownloaded: { backgroundColor: "#1A4036", borderWidth: 1, borderColor: "#317B66" },
  playlistItemActive: { backgroundColor: "#F5B64B" },
  playlistItemText: { color: "#D5DEEA", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  playlistItemTextActive: { color: "#151821" },
  downloadedTag: { color: "#9CE0BE", fontSize: 8, lineHeight: 11, fontWeight: "900", marginTop: 1 },
  downloadedTagActive: { color: "#514116" },
  unsupported: { padding: 28, margin: 18, borderRadius: 16, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#2F4163" },
  unsupportedTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 16, lineHeight: 23 },
  unsupportedText: { color: "#AEB9CB", fontSize: 13, lineHeight: 21, marginTop: 9 },
  externalButton: { alignSelf: "flex-start", marginTop: 18, height: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 11, backgroundColor: "#F5B64B" },
  externalText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  errorTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 18, lineHeight: 25 },
  backButton: { height: 42, paddingHorizontal: 16, justifyContent: "center", borderRadius: 11, backgroundColor: "#F5B64B", marginTop: 18 },
  backText: { color: "#11192B", fontWeight: "800", fontSize: 13 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
