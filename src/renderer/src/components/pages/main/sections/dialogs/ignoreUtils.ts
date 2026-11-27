// 무시 파일 (.gitignore · .git/info/exclude) 편집 창 상태와 조작 실행
import { errorText } from "@/lib/html";
import { createStore } from "@/lib/createStore";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { t } from "@shared/i18n/i18n";
import type { IgnoreFiles, IgnoreTarget } from "@shared/types/ipc";

export interface IgnoreState {
  open: boolean;
  loading: boolean;
  error: string;
  files: IgnoreFiles;
  target: IgnoreTarget;
  /** 창을 열 때 "왜 무시될까?" 칸에 넣어 둘 경로 */
  why: string;
}

export const ignoreStore = createStore<IgnoreState>({ open: false, loading: false, error: "", files: { gitignore: [], exclude: [] }, target: "gitignore", why: "" });

export const targetName = (target: IgnoreTarget) => (target === "gitignore" ? ".gitignore" : ".git/info/exclude");

/** 셸에 붙여 넣을 수 있게 작은따옴표로 감싼다 (메뉴 · 창에 보여 줄 대응 명령용) */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const appendCmd = (pattern: string, target: IgnoreTarget) => `printf '%s\\n' ${shellQuote(pattern)} >> ${targetName(target)}`;

/** 패턴 목록을 다시 읽는다 */
export const reloadIgnore = async (): Promise<void> => {
  ignoreStore.set((s) => ({ ...s, loading: true, error: "" }));
  try {
    const files = await window.gitApi.ignoreRead();
    ignoreStore.set((s) => ({ ...s, loading: false, files }));
  } catch (err) {
    ignoreStore.set((s) => ({ ...s, loading: false, error: errorText(err) }));
  }
};

/** 창 열기 (why: "왜 무시될까?" 칸에 미리 넣을 경로) */
export const openIgnoreEditor = (why = ""): void => {
  if (!store.hasRepo()) return;
  ignoreStore.set((s) => ({ ...s, open: true, why }));
  void reloadIgnore();
};

/** 패턴 더하기 (⌘Z 로 이전 내용으로 되돌린다) */
export const addIgnore = (pattern: string, target: IgnoreTarget = "gitignore") =>
  run({ op: "ignoreAdd", args: [[pattern], target], summary: t("ig.addSummary", { pattern, file: targetName(target) }) });

export const removeIgnore = (pattern: string, target: IgnoreTarget) =>
  run({ op: "ignoreRemove", args: [pattern, target], summary: t("ig.removeSummary", { pattern, file: targetName(target) }) });

/** 추적 멈추고 무시 (git rm --cached + .gitignore) */
export const untrackAndIgnore = (file: string, pattern: string) =>
  run({ op: "untrackIgnore", args: [file, pattern], summary: t("ig.untrackSummary", { file }) });
