import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  buildCategoryTree,
  discoverMacCms,
  fetchVodPage,
  type MacCmsCategory,
  type MacCmsEndpoint,
} from "@/lib/maccms";
import { getOfficialResourceSyncState, OFFICIAL_RESOURCE_SYNC_INTERVAL_MS, syncOfficialResourceCatalog, type OfficialResourceSyncResult, type OfficialResourceSyncState } from "@/lib/official-resources";
import { clearEndpoint, getEndpoint, getSources, moveSource, removeSource, renameSource, replaceSource, saveEndpoint, updateSourceHealth, upsertSource, type SavedMacCmsSource } from "@/lib/vod-storage";

interface VodContextValue {
  endpoint: MacCmsEndpoint | null;
  sources: SavedMacCmsSource[];
  categories: MacCmsCategory[];
  isBooting: boolean;
  sourceError: string | null;
  configureSource: (address: string, displayName?: string) => Promise<MacCmsEndpoint>;
  switchSource: (id: string) => Promise<void>;
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
          const page = await fetchVodPage(nextEndpoint, { page: 1 });
          setCategories(buildCategoryTree([page.raw], page.items));
          setSourceError(null);
          nextSources = await updateSourceHealth(nextEndpoint.apiUrl, "healthy");
        } catch (error) {
          setSourceError(error instanceof Error ? error.message : "更新后的官方数据源暂不可用");
          nextSources = await updateSourceHealth(nextEndpoint.apiUrl, "unhealthy", error instanceof Error ? error.message : "连接失败");
        }
      }
    }
    setSources(nextSources);
    return result;
  }, []);

  const refreshCategories = useCallback(async () => {
    if (!endpoint) return;
    try {
      const page = await fetchVodPage(endpoint, { page: 1 });
      setCategories(buildCategoryTree([page.raw], page.items));
      setSourceError(null);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "数据源连接失败");
    }
  }, [endpoint]);

  useEffect(() => {
    const bootstrap = async () => {
      const [savedEndpoint, savedSources, savedOfficialResourceSync] = await Promise.all([getEndpoint(), getSources(), getOfficialResourceSyncState()]);
      setSources(savedSources);
      setEndpoint(savedEndpoint);
      setOfficialResourceSync(savedOfficialResourceSync);
      setIsBooting(false);
      void syncOfficialResources();
      if (!savedEndpoint) return;
      try {
        const page = await fetchVodPage(savedEndpoint, { page: 1 });
        setCategories(buildCategoryTree([page.raw], page.items));
      } catch (error) {
        setSourceError(error instanceof Error ? error.message : "已保存数据源暂不可用");
      }
    };
    void bootstrap();
  }, [syncOfficialResources]);

  useEffect(() => {
    const interval = setInterval(() => { void syncOfficialResources(); }, OFFICIAL_RESOURCE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [syncOfficialResources]);

  const configureSource = useCallback(async (address: string, displayName?: string) => {
    const catalog = await discoverMacCms(address);
    await saveEndpoint(catalog.endpoint);
    setSources(await upsertSource(catalog.endpoint, "healthy", null, displayName));
    setEndpoint(catalog.endpoint);
    setCategories(catalog.categories);
    setSourceError(null);
    return catalog.endpoint;
  }, []);

  const checkSource = useCallback(async (id: string) => {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    try {
      await fetchVodPage(source.endpoint, { page: 1 });
      setSources(await updateSourceHealth(id, "healthy"));
    } catch (error) {
      setSources(await updateSourceHealth(id, "unhealthy", error instanceof Error ? error.message : "连接失败"));
    }
  }, [sources]);

  const switchSource = useCallback(async (id: string) => {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    await saveEndpoint(source.endpoint);
    setEndpoint(source.endpoint);
    try {
      const page = await fetchVodPage(source.endpoint, { page: 1 });
      setCategories(buildCategoryTree([page.raw], page.items));
      setSourceError(null);
      setSources(await updateSourceHealth(id, "healthy"));
    } catch (error) {
      setCategories([]);
      setSourceError(error instanceof Error ? error.message : "数据源连接失败");
      setSources(await updateSourceHealth(id, "unhealthy", error instanceof Error ? error.message : "连接失败"));
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
      setSourceError(null);
      await clearEndpoint();
      return;
    }
    await saveEndpoint(fallback.endpoint);
    setEndpoint(fallback.endpoint);
    try {
      const page = await fetchVodPage(fallback.endpoint, { page: 1 });
      setCategories(buildCategoryTree([page.raw], page.items));
    } catch (error) {
      setCategories([]);
      setSourceError(error instanceof Error ? error.message : "备用数据源连接失败");
    }
  }, [endpoint?.apiUrl]);

  const renameSavedSource = useCallback(async (id: string, displayName: string) => {
    setSources(await renameSource(id, displayName));
  }, []);

  const updateSavedSource = useCallback(async (id: string, address: string, displayName: string) => {
    const catalog = await discoverMacCms(address);
    const wasActive = endpoint?.apiUrl === id;
    setSources(await replaceSource(id, catalog.endpoint, displayName));
    if (!wasActive) return;
    await saveEndpoint(catalog.endpoint);
    setEndpoint(catalog.endpoint);
    setCategories(catalog.categories);
    setSourceError(null);
  }, [endpoint?.apiUrl]);

  const reorderSource = useCallback(async (id: string, direction: -1 | 1) => {
    setSources(await moveSource(id, direction));
  }, []);

  return (
    <VodContext.Provider value={{ endpoint, sources, categories, isBooting, sourceError, configureSource, switchSource, deleteSource, checkSource, renameSource: renameSavedSource, updateSource: updateSavedSource, reorderSource, refreshCategories, officialResourceSync, syncOfficialResources }}>
      {children}
    </VodContext.Provider>
  );
}

export function useVodSource(): VodContextValue {
  const context = useContext(VodContext);
  if (!context) throw new Error("useVodSource 必须在 VodProvider 内使用");
  return context;
}
