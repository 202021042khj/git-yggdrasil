// 상세 패널을 밖에서 다루는 함수와 diff 보기 설정
import { createStore } from "@/lib/createStore";
import { short } from "@/lib/html";
import { confirmAction } from "@/components/ui/dialogUtils";
import { toast } from "@/components/ui/toastUtils";
import { blocked, run } from "@/app/actions";
import { store } from "@/app/store";
import { DIFF_PREFS_KEY } from "@/constants/storage";
import { pushedSet } from "@/model/graph";

export interface DiffPrefs {
  split: boolean;
  ignoreWhitespace: boolean;
}

const loadPrefs = (): DiffPrefs => {
  try { return { split: false, ignoreWhitespace: false, ...JSON.parse(localStorage.getItem(DIFF_PREFS_KEY) || "{}") }; } catch { return { split: false, ignoreWhitespace: false }; }
};

/** diff 보기: 통합 / 좌우, 공백 무시 (다음 실행에도 기억한다) */
export const diffPrefsStore = createStore<DiffPrefs>(loadPrefs());

export const setDiffPrefs = (patch: Partial<DiffPrefs>) => {
  diffPrefsStore.set((p) => ({ ...p, ...patch }));
  try { localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(diffPrefsStore.get())); } catch { /* 이번 실행에서만 */ }
};

/** 커밋 더블클릭: 선택하고 메시지 입력칸에 커서 */
export const focusMessageInput = (id: string) => {
  store.update({ selected: id, selectedFile: null });
  store.flush();
  const input = document.getElementById("msg-input") as HTMLInputElement | null;
  if (input && !input.disabled) { input.focus(); input.select(); }
};

/** 커밋 메시지 바꾸기 (push 된 커밋이면 먼저 확인) */
export const reword = async (id: string, next: string): Promise<void> => {
  const s = store.repo;
  if (blocked()) return;
  const msg = next.trim();
  if (!msg || msg === s.commits[id].msg) { toast(msg ? "메시지가 같습니다." : "메시지가 비어 있습니다."); return; }
  if (pushedSet(s).has(id) && !confirmAction("push 된 커밋의 메시지를 바꿉니다.\n원격과 히스토리가 달라져서 이후 force push 가 필요합니다. 계속할까요?")) return;
  await run({ op: "reword", args: [id, msg], summary: `${short(id)} "${s.commits[id].msg}" 메시지 → "${msg}"` });
};
