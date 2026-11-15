import { run } from "@/app/actions";

/** 브랜치를 다른 폴더에 함께 체크아웃 (오른쪽 클릭 메뉴에서) */
export const addWorktree = async (branch: string): Promise<void> => {
  const parent = await window.gitApi.pickDir(`${branch} 를 체크아웃할 폴더를 넣을 곳`);
  if (!parent) return;
  await run({ op: "worktreeAdd", args: [branch, parent], summary: `${branch} 를 다른 폴더에 체크아웃 (worktree)` });
};
