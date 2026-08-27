import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  buildCategoryTree,
  discoverMacCms,
  fetchVodPage,
  type MacCmsCategory,
  type MacCmsEndpoint,
} from "@/lib/maccms";
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
}

const VodContext = createContext<VodContextValue | null>(null);

export function VodProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState<MacCmsEndpoint | null>(null);
  const [sources, setSources] = useState<SavedMacCmsSource[]>([]);
  const [categories, setCategories] = useState<MacCmsCategory[]>([]);
  const [isBooting, setIsBooting] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);

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
      const [savedEndpoint, savedSources] = await Promise.all([getEndpoint(), getSources()]);
      setSources(savedSources);
      setEndpoint(savedEndpoint);
      setIsBooting(false);
      if (!savedEndpoint) return;
      try {
        const page = await fetchVodPage(savedEndpoint, { page: 1 });
        setCategories(buildCategoryTree([page.raw], page.items));
      } catch (error) {
        setSourceError(error instanceof Error ? error.message : "已保存数据源暂不可用");
      }
    };
    void bootstrap();
  }, []);

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
    <VodContext.Provider value={{ endpoint, sources, categories, isBooting, sourceError, configureSource, switchSource, deleteSource, checkSource, renameSource: renameSavedSource, updateSource: updateSavedSource, reorderSource, refreshCategories }}>
      {children}
    </VodContext.Provider>
  );
}

export function useVodSource(): VodContextValue {
  const context = useContext(VodContext);
  if (!context) throw new Error("useVodSource 必须在 VodProvider 内使用");
  return context;
}
