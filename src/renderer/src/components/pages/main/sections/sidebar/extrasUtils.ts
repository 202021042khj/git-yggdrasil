import { run } from "@/app/actions";
import { t } from "@shared/i18n/i18n";

/** 브랜치를 다른 폴더에 함께 체크아웃 (오른쪽 클릭 메뉴에서) */
export const addWorktree = async (branch: string): Promise<void> => {
  const parent = await window.gitApi.pickDir(t("ex.pickDir", { branch }));
  if (!parent) return;
  await run({ op: "worktreeAdd", args: [branch, parent], summary: t("ex.wtAdd", { branch }) });
};
