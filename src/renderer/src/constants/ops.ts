import type { OpKind } from "@shared/types/repo";

/** 진행 중 작업 종류 → 대응 git 명령 (배너 버튼 툴팁) */
export const OP_CMD: Record<OpKind, string> = {
  rebase: "git rebase",
  merge: "git merge",
  "cherry-pick": "git cherry-pick",
  revert: "git revert",
  files: "git add",
  stash: "git stash",
  split: "git rebase",
};

/** 진행 중에는 이 조작만 실행할 수 있다 */
export const ALLOWED_DURING_OP = new Set(["resolveFile", "resolveContent", "continueOp", "skipOp", "abortOp", "fetch", "stageFiles", "stageHunk", "commitTo", "discard"]);
