import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { Alert } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { formatStorageLimit, type DownloadQueueTask } from "@/lib/download-queue";
import { useDownloadQueue } from "@/lib/download-queue-context";
import { getOfflineDownload } from "@/lib/offline-downloads";

const LIMITS = [5, 20, 50, 100].map((gigabytes) => gigabytes * 1024 * 1024 * 1024);
const UNLIMITED = 0;

export default function DownloadsScreen() {
  const router = useRouter();
  const { tasks, settings, pauseTask, resumeTask, retry, stopTask, deleteTask, clearAllTasks, updateSettings } = useDownloadQueue();
  const actionableTasks = tasks;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const openDetail = (task: DownloadQueueTask) => {
    router.push({ pathname: "/vod/[id]", params: { id: task.vodId } } as never);
  };
  const playDownloaded = async (task: DownloadQueueTask) => {
    const offline = await getOfflineDownload(task.remoteUrl);
    if (!offline) {
      Alert.alert("本地文件不可用", "该剧集的离线文件不存在或已被清理，请重新下载后播放。");
      return;
    }
    const episode = { name: task.episodeName, url: task.remoteUrl };
    router.push({ pathname: "/player", params: { url: offline.localUri, episodeUrl: task.remoteUrl, vodId: task.vodId, title: task.vodName, episode: task.episodeName, source: task.sourceName, offline: "1", episodeIndex: "0", playlist: JSON.stringify([episode]), playSources: JSON.stringify([{ name: task.sourceName, episodes: [episode] }]) } } as never);
  };
  const clearQueue = () => {
    if (!tasks.length) return;
    Alert.alert("清空下载队列", "将停止正在下载的任务，并删除队列中所有剧集的本地离线文件。此操作无法撤销。", [
      { text: "取消", style: "cancel" },
      { text: "清空", style: "destructive", onPress: () => { void clearAllTasks(); } },
    ]);
  };

  return (
    <ScreenContainer containerClassName="bg-background">
      <FlatList
        data={actionableTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View>
          <Text style={styles.eyebrow}>OFFLINE DOWNLOADS</Text>
          <Text style={styles.heading}>下载中心</Text>
          <Text style={styles.lead}>管理已缓存剧集、下载条件与离线存储空间。</Text>
          <View style={styles.settingsCard}>
            <View style={styles.settingsHead}><View><Text style={styles.settingsTitle}>下载条件</Text><Text style={styles.settingsText}>仅 Wi‑Fi 自动下载</Text></View><Pressable onPress={() => settings && void updateSettings({ ...settings, wifiOnly: !settings.wifiOnly })} style={[styles.switchTrack, settings?.wifiOnly && styles.switchTrackActive]}><View style={[styles.switchKnob, settings?.wifiOnly && styles.switchKnobActive]} /></Pressable></View>
            <Text style={styles.settingsTitle}>下载线程</Text>
            <View style={styles.limitRow}>{([1, 2, 3] as const).map((count) => <Pressable key={count} onPress={() => settings && void updateSettings({ ...settings, concurrency: count })} style={({ pressed }) => [styles.limitChip, settings?.concurrency === count && styles.limitChipActive, pressed && styles.pressed]}><Text style={[styles.limitText, settings?.concurrency === count && styles.limitTextActive]}>{`线程${count}`}</Text></Pressable>)}</View>
            <Text style={[styles.settingsTitle, styles.storageTitle]}>离线存储上限</Text>
            <View style={styles.limitRow}>{[...LIMITS, UNLIMITED].map((limit) => <Pressable key={limit} onPress={() => settings && void updateSettings({ ...settings, storageLimitBytes: limit })} style={({ pressed }) => [styles.limitChip, settings?.storageLimitBytes === limit && styles.limitChipActive, pressed && styles.pressed]}><Text style={[styles.limitText, settings?.storageLimitBytes === limit && styles.limitTextActive]}>{formatStorageLimit(limit)}</Text></Pressable>)}</View>
          </View>
          <View style={styles.queueHead}><View><Text style={styles.sectionTitle}>下载队列</Text><Text style={styles.queueMeta}>{actionableTasks.length} 个任务 · {completedCount} 个已下载</Text></View><View style={styles.queueActions}><Text style={styles.threadBadge}>{`线程${settings?.concurrency ?? 2}`}</Text><Pressable disabled={!actionableTasks.length} onPress={clearQueue} style={({ pressed }) => [styles.clearButton, !actionableTasks.length && styles.disabled, pressed && styles.pressed]}><Text style={styles.clearButtonText}>清空</Text></Pressable></View></View>
        </View>}
        renderItem={({ item }) => <TaskCard task={item} onOpenDetail={() => openDetail(item)} onPlayDownloaded={() => void playDownloaded(item)} onPause={() => void pauseTask(item.id)} onResume={() => void resumeTask(item.id)} onRetry={() => void retry(item.id)} onStop={() => void stopTask(item.id)} onDelete={() => void deleteTask(item.id)} />}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>下载队列为空</Text><Text style={styles.emptyText}>在影片详情页的播放列表点击“↓ 下载”，即可将所选剧集加入离线队列。</Text></View>}
        ListFooterComponent={completedCount > 0 ? <Text style={styles.footer}>已下载剧集可在此直接离线播放；点影片标题可进入介绍页。</Text> : null}
      />
    </ScreenContainer>
  );
}

