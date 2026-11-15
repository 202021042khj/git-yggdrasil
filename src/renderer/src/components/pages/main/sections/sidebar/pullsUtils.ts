// 열린 Pull Request 목록 상태 (GitHub 로그인 · 저장소가 바뀌면 다시 불러온다)
import { errorText } from "@/lib/html";
import { createStore } from "@/lib/createStore";
import { store } from "@/app/store";
import type { GhPullList } from "@shared/types/ipc";

export interface PullsState {
  list: GhPullList | null;
  /** 이 저장소 기준으로 불러왔다 (다르면 다시 불러온다) */
  loadedFor: string | null;
  loading: boolean;
  error: string;
  loggedIn: boolean;
}

export const pullsStore = createStore<PullsState>({ list: null, loadedFor: null, loading: false, error: "", loggedIn: false });

export const loadPulls = async (): Promise<void> => {
  const root = store.repo.root ?? null;
  pullsStore.set((p) => ({ ...p, loading: true, loadedFor: root, error: "" }));
  try {
    const r = await window.ghApi.pulls();
    if (store.repo.root === root) pullsStore.set((p) => ({ ...p, list: r }));
  } catch (err) {
    pullsStore.set((p) => ({ ...p, error: errorText(err), list: null }));
  } finally {
    pullsStore.set((p) => ({ ...p, loading: false }));
  }
};

/** 점검용: GitHub 에 접속하지 않고 목록을 넣어 본다 (dev/debug.ts) */
export const injectPulls = (data: GhPullList) => {
  pullsStore.set((p) => ({ ...p, loggedIn: true, list: data, loadedFor: store.repo.root ?? null }));
};

/** GitHub 로그인 상태가 바뀌면 githubUtils 가 알려 준다 */
export const setPullsLogin = (on: boolean) => {
  if (on === pullsStore.get().loggedIn) return;
  pullsStore.set((p) => ({ ...p, loggedIn: on, loadedFor: null, list: null }));
};
