import type { RepoState } from "@shared/types/repo";

/** 경로 p 는 파일 또는 폴더. "" 는 저장소 루트. */
export const under = (f: string, p: string) => p === "" || f === p || f.startsWith(p + "/");
export const underAny = (f: string, paths: string[]) => paths.some((p) => under(f, p));

export const changedFiles = (s: RepoState) => [...s.working.staged, ...s.working.unstaged];

const isFilePath = (s: RepoState, p: string) => s.files.includes(p) || changedFiles(s).includes(p) || s.working.conflicted.includes(p);

/** git 명령에 쓸 pathspec 표기: 루트는 ".", 폴더는 "dir/" */
export const pathspec = (s: RepoState, paths: string[]) => paths.map((p) => (p === "" ? "." : isFilePath(s, p) ? p : p + "/")).join(" ");
