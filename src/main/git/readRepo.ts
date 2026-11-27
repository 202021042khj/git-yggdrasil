// 저장소 상태 읽기: 커밋 그래프, ref, 작업 영역, stash, 원격, 태그, 진행 중 작업
import { readLfs, readSubmodules, readWorktrees } from "@/git/extras";
import path from "node:path";
import { git, repoRoot } from "@/git/cli";
import { readBisectState, readOpState } from "@/git/opState";
import { readStatus } from "@/git/status";
import type { Commit, RemoteInfo, RepoState, StashEntry, TagInfo } from "@shared/types/repo";

/** 처음 불러오는 커밋 수. "더 불러오기" 로 저장소마다 늘릴 수 있다 */
export const PAGE_SIZE = 400;
const MAX_FILES = 5000;
const US = "\x1f"; // 필드 구분
const RS = "\x1e"; // 레코드 구분

const limits = new Map<string, number>(); // root → 불러올 커밋 수
const limitOf = (root: string) => limits.get(root) || PAGE_SIZE;
export function loadMore(root: string, step = PAGE_SIZE): number {
  limits.set(root, limitOf(root) + step);
  return limitOf(root);
}

async function readCommits(root: string, limit: number) {
  const out = await git(root, [
    "log", "--branches", "--remotes", "--tags", "HEAD", "--topo-order", `-n${limit}`,
    "--name-only", `--format=${RS}%H${US}%P${US}%an${US}%at${US}%s`,
  ], { allowFail: true });
  const commits: Record<string, Commit> = {};
  if (!out) return { commits, truncated: false };
  for (const rec of out.split(RS)) {
    if (!rec.trim()) continue;
    const [header, ...rest] = rec.split("\n");
    const [id, parents, author, at, ...subj] = header.split(US);
    commits[id] = {
      id,
      parents: parents ? parents.split(" ") : [],
      author,
      date: Number(at) * 1000,
      msg: subj.join(US),
      files: rest.map((l) => l.trim()).filter(Boolean),
    };
  }
  // 불러온 범위 밖의 부모는 끊는다 (화면 코드가 없는 커밋을 따라가지 않게)
  let truncated = false;
  for (const c of Object.values(commits)) {
    const kept = c.parents.filter((p) => commits[p]);
    if (kept.length !== c.parents.length) { truncated = true; c.shallow = true; }
    c.parents = kept;
  }
  return { commits, truncated };
}

async function readRefs(root: string, commits: Record<string, Commit>) {
  const out = await git(root, ["for-each-ref", `--format=%(refname)${US}%(objectname)${US}%(upstream:short)`, "refs/heads", "refs/remotes"]);
  const branches: Record<string, string> = {}, remotes: Record<string, string> = {}, upstream: Record<string, string> = {};
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [ref, oid, up] = line.split(US);
    if (!commits[oid]) continue; // 범위 밖 (아주 오래된 ref)
    if (ref.startsWith("refs/heads/")) {
      const b = ref.slice(11);
      branches[b] = oid;
      if (up) upstream[b] = up;
    } else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) {
      remotes[ref.slice(13)] = oid;
    }
  }
  return { branches, remotes, upstream };
}

async function readTags(root: string, commits: Record<string, Commit>): Promise<Record<string, TagInfo>> {
  const out = await git(root, ["for-each-ref", `--format=%(refname:short)${US}%(objecttype)${US}%(objectname)${US}%(*objectname)${US}%(contents:subject)`, "refs/tags"], { allowFail: true });
  const tags: Record<string, TagInfo> = {};
  for (const line of (out || "").split("\n")) {
    if (!line) continue;
    const [name, type, oid, peeled, subject] = line.split(US);
    const target = type === "tag" ? peeled : oid;
    if (!commits[target]) continue;
    tags[name] = { name, target, annotated: type === "tag", message: type === "tag" ? subject : undefined };
  }
  return tags;
}

async function readHead(root: string) {
  const sym = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
  if (sym) return { head: sym.trim(), detached: null as string | null };
  const oid = await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true });
  return { head: null as string | null, detached: oid ? oid.trim() : null };
}

async function readFiles(root: string): Promise<string[]> {
  const out = await git(root, ["ls-files", "-z"], { allowFail: true });
  return out ? out.split("\0").filter(Boolean).slice(0, MAX_FILES) : [];
}

async function readStash(root: string): Promise<StashEntry[]> {
  const out = await git(root, ["stash", "list", `--format=%gd${US}%s`], { allowFail: true });
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((l) => {
    const [ref, msg] = l.split(US);
    return { id: ref, msg, branch: (msg.match(/^(?:WIP on|On) ([^:]+):/) || [])[1] || "", staged: [], unstaged: [] };
  });
}

async function readRemotes(root: string): Promise<RemoteInfo[]> {
  const out = await git(root, ["remote", "-v"], { allowFail: true });
  const map: Record<string, string> = {};
  for (const line of (out || "").split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (m && m[3] === "fetch") map[m[1]] = m[2];
  }
  return Object.entries(map).map(([name, url]) => ({ name, url }));
}

/** git 저장소가 아닌 폴더: 빈 상태로 열어 두고 화면에서 "git 시작하기"(git init)를 고르게 한다 */
export const notGitState = (dir: string): RepoState => ({
  root: dir, repoName: path.basename(dir), notGit: true,
  commits: {}, branches: {}, remotes: {}, head: "", files: [],
  working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
});

export async function readRepo(dir: string): Promise<RepoState> {
  const root = await repoRoot(dir);
  if (!root) return notGitState(dir);
  const [{ commits, truncated }, totalOut] = await Promise.all([
    readCommits(root, limitOf(root)),
    git(root, ["rev-list", "--count", "--branches", "--remotes", "--tags", "HEAD"], { allowFail: true }),
  ]);
  const shown = Object.keys(commits).length;
  const totalCommits = Number((totalOut || "0").trim()) || shown;
  const [refs, headInfo, working, files, stash, remoteList, tags, submodules, worktrees] = await Promise.all([
    readRefs(root, commits), readHead(root), readStatus(root), readFiles(root), readStash(root), readRemotes(root), readTags(root, commits),
    readSubmodules(root), readWorktrees(root),
  ]);
  const lfs = await readLfs(root, files);
  return {
    root,
    repoName: path.basename(root),
    commits,
    truncated: truncated || totalCommits > shown,
    totalCommits,
    branches: refs.branches,
    remotes: refs.remotes,
    upstream: refs.upstream,
    remoteList,
    tags,
    head: headInfo.head ?? "",
    detached: headInfo.detached,
    files,
    working,
    stash,
    op: await readOpState(root, working.conflicted, headInfo.head),
    bisect: await readBisectState(root),
    born: {},
    submodules,
    worktrees,
    lfs,
  };
}
