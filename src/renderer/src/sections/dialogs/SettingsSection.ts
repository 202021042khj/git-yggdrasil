// 설정 창: 바꾸는 즉시 저장·적용한다 (화면 색·글자 크기는 메인 프로세스가, 나머지는 화면이 쓴다)
import "./SettingsSection.css";
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { PULL_MODE_KEY } from "@/constants/storage";
import { byId } from "@/lib/dom";
import { DEFAULT_SETTINGS, type Settings } from "@shared/types/ipc";

let current: Settings = { ...DEFAULT_SETTINGS };
let fetchTimer: ReturnType<typeof setInterval> | null = null;

export const getSettings = () => current;

function fill(): void {
  byId<HTMLSelectElement>("set-theme").value = current.theme;
  byId<HTMLInputElement>("set-zoom").value = String(current.zoom);
  byId("set-zoom-out").textContent = `${Math.round(current.zoom * 100)}%`;
  byId<HTMLInputElement>("set-editor").value = current.editor;
  byId<HTMLSelectElement>("set-fetch").value = String(current.autoFetchMinutes);
  byId<HTMLSelectElement>("set-pull").value = current.pullMode;
  byId<HTMLInputElement>("set-reopen").checked = current.reopenLast;
}

/** 정해 둔 간격마다 조용히 fetch (실행 중이거나 멈춘 작업이 있으면 건너뜀) */
function scheduleFetch(): void {
  if (fetchTimer) clearInterval(fetchTimer);
  fetchTimer = null;
  if (!current.autoFetchMinutes) return;
  fetchTimer = setInterval(async () => {
    if (!store.hasRepo() || store.ui.busy || store.repo.op) return;
    try {
      const r = await window.gitApi.run("fetch", [], {});
      if (r.ok && r.repo) show(r.repo);
    } catch { /* 네트워크 오류는 다음 차례에 */ }
  }, current.autoFetchMinutes * 60_000);
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  current = await window.gitApi.setSettings(patch);
  if (patch.pullMode) store.update({ pullMode: current.pullMode });
  if (patch.autoFetchMinutes !== undefined) scheduleFetch();
  fill();
}

export function openSettings(): void {
  fill();
  const d = byId<HTMLDialogElement>("settings");
  if (!d.open) d.showModal();
}

/** 시작할 때 한 번: 설정을 읽어 적용하고 창을 연결한다 */
export async function loadSettings(): Promise<Settings> {
  current = await window.gitApi.getSettings();
  // 예전 버전은 pull 방식을 화면 저장소(localStorage)에 두었다: 한 번 옮기고 지운다
  try {
    const old = localStorage.getItem(PULL_MODE_KEY);
    if (old === "merge" || old === "rebase") {
      if (old !== current.pullMode) current = await window.gitApi.setSettings({ pullMode: old });
      localStorage.removeItem(PULL_MODE_KEY);
    }
  } catch { /* 없으면 그만 */ }
  store.update({ pullMode: current.pullMode });
  scheduleFetch();
  return current;
}

export function mountSettings(): void {
  const form = byId<HTMLFormElement>("settings-form");
  form.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const v = t.name === "zoom" ? Number(t.value)
      : t.name === "autoFetchMinutes" ? Number(t.value)
      : t.name === "reopenLast" ? (t as HTMLInputElement).checked
      : t.value;
    void saveSettings({ [t.name]: v } as Partial<Settings>);
  });
  // 확대는 끄는 동안에도 숫자를 보여 준다
  byId<HTMLInputElement>("set-zoom").addEventListener("input", (e) => {
    byId("set-zoom-out").textContent = `${Math.round(Number((e.target as HTMLInputElement).value) * 100)}%`;
  });
  window.gitApi.onMenuSettings(openSettings);
}
