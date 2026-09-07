export type RefreshTab = "home" | "library" | "search" | "settings";

type Listener = () => void;
const listeners = new Map<RefreshTab, Set<Listener>>();

export function subscribeTabRefresh(tab: RefreshTab, listener: Listener): () => void {
  const bucket = listeners.get(tab) ?? new Set<Listener>();
  bucket.add(listener);
  listeners.set(tab, bucket);
  return () => bucket.delete(listener);
}

export function emitTabRefresh(tab: RefreshTab): void {
  listeners.get(tab)?.forEach((listener) => listener());
}
