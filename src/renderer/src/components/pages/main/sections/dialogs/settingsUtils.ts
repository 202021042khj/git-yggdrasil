// 앱 설정: 읽기 · 저장 · 자동 fetch (화면 색·글자 크기는 메인 프로세스가 적용한다)
import { createStore } from "@/lib/createStore";
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { PULL_MODE_KEY } from "@/constants/storage";
import { DEFAULT_SETTINGS, type Settings } from "@shared/types/ipc";

export const settingsStore = createStore<Settings>({ ...DEFAULT_SETTINGS });
export const settingsOpenStore = createStore(false);

let fetchTimer: ReturnType<typeof setInterval> | null = null;

/** 정해 둔 간격마다 조용히 fetch (실행 중이거나 멈춘 작업이 있으면 건너뜀) */
const scheduleFetch = () => {
  if (fetchTimer) clearInterval(fetchTimer);
  fetchTimer = null;
  const minutes = settingsStore.get().autoFetchMinutes;
  if (!minutes) return;
  fetchTimer = setInterval(async () => {
    if (!store.hasRepo() || store.ui.busy || store.repo.op) return;
    try {
      const r = await window.gitApi.run("fetch", [], {});
      if (r.ok && r.repo) show(r.repo);
    } catch { /* 네트워크 오류는 다음 차례에 */ }
  }, minutes * 60_000);
};

export const saveSettings = async (patch: Partial<Settings>): Promise<void> => {
  const next = await window.gitApi.setSettings(patch);
  settingsStore.set(next);
  if (patch.pullMode) store.update({ pullMode: next.pullMode });
  if (patch.autoFetchMinutes !== undefined) scheduleFetch();
};

export const openSettings = () => settingsOpenStore.set(true);

/** 시작할 때 한 번: 설정을 읽어 적용한다 */
export const loadSettings = async (): Promise<Settings> => {
  let cur = await window.gitApi.getSettings();
  // 예전 버전은 pull 방식을 화면 저장소(localStorage)에 두었다: 한 번 옮기고 지운다
  try {
    const old = localStorage.getItem(PULL_MODE_KEY);
    if (old === "merge" || old === "rebase") {
      if (old !== cur.pullMode) cur = await window.gitApi.setSettings({ pullMode: old });
      localStorage.removeItem(PULL_MODE_KEY);
    }
  } catch { /* 없으면 그만 */ }
  settingsStore.set(cur);
  store.update({ pullMode: cur.pullMode });
  scheduleFetch();
  return cur;
};
