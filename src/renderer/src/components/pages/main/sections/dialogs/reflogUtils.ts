// 예전 커밋 찾기 (reflog) 창 상태
import { errorText } from "@/lib/html";
import { createStore } from "@/lib/createStore";
import { store } from "@/app/store";
import type { ReflogEntry } from "@shared/types/ipc";

export interface ReflogState {
  open: boolean;
  loading: boolean;
  error: string;
  entries: ReflogEntry[];
}

export const reflogStore = createStore<ReflogState>({ open: false, loading: false, error: "", entries: [] });

/** 창을 열고(이미 열려 있으면 그대로) 기록을 다시 읽는다 */
export const openReflog = async (): Promise<void> => {
  if (!store.hasRepo()) return;
  reflogStore.set((r) => ({ ...r, open: true, loading: true, error: "" }));
  try {
    const entries = await window.gitApi.reflog();
    reflogStore.set((r) => ({ ...r, loading: false, entries }));
  } catch (err) {
    reflogStore.set((r) => ({ ...r, loading: false, error: errorText(err) }));
  }
};
