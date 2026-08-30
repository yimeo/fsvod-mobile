import AsyncStorage from "@react-native-async-storage/async-storage";

import { toChineseNetworkError } from "./network-error";

export const OFFICIAL_RESOURCE_CONFIG_URLS = [
  "https://api.075700.xyz/api.json",
  "http://api.07571800.xyz/api.json",
] as const;

export const OFFICIAL_RESOURCE_SYNC_INTERVAL_MS = 30 * 60 * 1000;

const OFFICIAL_RESOURCE_SYNC_STATE_KEY = "fsvod:official-resource-sync";
const DEFAULT_OFFICIAL_CONFIG_ENDPOINTS = OFFICIAL_RESOURCE_CONFIG_URLS;
const NAME_KEYS = ["name", "title", "displayName", "siteName", "sourceName", "label"];
const ADDRESS_KEYS = ["url", "api", "apiUrl", "address", "endpoint", "sourceUrl", "vodApi"];

export interface OfficialVodSource {
  key: string;
  name: string;
  address: string;
}

export interface OfficialResourceSyncState {
  configUrl: string | null;
  configEndpoints: string[];
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
  resourceCount: number;
  resourceSignature: string;
}

export interface OfficialResourceCatalog {
  configUrl: string;
  configEndpoints: string[];
  resources: OfficialVodSource[];
}

