// 저장소 부가 정보: 서브모듈 · worktree · Git LFS 로 관리하는 파일
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { git } from "@/git/cli";
import type { LfsInfo, SubmoduleInfo, WorktreeInfo } from "@shared/types/repo";

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** git submodule status: 앞 글자 ' ' 정상 · '+' 기록과 다른 커밋 · '-' 아직 안 받음 · 'U' 충돌 */
export async function readSubmodules(root: string): Promise<SubmoduleInfo[]> {
  if (!fs.existsSync(path.join(root, ".gitmodules"))) return [];
  const [status, cfg] = await Promise.all([
    git(root, ["submodule", "status"], { allowFail: true }),
    git(root, ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.(path|url)$"], { allowFail: true }),
  ]);
  // .gitmodules: submodule.<이름>.path / .url → 경로별 주소
  const byName: Record<string, { path?: string; url?: string }> = {};
  for (const line of (cfg || "").split("\n").filter(Boolean)) {
    const m = /^submodule\.(.+)\.(path|url) (.*)$/.exec(line);
    if (m) (byName[m[1]] ||= {})[m[2] as "path" | "url"] = m[3];
  }
  const urlOf = (p: string) => Object.values(byName).find((x) => x.path === p)?.url;
  const STATE = { " ": "ok", "+": "modified", "-": "uninitialized", U: "conflict" } as const;
  return (status || "").split("\n").filter(Boolean).flatMap((line): SubmoduleInfo[] => {
    const m = /^([ +\-U])([0-9a-f]+) (\S+)(?: \((.*)\))?$/.exec(line);
    if (!m) return [];
    return [{ path: m[3], sha: m[2], state: STATE[m[1] as keyof typeof STATE], url: urlOf(m[3]), describe: m[4] as string | undefined }];
  });
}

/** git worktree list --porcelain. 첫 항목이 원래 저장소 */
export async function readWorktrees(root: string): Promise<WorktreeInfo[]> {
  const out = await git(root, ["worktree", "list", "--porcelain"], { allowFail: true });
  const me = real(root);
  return (out || "").split("\n\n").map((block) => block.split("\n").filter(Boolean)).filter((l) => l.length).map((lines, i) => {
    const val = (k: string) => lines.find((l) => l === k || l.startsWith(k + " "))?.slice(k.length + 1);
    const p = val("worktree") ?? "";
    const branchRef = val("branch");
    return {
      path: p,
      head: val("HEAD") ?? "",
      branch: branchRef ? branchRef.replace(/^refs\/heads\//, "") : null,
      main: i === 0,
      current: real(p) === me,
      locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
      prunable: lines.some((l) => l.startsWith("prunable")),
    };
  });
}

/** .gitattributes 에 filter=lfs 가 있을 때만 파일마다 확인한다 (대형 저장소에서 비용을 아끼려고) */
export async function readLfs(root: string, files: string[]): Promise<LfsInfo | undefined> {
  const attrFiles = files.filter((f) => f === ".gitattributes" || f.endsWith("/.gitattributes"));
  const usesLfs = attrFiles.some((f) => { try { return /filter=lfs/.test(fs.readFileSync(path.join(root, f), "utf8")); } catch { return false; } });
  if (!usesLfs) return undefined;
  const [installed, attrs] = await Promise.all([
    new Promise<boolean>((resolve) => execFile("git", ["lfs", "version"], { cwd: root }, (e) => resolve(!e))),
    new Promise<string>((resolve) => {
      const child = execFile("git", ["check-attr", "-z", "--stdin", "filter"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }, (_e, out) => resolve(out || ""));
      child.stdin?.end(files.join("\0") + "\0");
    }),
  ]);
  const parts = attrs.split("\0");
  const lfsFiles: string[] = [];
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === "lfs") lfsFiles.push(parts[i]);
  return { installed, files: lfsFiles };
}
