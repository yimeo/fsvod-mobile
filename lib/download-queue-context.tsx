import * as Network from "expo-network";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { downloadEpisodeOffline, getOfflineSummary, isOfflineDownloadSupported, pauseOfflineDownload, removeOfflineDownloadByUrl, stopOfflineDownload, type OfflineDownloadRequest } from "@/lib/offline-downloads";
import { getDownloadSettings, getQueueTasks, nextRunnableTask, retryTask, saveDownloadSettings, saveQueueTasks, type DownloadQueueTask, type DownloadSettings, updateQueueTask, upsertQueueTasks } from "@/lib/download-queue";

interface DownloadQueueContextValue {
  tasks: DownloadQueueTask[];
  settings: DownloadSettings | null;
  isWifi: boolean;
  isActive: boolean;
  enqueue: (requests: OfflineDownloadRequest[]) => Promise<number>;
  pauseTask: (id: string) => Promise<void>;
  resumeTask: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  stopTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  updateSettings: (next: DownloadSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

const DownloadQueueContext = createContext<DownloadQueueContextValue | null>(null);

export function DownloadQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadQueueTask[]>([]);
  const [settings, setSettings] = useState<DownloadSettings | null>(null);
  const [isWifi, setIsWifi] = useState(false);
  const [isActive, setIsActive] = useState(AppState.currentState === "active");
  const runningRef = useRef(false);
  const tasksRef = useRef<DownloadQueueTask[]>([]);
  const settingsRef = useRef<DownloadSettings | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const commitTasks = useCallback(async (next: DownloadQueueTask[]) => {
    tasksRef.current = next;
    setTasks(next);
    await saveQueueTasks(next);
  }, []);

  const refresh = useCallback(async () => {
    const [savedTasks, savedSettings, networkState] = await Promise.all([getQueueTasks(), getDownloadSettings(), Network.getNetworkStateAsync()]);
    const resumedTasks = savedTasks.map((task) => task.status === "downloading" ? { ...task, status: "queued" as const, error: null } : task);
    if (resumedTasks.some((task, index) => task.status !== savedTasks[index].status)) await saveQueueTasks(resumedTasks);
    tasksRef.current = resumedTasks;
    settingsRef.current = savedSettings;
    setTasks(resumedTasks);
    setSettings(savedSettings);
    setIsWifi(networkState.type === Network.NetworkStateType.WIFI && networkState.isInternetReachable !== false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const appSubscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      setIsActive(nextState === "active");
    });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      setIsWifi(state.type === Network.NetworkStateType.WIFI && state.isInternetReachable !== false);
    });
    return () => { appSubscription.remove(); networkSubscription.remove(); };
  }, []);

  const runNext = useCallback(async () => {
    if (runningRef.current || !settingsRef.current || appStateRef.current !== "active") return;
    if (Platform.OS === "web" || (settingsRef.current.wifiOnly && !isWifi)) return;
    const task = nextRunnableTask(tasksRef.current);
    if (!task) return;
    runningRef.current = true;
    await commitTasks(updateQueueTask(tasksRef.current, task.id, { status: "downloading", error: null }));
    try {
      const summary = await getOfflineSummary();
      if (settingsRef.current.storageLimitBytes > 0 && summary.sizeBytes >= settingsRef.current.storageLimitBytes) throw new Error("已达到离线存储上限，请清理缓存或提高上限");
      await downloadEpisodeOffline(task, (progress) => {
        const next = updateQueueTask(tasksRef.current, task.id, { progress });
        tasksRef.current = next;
        setTasks(next);
        void saveQueueTasks(next);
      });
      await commitTasks(updateQueueTask(tasksRef.current, task.id, { status: "completed", progress: { downloadedBytes: 1, totalBytes: 1, fraction: 1 }, error: null }));
    } catch (error) {
      const current = tasksRef.current.find((entry) => entry.id === task.id);
      if (!current || current.status === "paused") return;
      await commitTasks(updateQueueTask(tasksRef.current, task.id, { status: "failed", error: error instanceof Error ? error.message : "下载失败，请重试" }));
    } finally {
      runningRef.current = false;
      setTimeout(() => { void runNext(); }, 0);
    }
  }, [commitTasks, isWifi]);

  useEffect(() => { void runNext(); }, [isWifi, isActive, tasks, settings, runNext]);

  const enqueue = useCallback(async (requests: OfflineDownloadRequest[]) => {
    const supported = requests.filter((request) => isOfflineDownloadSupported(request.remoteUrl));
    const existingUrls = new Set(tasksRef.current.map((task) => task.remoteUrl));
    const count = supported.filter((request) => !existingUrls.has(request.remoteUrl)).length;
    if (count === 0) return 0;
    await commitTasks(upsertQueueTasks(tasksRef.current, supported));
    return count;
  }, [commitTasks]);

  const pauseTask = useCallback(async (id: string) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task || (task.status !== "queued" && task.status !== "downloading")) return;
    if (task.status === "downloading") await pauseOfflineDownload(task.remoteUrl);
    await commitTasks(updateQueueTask(tasksRef.current, id, { status: "paused" }));
  }, [commitTasks]);

  const resumeTask = useCallback(async (id: string) => {
    await commitTasks(updateQueueTask(tasksRef.current, id, { status: "queued", error: null }));
  }, [commitTasks]);

  const retry = useCallback(async (id: string) => { await commitTasks(retryTask(tasksRef.current, id)); }, [commitTasks]);
  const stopTask = useCallback(async (id: string) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task) return;
    if (task.status === "downloading") await stopOfflineDownload(task.remoteUrl);
    await commitTasks(tasksRef.current.filter((entry) => entry.id !== id));
  }, [commitTasks]);
  const deleteTask = useCallback(async (id: string) => {
    const task = tasksRef.current.find((item) => item.id === id);
    if (!task) return;
    if (task.status === "downloading") await stopOfflineDownload(task.remoteUrl);
    await removeOfflineDownloadByUrl(task.remoteUrl);
    await commitTasks(tasksRef.current.filter((entry) => entry.id !== id));
  }, [commitTasks]);
  const updateSettings = useCallback(async (next: DownloadSettings) => {
    settingsRef.current = next;
    setSettings(next);
    await saveDownloadSettings(next);
  }, []);

  return <DownloadQueueContext.Provider value={{ tasks, settings, isWifi, isActive, enqueue, pauseTask, resumeTask, retry, stopTask, deleteTask, updateSettings, refresh }}>{children}</DownloadQueueContext.Provider>;
}

export function useDownloadQueue(): DownloadQueueContextValue {
  const context = useContext(DownloadQueueContext);
  if (!context) throw new Error("useDownloadQueue 必须在 DownloadQueueProvider 内使用");
  return context;
}
