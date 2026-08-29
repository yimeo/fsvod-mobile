import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  buildCategoryTree,
  discoverMacCms,
  fetchVodPage,
  probeMacCmsEndpoint,
  type MacCmsCategory,
  type MacCmsEndpoint,
} from "@/lib/maccms";
import { getOfficialResourceSyncState, OFFICIAL_RESOURCE_SYNC_INTERVAL_MS, syncOfficialResourceCatalog, type OfficialResourceSyncResult, type OfficialResourceSyncState } from "@/lib/official-resources";
import { clearEndpoint, getEndpoint, getSources, isSameSourceEndpoint, MAX_CUSTOM_SOURCES, moveSource, removeSource, renameSource, replaceSource, saveEndpoint, updateSourceHealth, upsertSource, type SavedMacCmsSource } from "@/lib/vod-storage";
import { toChineseNetworkError } from "@/lib/network-error";

interface VodContextValue {
  endpoint: MacCmsEndpoint | null;
  sources: SavedMacCmsSource[];
  categories: MacCmsCategory[];
  isBooting: boolean;
  sourceError: string | null;
  sourceRevision: number;
  preferredCategoryId: string;
  configureSource: (address: string, displayName?: string) => Promise<MacCmsEndpoint>;
  switchSource: (id: string) => Promise<boolean>;
  deleteSource: (id: string) => Promise<void>;
  checkSource: (id: string) => Promise<void>;
  renameSource: (id: string, displayName: string) => Promise<void>;
  updateSource: (id: string, address: string, displayName: string) => Promise<void>;
  reorderSource: (id: string, direction: -1 | 1) => Promise<void>;
  refreshCategories: () => Promise<void>;
  officialResourceSync: OfficialResourceSyncState;
  syncOfficialResources: (force?: boolean) => Promise<OfficialResourceSyncResult>;
}

const VodContext = createContext<VodContextValue | null>(null);

function endpointFromOfficialAddress(address: string): MacCmsEndpoint {
  const url = new URL(address);
  return { inputDomain: url.origin, apiUrl: url.toString(), detectedAt: new Date().toISOString() };
}

