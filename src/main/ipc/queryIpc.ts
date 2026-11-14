// 읽기 전용 조회 IPC: 검색 · 파일 히스토리 · blame · hunk
import { ipcMain } from "electron";
import { blame, fileHistory, hunks, searchCommits } from "@/git/query";
import { requireRoot } from "@/repo/session";

export function registerQueryIpc(): void {
  ipcMain.handle("query:search", (_e, query: string) => searchCommits(requireRoot(), query));
  ipcMain.handle("query:fileHistory", (_e, file: string) => fileHistory(requireRoot(), file));
  ipcMain.handle("query:blame", (_e, { file, commit }: { file: string; commit?: string | null }) => blame(requireRoot(), file, commit));
  ipcMain.handle("query:hunks", (_e, { file, staged }: { file: string; staged: boolean }) => hunks(requireRoot(), file, staged));
}