function TaskCard({ task, onOpenDetail, onPlayDownloaded, onPause, onResume, onRetry, onStop, onDelete }: { task: DownloadQueueTask; onOpenDetail: () => void; onPlayDownloaded: () => void; onPause: () => void; onResume: () => void; onRetry: () => void; onStop: () => void; onDelete: () => void }) {
  const progress = task.progress?.fraction !== null && task.progress?.fraction !== undefined ? Math.round(task.progress.fraction * 100) : null;
  const label = task.status === "completed" ? "已下载" : task.status === "downloading" ? (progress === null ? "下载中" : `${progress}%`) : task.status === "queued" ? "队列中" : task.status === "paused" ? "已暂停" : "下载失败";
  return <View style={[styles.taskCard, task.status === "completed" && styles.taskCardCompleted]}><View style={styles.taskTop}><View style={styles.taskInfo}><Pressable accessibilityLabel={`查看${task.vodName}介绍`} onPress={onOpenDetail} style={({ pressed }) => [styles.titleLink, pressed && styles.pressed]}><Text numberOfLines={1} style={styles.taskTitle}>{task.vodName}</Text></Pressable><Text numberOfLines={1} style={styles.taskMeta}>{task.sourceName} · {task.episodeName}</Text></View><Text style={[styles.status, task.status === "failed" && styles.statusFailed, task.status === "paused" && styles.statusPaused]}>{label}</Text></View>{task.status === "completed" ? <View style={styles.offlineNotice}><Text style={styles.offlineNoticeText}>本机已保存，可在无网络时直接播放</Text></View> : null}{task.status === "downloading" ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress ?? 4}%` }]} /></View> : null}{task.error ? <Text numberOfLines={2} style={styles.taskError}>{task.error}</Text> : null}<View style={styles.taskActions}>{task.status === "downloading" ? <><Action label="暂停" onPress={onPause} /><Action label="停止" onPress={onStop} /></> : null}{task.status === "queued" ? <><Action label="暂停" onPress={onPause} /><Action label="删除" onPress={onDelete} /></> : null}{task.status === "paused" ? <><Action label="继续" onPress={onResume} primary /><Action label="删除" onPress={onDelete} /></> : null}{task.status === "failed" ? <><Action label="重试" onPress={onRetry} primary /><Action label="删除" onPress={onDelete} /></> : null}{task.status === "completed" ? <><Action label="离线播放" onPress={onPlayDownloaded} primary /><Action label="删除" onPress={onDelete} /></> : null}</View></View>;
}

function Action({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.pressed]}><Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 34 },
  eyebrow: { color: "#F5B64B", letterSpacing: 1.6, fontSize: 10, lineHeight: 15, fontWeight: "800", paddingTop: 16 },
  heading: { color: "#F6F7FB", fontWeight: "900", fontSize: 28, lineHeight: 36, marginTop: 3 },
  lead: { color: "#94A1B4", fontSize: 12, lineHeight: 18, marginTop: 2, marginBottom: 15 },
  networkCard: { borderRadius: 14, padding: 14, borderWidth: 1 },
  networkReady: { backgroundColor: "#173C36", borderColor: "#326F5F" },
  networkWaiting: { backgroundColor: "#302A3A", borderColor: "#645778" },
  networkTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  networkText: { color: "#BBC8D8", fontSize: 12, lineHeight: 19, marginTop: 4 },
  settingsCard: { marginTop: 13, borderRadius: 14, padding: 14, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#283452" },
  settingsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  settingsTitle: { color: "#ECF0F6", fontSize: 13, lineHeight: 19, fontWeight: "800" },
  settingsText: { color: "#93A2B8", fontSize: 11, lineHeight: 16, marginTop: 1 },
  switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#39465B", padding: 3, justifyContent: "center" },
  switchTrackActive: { backgroundColor: "#D79C39" },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#F5F7FA" },
  switchKnobActive: { alignSelf: "flex-end" },
  limitRow: { flexDirection: "row", gap: 8, marginTop: 9 },
  limitChip: { minWidth: 54, height: 31, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: "#41506A", alignItems: "center", justifyContent: "center" },
  limitChipActive: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  limitText: { color: "#B6C3D6", fontSize: 12, fontWeight: "800" },
  limitTextActive: { color: "#11192B" },
  storageTitle: { marginTop: 15 },
  queueHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 22, marginBottom: 10 },
  queueActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  threadBadge: { color: "#F5CF86", backgroundColor: "#3A3020", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10, fontWeight: "900" },
  sectionTitle: { color: "#F6F7FB", fontWeight: "800", fontSize: 17, lineHeight: 24 },
  queueMeta: { color: "#8D9CB2", fontSize: 11, lineHeight: 16 },
  clearButton: { minWidth: 49, height: 29, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: "#72404A", justifyContent: "center", alignItems: "center" },
  clearButtonText: { color: "#E6A5AD", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  taskCard: { borderRadius: 14, padding: 13, backgroundColor: "#151E34", borderWidth: 1, borderColor: "#283452", marginBottom: 9 },
  taskCardCompleted: { backgroundColor: "#132B2A", borderColor: "#316A5C" },
  taskTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  taskInfo: { flex: 1, minWidth: 0 },
  titleLink: { alignSelf: "flex-start", maxWidth: "100%" },
  taskTitle: { color: "#EEF1F6", fontSize: 14, lineHeight: 20, fontWeight: "800" },
  taskMeta: { color: "#8E9CB1", fontSize: 11, lineHeight: 16, marginTop: 2 },
  status: { color: "#9FDABB", backgroundColor: "#1F523F", borderRadius: 7, fontSize: 10, lineHeight: 15, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 2 },
  statusPaused: { color: "#F0CF8A", backgroundColor: "#4A3A20" },
  statusFailed: { color: "#F5B5B5", backgroundColor: "#56313C" },
  offlineNotice: { marginTop: 9, alignSelf: "flex-start", borderRadius: 7, backgroundColor: "#1B4A3D", paddingHorizontal: 8, paddingVertical: 3 },
  offlineNoticeText: { color: "#AFE1C1", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: "#0D1424", marginTop: 11 },
  progressFill: { height: "100%", backgroundColor: "#F5B64B" },
  taskError: { color: "#F0B1B7", fontSize: 11, lineHeight: 17, marginTop: 8 },
  taskActions: { minHeight: 4, flexDirection: "row", gap: 8, marginTop: 11 },
  action: { minWidth: 55, height: 30, paddingHorizontal: 10, borderWidth: 1, borderColor: "#455772", borderRadius: 8, alignItems: "center", justifyContent: "center" },
  actionPrimary: { backgroundColor: "#F5B64B", borderColor: "#F5B64B" },
  actionText: { color: "#BAD3F0", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  actionTextPrimary: { color: "#11192B" },
  empty: { alignItems: "center", paddingVertical: 45, paddingHorizontal: 28, borderRadius: 14, backgroundColor: "#111A2E" },
  emptyTitle: { color: "#EAF0F8", fontSize: 16, lineHeight: 23, fontWeight: "800" },
  emptyText: { color: "#98A6BA", fontSize: 12, lineHeight: 19, textAlign: "center", marginTop: 6 },
  footer: { color: "#8F9CB2", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 8 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
