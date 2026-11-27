// 읽기 전용 조회 IPC: 검색 · 파일 히스토리 · blame · hunk
import { handle } from "@/ipc/guard";
import { blame, conflictText, fileHistory, hunks, searchCommits } from "@/git/query";
import { ignoreMatches, ignoreWhy, readIgnoreFiles } from "@/git/ops/ignoreOps";
import { hookInfo } from "@/git/hooks";
import { readReflog } from "@/git/reflog";
import { signatureOf, signingInfo } from "@/git/sign";
import { requireRoot } from "@/repo/session";

export function registerQueryIpc(): void {
  handle("query:search", (_e, query: string) => searchCommits(requireRoot(), query));
  handle("query:fileHistory", (_e, file: string) => fileHistory(requireRoot(), file));
  handle("query:blame", (_e, { file, commit }: { file: string; commit?: string | null }) => blame(requireRoot(), file, commit));
  handle("query:reflog", () => readReflog(requireRoot()));
  handle("query:signing", () => signingInfo(requireRoot()));
  handle("query:hooks", () => hookInfo(requireRoot()));
  handle("query:signature", (_e, id: string) => signatureOf(requireRoot(), id));
  handle("query:conflictText", (_e, file: string) => conflictText(requireRoot(), file));
  handle("query:ignoreRead", () => readIgnoreFiles(requireRoot()));
  handle("query:ignoreMatches", (_e, pattern: string) => ignoreMatches(requireRoot(), pattern));
  handle("query:ignoreWhy", (_e, file: string) => ignoreWhy(requireRoot(), file));
  handle("query:hunks", (_e, { file, staged }: { file: string; staged: boolean }) => hunks(requireRoot(), file, staged));
}