export function VodProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState<MacCmsEndpoint | null>(null);
  const [sources, setSources] = useState<SavedMacCmsSource[]>([]);
  const [categories, setCategories] = useState<MacCmsCategory[]>([]);
  const [isBooting, setIsBooting] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [preferredCategoryId, setPreferredCategoryId] = useState("");
  const [officialResourceSync, setOfficialResourceSync] = useState<OfficialResourceSyncState>({ configUrl: null, configEndpoints: ["https://api1.066821.xyz/api.json", "https://api2.066821.xyz/api.json"], lastCheckedAt: null, lastUpdatedAt: null, lastError: null, resourceCount: 0, resourceSignature: "" });

  const syncOfficialResources = useCallback(async (force = false): Promise<OfficialResourceSyncResult> => {
    const result = await syncOfficialResourceCatalog(force);
    setOfficialResourceSync(result.state);
    if (!result.success || result.skipped || !result.resources.length) return result;

    let nextSources = await getSources();
    const activeEndpoint = await getEndpoint();
    for (const resource of result.resources) {
      const existing = nextSources.find((source) => source.officialKey === resource.key) ?? nextSources.find((source) => source.endpoint.apiUrl === resource.address);
      const nextEndpoint = existing?.endpoint.apiUrl === resource.address ? existing.endpoint : endpointFromOfficialAddress(resource.address);
      const unchanged = existing?.sourceType === "official" && existing.officialKey === resource.key && existing.displayName === resource.name && existing.endpoint.apiUrl === nextEndpoint.apiUrl;
      if (unchanged) continue;

      if (existing?.officialKey === resource.key && existing.id !== nextEndpoint.apiUrl) {
        nextSources = await replaceSource(existing.id, nextEndpoint, resource.name);
        nextSources = await updateSourceHealth(nextEndpoint.apiUrl, "unknown");
      } else {
        nextSources = await upsertSource(nextEndpoint, existing?.health ?? "unknown", existing?.lastError ?? null, resource.name, { sourceType: "official", officialKey: resource.key });
      }

      if (activeEndpoint?.apiUrl === existing?.id && activeEndpoint?.apiUrl !== nextEndpoint.apiUrl) {
        await saveEndpoint(nextEndpoint);
        setEndpoint(nextEndpoint);
        try {
          const probe = await probeMacCmsEndpoint(nextEndpoint);
          const page = probe.page;
          setCategories(probe.categories);
          setPreferredCategoryId(probe.preferredTypeId);
          setSourceError(null);
          setSourceRevision((revision) => revision + 1);
          nextSources = await updateSourceHealth(nextEndpoint.apiUrl, "healthy", null, page.items.length);
        } catch (error) {
          const message = toChineseNetworkError(error, "更新后的官方数据源暂不可用，请稍后重试");
          setSourceError(message);
          nextSources = await updateSourceHealth(nextEndpoint.apiUrl, "unhealthy", message, null);
        }
      }
    }
    setSources(nextSources);
    return result;
  }, []);

  const refreshCategories = useCallback(async () => {
    if (!endpoint) return;
    try {
      const probe = await probeMacCmsEndpoint(endpoint);
      setCategories(probe.categories);
      setPreferredCategoryId(probe.preferredTypeId);
      setSourceError(null);
    } catch (error) {
      setSourceError(toChineseNetworkError(error, "数据源连接失败，请稍后重试"));
    }
  }, [endpoint]);

  const activateFirstAvailableSource = useCallback(async (candidates: SavedMacCmsSource[]) => {
    let lastError: string | null = null;
    for (const candidate of candidates) {
      try {
        const probe = await probeMacCmsEndpoint(candidate.endpoint);
        const page = probe.page;
        await saveEndpoint(candidate.endpoint);
        setEndpoint(candidate.endpoint);
        setCategories(probe.categories);
        setPreferredCategoryId(probe.preferredTypeId);
        setSourceError(null);
        setSources(await updateSourceHealth(candidate.id, "healthy", null, page.items.length));
        return true;
      } catch (error) {
        lastError = toChineseNetworkError(error, "数据源连接失败，请稍后重试");
        setSources(await updateSourceHealth(candidate.id, "unhealthy", lastError, null));
      }
    }
    if (lastError) setSourceError(`未找到可用数据源：${lastError}`);
    return false;
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const [savedEndpoint, savedSources, savedOfficialResourceSync] = await Promise.all([getEndpoint(), getSources(), getOfficialResourceSyncState()]);
      setSources(savedSources);
      setOfficialResourceSync(savedOfficialResourceSync);
      if (savedEndpoint) {
        setEndpoint(savedEndpoint);
        try {
          const probe = await probeMacCmsEndpoint(savedEndpoint);
          setCategories(probe.categories);
          setPreferredCategoryId(probe.preferredTypeId);
        } catch (error) {
          setSourceError(toChineseNetworkError(error, "已保存数据源暂不可用，请稍后重试"));
        }
        void syncOfficialResources();
      } else {
        await syncOfficialResources();
        const refreshedSources = await getSources();
        setSources(refreshedSources);
        await activateFirstAvailableSource(refreshedSources);
      }
      setIsBooting(false);
    };
    void bootstrap();
  }, [activateFirstAvailableSource, syncOfficialResources]);

  useEffect(() => {
    const interval = setInterval(() => { void syncOfficialResources(); }, OFFICIAL_RESOURCE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [syncOfficialResources]);

  const configureSource = useCallback(async (address: string, displayName?: string) => {
    const catalog = await discoverMacCms(address);
    const savedSources = await getSources();
    const duplicate = savedSources.find((source) => isSameSourceEndpoint(source.endpoint, catalog.endpoint));
    if (duplicate) throw new Error(`该数据源已存在：${duplicate.displayName}`);
    const customCount = savedSources.filter((source) => source.sourceType !== "official").length;
    if (customCount >= MAX_CUSTOM_SOURCES) throw new Error(`普通数据源最多添加 ${MAX_CUSTOM_SOURCES} 个；官方 API 同步源不占用此上限`);
    await saveEndpoint(catalog.endpoint);
    setSources(await upsertSource(catalog.endpoint, "healthy", null, displayName, undefined, catalog.initialPage.items.length));
    setEndpoint(catalog.endpoint);
    setCategories(catalog.categories);
    setPreferredCategoryId(catalog.initialPage.items[0]?.typeId || "");
    setSourceError(null);
    setSourceRevision((revision) => revision + 1);
    return catalog.endpoint;
  }, []);

  const checkSource = useCallback(async (id: string) => {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    try {
      const probe = await probeMacCmsEndpoint(source.endpoint);
      setSources(await updateSourceHealth(id, "healthy", null, probe.itemCount));
    } catch (error) {
      setSources(await updateSourceHealth(id, "unhealthy", toChineseNetworkError(error, "数据验证失败，请稍后重试"), null));
    }
  }, [sources]);

  const switchSource = useCallback(async (id: string): Promise<boolean> => {
    const source = sources.find((item) => item.id === id);
    if (!source) return false;
    try {
      const probe = await probeMacCmsEndpoint(source.endpoint);
      const page = probe.page;
      await saveEndpoint(source.endpoint);
      setEndpoint(source.endpoint);
      setCategories(probe.categories);
      setPreferredCategoryId(probe.preferredTypeId);
      setSourceError(null);
      setSourceRevision((revision) => revision + 1);
      setSources(await updateSourceHealth(id, "healthy", null, page.items.length));
      return true;
    } catch (error) {
      const message = toChineseNetworkError(error, "数据源连接失败，请稍后重试");
      setSourceError(message);
      setSources(await updateSourceHealth(id, "unhealthy", message, null));
      return false;
    }
  }, [sources]);

  const deleteSource = useCallback(async (id: string) => {
    const next = await removeSource(id);
    setSources(next);
    if (endpoint?.apiUrl !== id) return;
    const fallback = next[0];
    if (!fallback) {
      setEndpoint(null);
      setCategories([]);
      setPreferredCategoryId("");
      setSourceError(null);
      setSourceRevision((revision) => revision + 1);
      await clearEndpoint();
      return;
    }
    await saveEndpoint(fallback.endpoint);
    setEndpoint(fallback.endpoint);
    try {
      const probe = await probeMacCmsEndpoint(fallback.endpoint);
      setCategories(probe.categories);
      setPreferredCategoryId(probe.preferredTypeId);
      setSourceError(null);
      setSourceRevision((revision) => revision + 1);
    } catch (error) {
      setCategories([]);
      setSourceError(toChineseNetworkError(error, "备用数据源连接失败，请稍后重试"));
    }
  }, [endpoint?.apiUrl]);

  const renameSavedSource = useCallback(async (id: string, displayName: string) => {
    setSources(await renameSource(id, displayName));
  }, []);

  const updateSavedSource = useCallback(async (id: string, address: string, displayName: string) => {
    const catalog = await discoverMacCms(address);
    const savedSources = await getSources();
    const duplicate = savedSources.find((source) => source.id !== id && isSameSourceEndpoint(source.endpoint, catalog.endpoint));
    if (duplicate) throw new Error(`该数据源已存在：${duplicate.displayName}`);
    const wasActive = endpoint?.apiUrl === id;
    setSources(await replaceSource(id, catalog.endpoint, displayName, catalog.initialPage.items.length));
    if (!wasActive) return;
    await saveEndpoint(catalog.endpoint);
    setEndpoint(catalog.endpoint);
    setCategories(catalog.categories);
    setPreferredCategoryId(catalog.initialPage.items[0]?.typeId || "");
    setSourceError(null);
    setSourceRevision((revision) => revision + 1);
  }, [endpoint?.apiUrl]);

  const reorderSource = useCallback(async (id: string, direction: -1 | 1) => {
    setSources(await moveSource(id, direction));
  }, []);

  return (
    <VodContext.Provider value={{ endpoint, sources, categories, isBooting, sourceError, sourceRevision, preferredCategoryId, configureSource, switchSource, deleteSource, checkSource, renameSource: renameSavedSource, updateSource: updateSavedSource, reorderSource, refreshCategories, officialResourceSync, syncOfficialResources }}>
      {children}
    </VodContext.Provider>
  );
}

export function useVodSource(): VodContextValue {
  const context = useContext(VodContext);
  if (!context) throw new Error("useVodSource 必须在 VodProvider 内使用");
  return context;
}