export interface OfficialResourceSyncResult {
  state: OfficialResourceSyncState;
  resources: OfficialVodSource[];
  skipped: boolean;
  success: boolean;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
export type OfficialConfigRequester = (url: string) => Promise<unknown>;

const DEFAULT_SYNC_STATE: OfficialResourceSyncState = {
  configUrl: null,
  configEndpoints: [...DEFAULT_OFFICIAL_CONFIG_ENDPOINTS],
  lastCheckedAt: null,
  lastUpdatedAt: null,
  lastError: null,
  resourceCount: 0,
  resourceSignature: "",
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isConfigUrl(value: string): boolean {
  return /\/api\.json(?:[?#]|$)/i.test(value);
}

function isVodApiUrl(value: string): boolean {
  return /\/(?:api\.php\/)?provide\/vod(?:[/?#]|$)/i.test(value) || /\/api\.php(?:[?#]|$)/i.test(value);
}

function compactKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "official-source";
}

function findText(record: JsonObject, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function collectOfficialData(value: unknown, nameHint: string, configUrls: Set<string>, sources: OfficialVodSource[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOfficialData(item, nameHint, configUrls, sources));
    return;
  }
  if (!isObject(value)) return;

  const explicitName = findText(value, NAME_KEYS);
  const sourceName = explicitName || nameHint;
  const candidateAddresses = ADDRESS_KEYS.map((key) => text(value[key]))
    .concat(Object.values(value).flatMap((item) => typeof item === "string" ? [item.trim()] : []));

  candidateAddresses.forEach((candidate) => {
    const address = normalizeUrl(candidate);
    if (!address) return;
    if (isConfigUrl(address)) {
      configUrls.add(address);
      return;
    }
    if (!isVodApiUrl(address)) return;
    const name = sourceName || new URL(address).hostname;
    const key = compactKey(name);
    if (!sources.some((source) => source.key === key || source.address === address)) sources.push({ key, name, address });
  });

  Object.entries(value).forEach(([key, item]) => {
    if (typeof item === "object" && item !== null) collectOfficialData(item, key, configUrls, sources);
    if (typeof item === "string") {
      const address = normalizeUrl(item);
      if (!address) return;
      if (isConfigUrl(address)) configUrls.add(address);
      if (isVodApiUrl(address) && !sources.some((source) => source.address === address)) {
        sources.push({ key: compactKey(key), name: key, address });
      }
    }
  });
}

export function parseOfficialResourceConfig(payload: unknown): { primaryApi: string | null; backupApi: string | null; configUrls: string[]; resources: OfficialVodSource[] } {
  const configUrls = new Set<string>();
  const primaryApi = isObject(payload) ? normalizeUrl(text(payload.primaryApi)) : null;
  const backupApi = isObject(payload) ? normalizeUrl(text(payload.backupApi)) : null;
  if (primaryApi && isConfigUrl(primaryApi)) configUrls.add(primaryApi);
  if (backupApi && isConfigUrl(backupApi)) configUrls.add(backupApi);
  const resources: OfficialVodSource[] = [];
  collectOfficialData(payload, "", configUrls, resources);
  return { primaryApi, backupApi, configUrls: [...configUrls], resources };
}

async function requestOfficialConfig(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json, text/plain, */*" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    return JSON.parse(body.replace(/^\uFEFF/, "")) as unknown;
  } catch (error) {
    throw new Error(toChineseNetworkError(error, "官方资源配置请求失败，请稍后重试"));
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadOfficialResourceCatalog(configEndpoints?: string[], request: OfficialConfigRequester = requestOfficialConfig): Promise<OfficialResourceCatalog> {
  const candidates = (configEndpoints?.length ? configEndpoints : DEFAULT_OFFICIAL_CONFIG_ENDPOINTS)
    .map((value) => value ? normalizeUrl(value) : null)
    .filter((value): value is string => Boolean(value));
  const uniqueCandidates = [...new Set(candidates)];
  let latestError: unknown = null;

  for (const configUrl of uniqueCandidates) {
    try {
      const parsed = parseOfficialResourceConfig(await request(configUrl));
      const replacementEndpoints = parsed.primaryApi && parsed.backupApi && isConfigUrl(parsed.primaryApi) && isConfigUrl(parsed.backupApi)
        ? [parsed.primaryApi, parsed.backupApi]
        : null;
      const hasReplacement = replacementEndpoints !== null && replacementEndpoints.some((url, index) => url !== uniqueCandidates[index]);
      if (replacementEndpoints && hasReplacement) {
        try {
          const updated = parseOfficialResourceConfig(await request(replacementEndpoints[0]));
          return { configUrl: replacementEndpoints[0], configEndpoints: replacementEndpoints, resources: updated.resources.length ? updated.resources : parsed.resources };
        } catch {
          return { configUrl, configEndpoints: replacementEndpoints, resources: parsed.resources };
        }
      }
      const activeEndpoints = replacementEndpoints ?? uniqueCandidates.slice(0, 2);
      return { configUrl, configEndpoints: activeEndpoints, resources: parsed.resources };
    } catch (error) {
      latestError = error;
    }
  }

  throw latestError instanceof Error ? latestError : new Error("官方资源配置暂时无法访问");
}

export async function getOfficialResourceSyncState(): Promise<OfficialResourceSyncState> {
  try {
    const raw = await AsyncStorage.getItem(OFFICIAL_RESOURCE_SYNC_STATE_KEY);
    if (!raw) return DEFAULT_SYNC_STATE;
    const parsed = JSON.parse(raw) as Partial<OfficialResourceSyncState>;
    return { ...DEFAULT_SYNC_STATE, ...parsed };
  } catch {
    return DEFAULT_SYNC_STATE;
  }
}

async function saveOfficialResourceSyncState(state: OfficialResourceSyncState): Promise<void> {
  await AsyncStorage.setItem(OFFICIAL_RESOURCE_SYNC_STATE_KEY, JSON.stringify(state));
}

function signatureFor(resources: OfficialVodSource[]): string {
  return resources.map((source) => `${source.key}|${source.name}|${source.address}`).sort().join("\n");
}

export async function syncOfficialResourceCatalog(force = false): Promise<OfficialResourceSyncResult> {
  const previous = await getOfficialResourceSyncState();
  const checkedAt = Date.now();
  if (!force && previous.lastCheckedAt && checkedAt - new Date(previous.lastCheckedAt).getTime() < OFFICIAL_RESOURCE_SYNC_INTERVAL_MS) {
    return { state: previous, resources: [], skipped: true, success: true };
  }

  try {
    // Put the current official pair first so an older persisted endpoint group cannot block updates.
    const catalog = await loadOfficialResourceCatalog([...DEFAULT_OFFICIAL_CONFIG_ENDPOINTS, ...previous.configEndpoints]);
    const resourceSignature = signatureFor(catalog.resources);
    const state: OfficialResourceSyncState = {
      configUrl: catalog.configUrl,
      configEndpoints: catalog.configEndpoints,
      lastCheckedAt: new Date(checkedAt).toISOString(),
      lastUpdatedAt: resourceSignature === previous.resourceSignature ? previous.lastUpdatedAt : new Date(checkedAt).toISOString(),
      lastError: null,
      resourceCount: catalog.resources.length,
      resourceSignature,
    };
    await saveOfficialResourceSyncState(state);
    return { state, resources: catalog.resources, skipped: false, success: true };
  } catch (error) {
    const state: OfficialResourceSyncState = {
      ...previous,
      lastCheckedAt: new Date(checkedAt).toISOString(),
      lastError: toChineseNetworkError(error, "官方资源配置暂时无法访问，请稍后重试"),
    };
    await saveOfficialResourceSyncState(state);
    return { state, resources: [], skipped: false, success: false };
  }
}
