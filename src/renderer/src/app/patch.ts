// 패치 내보내기 · 적용: 파일 경로는 main 이 저장·열기 창으로 고르고, 화면은 무엇을 내보낼지만 보낸다
import { run } from "@/app/actions";
import { t } from "@shared/i18n/i18n";
import type { PatchSource } from "@shared/types/ipc";

const what = (source: PatchSource, ids: string[]) =>
  source === "commits" ? t("patch.commits", { n: ids.length }) : t(source === "staged" ? "patch.staged" : "patch.working");

/** 패치 파일로 저장 (git format-patch / git diff) */
export const savePatch = (source: PatchSource, ids: string[] = []) =>
  run({ op: "patchExport", args: [], summary: t("patch.saveSummary", { what: what(source, ids) }), invoke: () => window.gitApi.patchSave(source, ids) });

/** 클립보드로 복사 */
export const copyPatch = (source: PatchSource, ids: string[] = []) =>
  run({ op: "patchExport", args: [], summary: t("patch.copySummary", { what: what(source, ids) }), invoke: () => window.gitApi.patchCopy(source, ids) });

/** 패치 적용 (메일 형식이면 git am --3way, 그냥 diff 면 git apply) */
export const applyPatch = () =>
  run({ op: "patchApply", args: [], summary: t("patch.applySummary"), invoke: () => window.gitApi.patchApply() });
