import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  buildCategoryTree,
  discoverMacCms,
  fetchVodPage,
  type MacCmsCategory,
  type MacCmsEndpoint,
} from "@/lib/maccms";
import { getEndpoint, saveEndpoint } from "@/lib/vod-storage";

interface VodContextValue {
  endpoint: MacCmsEndpoint | null;
  categories: MacCmsCategory[];
  isBooting: boolean;
  sourceError: string | null;
  configureSource: (domain: string) => Promise<MacCmsEndpoint>;
  refreshCategories: () => Promise<void>;
}

const VodContext = createContext<VodContextValue | null>(null);

export function VodProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState<MacCmsEndpoint | null>(null);
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
      const savedEndpoint = await getEndpoint();
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

  const configureSource = useCallback(async (domain: string) => {
    const catalog = await discoverMacCms(domain);
    await saveEndpoint(catalog.endpoint);
    setEndpoint(catalog.endpoint);
    setCategories(catalog.categories);
    setSourceError(null);
    return catalog.endpoint;
  }, []);

  return (
    <VodContext.Provider value={{ endpoint, categories, isBooting, sourceError, configureSource, refreshCategories }}>
      {children}
    </VodContext.Provider>
  );
}

export function useVodSource(): VodContextValue {
  const context = useContext(VodContext);
  if (!context) throw new Error("useVodSource 必须在 VodProvider 内使用");
  return context;
}
