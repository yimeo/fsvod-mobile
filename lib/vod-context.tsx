import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  buildCategoryTree,
  discoverMacCms,
  fetchVodPage,
  filterCategoriesWithContent,
  type MacCmsCategory,
  type MacCmsEndpoint,
  type MacCmsVod,
} from "@/lib/maccms";
import { getOfficialResourceSyncState, OFFICIAL_RESOURCE_CONFIG_URLS, syncOfficialResourceCatalog, type OfficialResourceSyncResult, type OfficialResourceSyncState } from "@/lib/official-resources";
import { clearEndpoint, getEndpoint, getSources, moveSource, removeSource, renameSource, replaceOfficialSources, replaceSource, saveEndpoint, updateSourceHealth, upsertSource, type SavedMacCmsSource } from "@/lib/vod-storage";
import { toChineseNetworkError } from "@/lib/network-error";

interface VodContextValue {
  endpoint: MacCmsEndpoint | null;
  sources: SavedMacCmsSource[];
  categories: MacCmsCategory[];
  isBooting: boolean;
  sourceError: string | null;
  configureSource: (address: string, displayName?: string) => Promise<MacCmsEndpoint>;
  switchSource: (id: string) => Promise<boolean>;
  deleteSource: (id: string) => Promise<void>;
  checkSource: (id: string) => Promise<void>;
  checkAllSources: () => Promise<void>;
  renameSource: (id: string, displayName: string) => Promise<void>;
  updateSource: (id: string, address: string, displayName: string) => Promise<void>;
  reorderSource: (id: string, direction: -1 | 1) => Promise<void>;
  refreshCategories: () => Promise<void>;
  officialResourceSync: OfficialResourceSyncState;
  syncOfficialResources: (force?: boolean) => Promise<OfficialResourceSyncResult>;
}

const VodContext = createContext<VodContextValue | null>(null);

