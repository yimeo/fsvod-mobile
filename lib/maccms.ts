import { toChineseNetworkError } from "./network-error";

export interface MacCmsEndpoint {
  inputDomain: string;
  apiUrl: string;
  detectedAt: string;
}

export interface MacCmsCategory {
  id: string;
  name: string;
  parentId: string | null;
  children: MacCmsCategory[];
}

export interface MacCmsVod {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  parentTypeId: string | null;
  remarks: string;
  year: string;
  area: string;
  language: string;
  thumbnailUrl: string | null;
  posterUrl: string | null;
  updateTime: string;
  hotScore: number;
}

export interface MacCmsEpisode {
  name: string;
  url: string;
}

export interface MacCmsPlaySource {
  name: string;
  episodes: MacCmsEpisode[];
}

export interface MacCmsVodDetail extends MacCmsVod {
  content: string;
  actor: string;
  director: string;
  sources: MacCmsPlaySource[];
}

export interface MacCmsPage {
  items: MacCmsVod[];
  page: number;
  pageCount: number;
  total: number;
  raw: unknown;
}

export interface MacCmsCatalog {
  endpoint: MacCmsEndpoint;
  categories: MacCmsCategory[];
  initialPage: MacCmsPage;
}

export interface MacCmsProbeResult {
  page: MacCmsPage;
  categories: MacCmsCategory[];
  itemCount: number;
  preferredTypeId: string;
}

type RecordValue = Record<string, unknown>;

