import { useEffect, useState, useSyncExternalStore } from "react";
import type { Api } from "../main/main";

type RpcResult = { ok: true; value: unknown } | { ok: false; error: string };

declare global {
  interface Window {
    finance: { rpc(method: string, arg?: unknown): Promise<RpcResult> };
  }
}

type Result<K extends keyof Api> = Awaited<ReturnType<Api[K]>>;

/** Call the main process. Throws with a message meant for the person using the app. */
export async function call<K extends keyof Api>(method: K, ...args: Parameters<Api[K]>): Promise<Result<K>> {
  const res = await window.finance.rpc(method, args[0]);
  if (!res.ok) throw new Error(res.error);
  return res.value as Result<K>;
}

// ---- one version number: every query re-runs after any change ---------------

let version = 0;
const versionListeners = new Set<() => void>();
const subscribeVersion = (fn: () => void) => {
  versionListeners.add(fn);
  return () => versionListeners.delete(fn);
};
export function refresh(): void {
  version++;
  versionListeners.forEach((fn) => fn());
}

export function useQuery<K extends keyof Api>(method: K, ...args: Parameters<Api[K]>): Result<K> | undefined {
  const v = useSyncExternalStore(subscribeVersion, () => version);
  const key = JSON.stringify(args);
  const [data, setData] = useState<Result<K>>();
  useEffect(() => {
    let live = true;
    call(method, ...args)
      .then((value) => live && setData(value))
      .catch((error: Error) => live && toast(error.message, "error"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, v]);
  return data;
}

/** Make a change, then refresh. A failure becomes a toast and returns undefined. */
export async function change<K extends keyof Api>(method: K, ...args: Parameters<Api[K]>): Promise<Result<K> | undefined> {
  try {
    const value = await call(method, ...args);
    refresh();
    return value;
  } catch (error) {
    toast((error as Error).message, "error");
    return undefined;
  }
}

// ---- toasts -----------------------------------------------------------------

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
let toasts: Toast[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((fn) => fn());

export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = nextToast++;
  toasts = [...toasts.slice(-2), { id, text, kind }];
  emitToasts();
  setTimeout(() => dismissToast(id), kind === "error" ? 7000 : 3500);
}
export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
  );
}

export async function undoLast(): Promise<void> {
  const label = await change("undo.run");
  toast(label ? `Undid: ${label}` : "Nothing to undo");
}