async function visibleCategories(endpoint: MacCmsEndpoint, raw: unknown, items: MacCmsVod[]): Promise<MacCmsCategory[]> {
  return filterCategoriesWithContent(endpoint, buildCategoryTree([raw], items));
}

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
  const [officialResourceSync, setOfficialResourceSync] = useState<OfficialResourceSyncState>({ configUrl: null, configEndpoints: [...OFFICIAL_RESOURCE_CONFIG_URLS], lastCheckedAt: null, lastUpdatedAt: null, lastError: null, resourceCount: 0, resourceSignature: "" });

  const syncOfficialResources = useCallback(async (force = false): Promise<OfficialResourceSyncResult> => {
    const result = await syncOfficialResourceCatalog(force);
    setOfficialResourceSync(result.state);
    if (!result.success || result.skipped) return result;

    const nextSources = await replaceOfficialSources(result.resources.map((resource) => ({
      key: resource.key,
      endpoint: endpointFromOfficialAddress(resource.address),
      displayName: resource.name,
    })));
    const activeEndpoint = await getEndpoint();
    const activeStillExists = activeEndpoint && nextSources.some((source) => source.id === activeEndpoint.apiUrl);
    if (activeEndpoint && !activeStillExists) {
      const fallback = nextSources[0];
      if (fallback) {
        await saveEndpoint(fallback.endpoint);
        setEndpoint(fallback.endpoint);
        try {
          const page = await fetchVodPage(fallback.endpoint, { page: 1 });
          setCategories(await visibleCategories(fallback.endpoint, page.raw, page.items));
          setSourceError(null);
        } catch (error) {
          setSourceError(toChineseNetworkError(error, "更新后的官方数据源暂不可用，请稍后重试"));
        }
      } else {
        await clearEndpoint();
        setEndpoint(null);
        setCategories([]);
      }
    }
    setSources(nextSources);
    return result;
  }, []);

  const refreshCategories = useCallback(async () => {
    if (!endpoint) return;
    try {
      const page = await fetchVodPage(endpoint, { page: 1 });
      setCategories(await visibleCategories(endpoint, page.raw, page.items));
      setSourceError(null);
    } catch (error) {
      setSourceError(toChineseNetworkError(error, "数据源连接失败，请稍后重试"));
    }
  }, [endpoint]);

  const activateFirstAvailableSource = useCallback(async (candidates: SavedMacCmsSource[]) => {
    let lastError: string | null = null;
    for (const candidate of candidates) {
      const startedAt = Date.now();
      try {
        const page = await fetchVodPage(candidate.endpoint, { page: 1 });
        // The initial list response already contains the category tree. Avoid
        // probing every category here; Home will load its selected category
        // immediately after activation, which removes a large startup delay.
        const nextCategories = buildCategoryTree([page.raw], page.items);
        if (nextCategories.length === 0) throw new Error("该数据源没有可浏览的分类数据");
        await saveEndpoint(candidate.endpoint);
        setEndpoint(candidate.endpoint);
        setCategories(nextCategories);
        setSourceError(null);
        setSources(await updateSourceHealth(candidate.id, "healthy", null, Date.now() - startedAt));
        return true;
      } catch (error) {
        lastError = toChineseNetworkError(error, "数据源连接失败，请稍后重试");
        setSources(await updateSourceHealth(candidate.id, "unhealthy", lastError));
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
        void (async () => {
          const startedAt = Date.now();
          try {
            const page = await fetchVodPage(savedEndpoint, { page: 1 });
            setCategories(buildCategoryTree([page.raw], page.items));
            setSources(await updateSourceHealth(savedEndpoint.apiUrl, "healthy", null, Date.now() - startedAt));
          } catch (error) {
            setSourceError(toChineseNetworkError(error, "已保存数据源暂不可用，请稍后重试"));
            // Only refresh the official primary/backup catalog when the
            // currently selected source has failed. Normal app navigation
            // and restarts use the locally cached source list.
            await syncOfficialResources(true);
          } finally {
            setIsBooting(false);
          }
        })();
      } else {
        void (async () => {
          // On a first install, the first source returned by the official
          // api.json is the default. Verify it before exposing Home, and only
          // fall back to later sources if that first source is unavailable.
          const officialResult = await syncOfficialResources(true);
          const refreshedSources = await getSources();
          setSources(refreshedSources);
          const firstOfficial = officialResult.resources[0];
          const orderedCandidates = firstOfficial
            ? [
                ...refreshedSources.filter((source) => source.endpoint.apiUrl === firstOfficial.address),
                ...refreshedSources.filter((source) => source.endpoint.apiUrl !== firstOfficial.address),
              ]
            : refreshedSources;
          await activateFirstAvailableSource(orderedCandidates);
          setIsBooting(false);
        })();
      }
    };
    void bootstrap();
  }, [activateFirstAvailableSource, syncOfficialResources]);

  const configureSource = useCallback(async (address: string, displayName?: string) => {
    const catalog = await discoverMacCms(address);
    const nextCategories = await filterCategoriesWithContent(catalog.endpoint, catalog.categories);
    if (nextCategories.length === 0) throw new Error("该数据源没有可浏览的分类数据");
    await saveEndpoint(catalog.endpoint);
    setSources(await upsertSource(catalog.endpoint, "healthy", null, displayName));
    setEndpoint(catalog.endpoint);
    setCategories(nextCategories);
    setSourceError(null);
    return catalog.endpoint;
  }, []);

  const checkSource = useCallback(async (id: string) => {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    const startedAt = Date.now();
    try {
      const page = await fetchVodPage(source.endpoint, { page: 1 });
      const nextCategories = await visibleCategories(source.endpoint, page.raw, page.items);
      if (nextCategories.length === 0) throw new Error("该数据源没有可浏览的分类数据");
      setSources(await updateSourceHealth(id, "healthy", null, Date.now() - startedAt));
    } catch (error) {
      setSources(await updateSourceHealth(id, "unhealthy", toChineseNetworkError(error, "连接失败，请稍后重试"), null));
    }
  }, [sources]);

  const checkAllSources = useCallback(async () => {
    for (const source of sources) await checkSource(source.id);
  }, [checkSource, sources]);

  const switchSource = useCallback(async (id: string): Promise<boolean> => {
    // Read the latest persisted list because an official sync updates storage
    // before React receives the asynchronous setSources state update.
    const source = (await getSources()).find((item) => item.id === id);
    if (!source) return false;
    const startedAt = Date.now();
    try {
      const page = await fetchVodPage(source.endpoint, { page: 1 });
      const nextCategories = await visibleCategories(source.endpoint, page.raw, page.items);
      if (nextCategories.length === 0) throw new Error("该数据源没有可浏览的分类数据");
      await saveEndpoint(source.endpoint);
      setEndpoint(source.endpoint);
      setCategories(nextCategories);
      setSourceError(null);
      setSources(await updateSourceHealth(id, "healthy", null, Date.now() - startedAt));
      return true;
    } catch (error) {
      const message = toChineseNetworkError(error, "数据源连接失败，请稍后重试");
      setSourceError(message);
      setSources(await updateSourceHealth(id, "unhealthy", message));
      return false;
    }
  }, []);

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
      setCategories(await visibleCategories(fallback.endpoint, page.raw, page.items));
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
    const nextCategories = await filterCategoriesWithContent(catalog.endpoint, catalog.categories);
    if (nextCategories.length === 0) throw new Error("该数据源没有可浏览的分类数据");
    const wasActive = endpoint?.apiUrl === id;
    setSources(await replaceSource(id, catalog.endpoint, displayName));
    if (!wasActive) return;
    await saveEndpoint(catalog.endpoint);
    setEndpoint(catalog.endpoint);
    setCategories(nextCategories);
    setSourceError(null);
  }, [endpoint?.apiUrl]);

  const reorderSource = useCallback(async (id: string, direction: -1 | 1) => {
    setSources(await moveSource(id, direction));
  }, []);

  return (
    <VodContext.Provider value={{ endpoint, sources, categories, isBooting, sourceError, configureSource, switchSource, deleteSource, checkSource, checkAllSources, renameSource: renameSavedSource, updateSource: updateSavedSource, reorderSource, refreshCategories, officialResourceSync, syncOfficialResources }}>
      {children}
    </VodContext.Provider>
  );
}

export function useVodSource(): VodContextValue {
  const context = useContext(VodContext);
  if (!context) throw new Error("useVodSource 必须在 VodProvider 内使用");
  return context;
}