const API_SUFFIXES = [
  "/api.php/provide/vod/",
  "/index.php/api.php/provide/vod/",
  "/provide/vod/",
];

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: unknown): string {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(...values: unknown[]): unknown {
  return values.find((value) => Boolean(text(value)));
}

export function normalizeDomain(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("请输入数据源域名");
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
}

function buildCandidateUrls(input: string): string[] {
  const normalized = normalizeDomain(input);
  const url = new URL(normalized);
  const direct = url.pathname.includes("provide/vod")
    ? `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`
    : "";
  const candidates = direct ? [direct] : API_SUFFIXES.map((suffix) => `${url.origin}${suffix}`);
  return [...new Set(candidates)];
}

function addQuery(apiUrl: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(apiUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function getJson(url: string): Promise<RecordValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, text/plain, */*" },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed: unknown = JSON.parse(body.replace(/^\uFEFF/, ""));
    if (!isRecord(parsed)) throw new Error("响应不是有效 JSON 对象");
    return parsed;
  } catch (error) {
    throw new Error(toChineseNetworkError(error, "数据源请求失败，请稍后重试"));
  } finally {
    clearTimeout(timeout);
  }
}

function resolveUrl(value: unknown, apiUrl: string): string | null {
  const source = text(value).replace(/^['"\s]+|['"\s]+$/g, "");
  if (!source) return null;
  const api = new URL(apiUrl);
  if (/^https?:\/\//i.test(source)) {
    try {
      const result = new URL(source);
      if (api.protocol === "https:" && result.protocol === "http:" && result.host === api.host) result.protocol = "https:";
      return result.toString();
    } catch {
      return null;
    }
  }
  if (source.startsWith("//")) return `${api.protocol}${source}`;
  try {
    const normalizedPath = source.replace(/^\.\//, "");
    return new URL(normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`, api.origin).toString();
  } catch {
    return null;
  }
}

function mapVod(value: unknown, apiUrl: string): MacCmsVod | null {
  if (!isRecord(value)) return null;
  const id = text(value.vod_id ?? value.id);
  const name = text(value.vod_name ?? value.name);
  if (!id || !name) return null;
  const parentValue = text(value.type_id_1 ?? value.type_pid ?? value.parent_id);
  return {
    id,
    name,
    typeId: text(value.type_id ?? value.tid),
    typeName: text(value.type_name ?? value.type),
    parentTypeId: parentValue && parentValue !== "0" ? parentValue : null,
    remarks: text(value.vod_remarks ?? value.vod_serial ?? value.note),
    year: text(value.vod_year ?? value.year),
    area: text(value.vod_area ?? value.area),
    language: text(value.vod_lang ?? value.lang),
    thumbnailUrl: resolveUrl(firstNonEmpty(value.vod_pic_thumb, value.vod_pic_slide, value.vod_pic, value.pic_thumb, value.pic), apiUrl),
    posterUrl: resolveUrl(firstNonEmpty(value.vod_pic, value.vod_pic_slide, value.vod_pic_url, value.vod_pic_thumb, value.pic, value.pic_url, value.cover), apiUrl),
    updateTime: text(value.vod_time ?? value.last),
    hotScore: Math.max(numeric(value.vod_hits), numeric(value.vod_hits_month), numeric(value.vod_hits_week), numeric(value.vod_hits_day), numeric(value.hits)),
  };
}

export function parseMacCmsPage(payload: unknown, apiUrl: string): MacCmsPage {
  if (!isRecord(payload)) throw new Error("MACCMS 响应格式无效");
  const list = Array.isArray(payload.list) ? payload.list : [];
  const items = list.map((item) => mapVod(item, apiUrl)).filter((item): item is MacCmsVod => Boolean(item));
  if (numeric(payload.code, 1) !== 1 && items.length === 0) {
    throw new Error(text(payload.msg) || "数据源未返回可用影视数据");
  }
  return {
    items,
    page: numeric(payload.page, 1),
    pageCount: Math.max(1, numeric(payload.pagecount, 1)),
    total: numeric(payload.total, items.length),
    raw: payload,
  };
}

function categoryFromRecord(value: unknown): Omit<MacCmsCategory, "children"> | null {
  if (!isRecord(value)) return null;
  const id = text(value.type_id ?? value.id ?? value.tid);
  const name = text(value.type_name ?? value.name ?? value.type);
  if (!id || !name) return null;
  const parent = text(value.type_pid ?? value.parent_id ?? value.pid ?? value.type_id_1);
  return { id, name, parentId: parent && parent !== "0" ? parent : null };
}

function compareCategoryIds(left: MacCmsCategory, right: MacCmsCategory): number {
  const leftNumeric = Number(left.id);
  const rightNumeric = Number(right.id);
  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric) && leftNumeric !== rightNumeric) {
    return leftNumeric - rightNumeric;
  }
  return left.id.localeCompare(right.id, "zh-CN", { numeric: true });
}

function collectCategoryRecords(value: unknown): Omit<MacCmsCategory, "children">[] {
  if (Array.isArray(value)) return value.flatMap(collectCategoryRecords);
  if (!isRecord(value)) return [];
  const own = categoryFromRecord(value);
  if (own) return [own];
  return Object.values(value).flatMap(collectCategoryRecords);
}

export function buildCategoryTree(payloads: unknown[], fallbackItems: MacCmsVod[]): MacCmsCategory[] {
  const sources = payloads.flatMap((payload) => {
    if (!isRecord(payload)) return [];
    return [payload.class, payload.type, payload.types, payload.list].flatMap(collectCategoryRecords);
  });
  const inferred = fallbackItems
    .filter((item) => item.typeId && item.typeName)
    .map((item) => ({ id: item.typeId, name: item.typeName, parentId: item.parentTypeId }));
  const byId = new Map<string, Omit<MacCmsCategory, "children">>();
  [...sources, ...inferred].forEach((category) => {
    const existing = byId.get(category.id);
    byId.set(category.id, {
      id: category.id,
      name: category.name || existing?.name || `分类 ${category.id}`,
      parentId: category.parentId ?? existing?.parentId ?? null,
    });
  });
  const nodes = new Map<string, MacCmsCategory>();
  byId.forEach((category) => nodes.set(category.id, { ...category, children: [] }));
  const roots: MacCmsCategory[] = [];
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  });
  const sortCategories = (items: MacCmsCategory[]) => {
    items.sort(compareCategoryIds);
    items.forEach((item) => sortCategories(item.children));
  };
  sortCategories(roots);
  return roots;
}

function categoryContainsType(category: MacCmsCategory, typeId: string): boolean {
  return category.id === typeId || category.children.some((child) => categoryContainsType(child, typeId));
}

function promotePlayableCategory(categories: MacCmsCategory[], typeId: string): MacCmsCategory[] {
  const playableIndex = categories.findIndex((category) => categoryContainsType(category, typeId));
  if (playableIndex <= 0) return categories;
  return [categories[playableIndex], ...categories.slice(0, playableIndex), ...categories.slice(playableIndex + 1)];
}

export async function probeMacCmsEndpoint(endpoint: MacCmsEndpoint): Promise<MacCmsProbeResult> {
  const payload = await getJson(addQuery(endpoint.apiUrl, { ac: "list", pg: 1, pagesize: 20 }));
  const initialPage = parseMacCmsPage(payload, endpoint.apiUrl);
  if (initialPage.items.length === 0) {
    throw new Error("接口可以访问，但没有返回有效影视数据");
  }
  const playableTypeId = initialPage.items.find((item) => Boolean(item.typeId))?.typeId;
  if (!playableTypeId) throw new Error("接口返回的影视数据缺少可浏览分类");

  // Validate the same category request the home screen will issue, not only the unfiltered API response.
  const displayPage = await fetchVodPage(endpoint, { page: 1, pageSize: 20, typeId: playableTypeId, sort: "latest" });
  if (displayPage.items.length === 0) {
    throw new Error("接口有响应，但应用实际分类列表无法读取");
  }
  const categories = promotePlayableCategory(buildCategoryTree([payload], initialPage.items), playableTypeId);
  return { page: displayPage, categories, itemCount: displayPage.items.length, preferredTypeId: playableTypeId };
}

export async function discoverMacCms(inputDomain: string): Promise<MacCmsCatalog> {
  const candidates = buildCandidateUrls(inputDomain);
  const errors: string[] = [];
  for (const apiUrl of candidates) {
    try {
      const endpoint = { inputDomain: inputDomain.trim(), apiUrl, detectedAt: new Date().toISOString() };
      const probe = await probeMacCmsEndpoint(endpoint);
      return { endpoint, categories: probe.categories, initialPage: probe.page };
    } catch (error) {
      errors.push(`${apiUrl}: ${error instanceof Error ? error.message : "连接失败"}`);
    }
  }
  throw new Error(`未识别到兼容且有数据的 MACCMS API。${errors.length ? "请确认接口返回了有效影视列表。" : ""}`);
}

export async function fetchVodPage(
  endpoint: MacCmsEndpoint,
  options: { page?: number; pageSize?: number; typeId?: string; keyword?: string; area?: string; year?: string; sort?: "latest" | "hot" },
): Promise<MacCmsPage> {
  const payload = await getJson(
    addQuery(endpoint.apiUrl, {
      ac: "list",
      pg: options.page ?? 1,
      t: options.typeId,
      wd: options.keyword,
      area: options.area,
      year: options.year,
      by: options.sort === "hot" ? "hits" : "time",
      pagesize: options.pageSize ?? 20,
    }),
  );
  return parseMacCmsPage(payload, endpoint.apiUrl);
}

export function sortVodItems(items: MacCmsVod[], sort: "latest" | "hot"): MacCmsVod[] {
  return [...items].sort((left, right) => {
    if (sort === "hot") {
      const scoreDifference = right.hotScore - left.hotScore;
      if (scoreDifference !== 0) return scoreDifference;
    }
    return right.updateTime.localeCompare(left.updateTime);
  });
}

export function mergeMacCmsPages(pages: MacCmsPage[]): MacCmsPage {
  if (pages.length === 0) return { items: [], page: 1, pageCount: 1, total: 0, raw: [] };
  const uniqueItems = new Map<string, MacCmsVod>();
  pages.forEach((page) => page.items.forEach((item) => uniqueItems.set(item.id, item)));
  return {
    items: sortVodItems([...uniqueItems.values()], "latest"),
    page: pages[0].page,
    pageCount: Math.max(...pages.map((page) => page.pageCount)),
    total: pages.reduce((sum, page) => sum + page.total, 0),
    raw: pages.map((page) => page.raw),
  };
}

function splitEpisodes(value: string): MacCmsEpisode[] {
  return value
    .split("#")
    .map((part, index) => {
      const [name, ...address] = part.split("$");
      const url = address.join("$").trim();
      return { name: name?.trim() || `第 ${index + 1} 集`, url };
    })
    .filter((episode) => Boolean(episode.url));
}

export function parsePlaySources(from: unknown, urls: unknown): MacCmsPlaySource[] {
  const sourceNames = text(from).split("$$$").map((value) => value.trim()).filter(Boolean);
  const sourceUrls = text(urls).split("$$$");
  return sourceUrls
    .map((value, index) => ({
      name: sourceNames[index] || `线路 ${index + 1}`,
      episodes: splitEpisodes(value),
    }))
    .filter((source) => source.episodes.length > 0);
}

export function parseVodDetail(payload: unknown, apiUrl: string): MacCmsVodDetail {
  if (!isRecord(payload) || !Array.isArray(payload.list) || !payload.list[0]) {
    throw new Error("未取得影片详情");
  }
  const raw = payload.list[0];
  const base = mapVod(raw, apiUrl);
  if (!base || !isRecord(raw)) throw new Error("影片详情格式无效");
  return {
    ...base,
    content: cleanText(raw.vod_content ?? raw.des),
    actor: cleanText(raw.vod_actor ?? raw.actor),
    director: cleanText(raw.vod_director ?? raw.director),
    sources: parsePlaySources(raw.vod_play_from, raw.vod_play_url),
  };
}

export async function fetchVodDetail(endpoint: MacCmsEndpoint, id: string): Promise<MacCmsVodDetail> {
  const payload = await getJson(addQuery(endpoint.apiUrl, { ac: "detail", ids: id }));
  return parseVodDetail(payload, endpoint.apiUrl);
}

export function isDirectVideoUrl(url: string): boolean {
  return /\.(m3u8|mp4|m4v|webm)(\?.*)?$/i.test(url.trim());
}
