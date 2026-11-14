// git.js — 실제 git CLI 를 호출해서 저장소 상태를 읽는다 (1단계: 읽기 전용)
// 화면(renderer)이 목업에서 쓰던 상태 모양 그대로 돌려준다:
//   { commits, branches, remotes, head, files, working:{staged,unstaged,conflicted}, stash, op, ... }
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MAX_COMMITS = 400;
const MAX_FILES = 5000;
const US = "\x1f"; // 필드 구분
const RS = "\x1e"; // 레코드 구분

function git(cwd, args, { allowFail = false, env = {}, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd, timeout, maxBuffer: 64 * 1024 * 1024,
      // 인증 프롬프트가 뜨면 앱이 멈추므로 바로 실패하게 한다 (자격 증명 도우미·SSH 에이전트는 그대로 쓴다)
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", ...env },
    },
      (err, stdout, stderr) => {
        if (err && !allowFail) {
          const e = new Error(`git ${args.join(" ")}: ${(stderr || err.message).trim()}`);
          e.code = err.code;
          e.stderr = (stderr || (err.killed ? "시간 초과로 중단했습니다." : err.message)).trim();
          return reject(e);
        }
        resolve(err ? null : stdout);
      });
  });
}

// 종료 코드까지 필요한 경우 (예: merge-tree 는 충돌이면 1 을 돌려준다)
function gitRaw(cwd, args, { env = {}, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile("git", args, {
      cwd, timeout, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", ...env },
    }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr }));
  });
}

async function repoRoot(dir) {
  const out = await git(dir, ["rev-parse", "--show-toplevel"], { allowFail: true });
  return out ? out.trim() : null;
}

// 커밋 그래프: 모든 ref 에서 닿는 최근 커밋들 + 각 커밋이 바꾼 파일
async function readCommits(root) {
  const out = await git(root, [
    "log", "--branches", "--remotes", "--tags", "HEAD", "--topo-order", `-n${MAX_COMMITS}`,
    "--name-only", `--format=${RS}%H${US}%P${US}%an${US}%at${US}%s`,
  ], { allowFail: true });
  const commits = {};
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

async function readRefs(root, commits) {
  const out = await git(root, ["for-each-ref", `--format=%(refname)${US}%(objectname)${US}%(upstream:short)`, "refs/heads", "refs/remotes"]);
  const branches = {}, remotes = {}, upstream = {};
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

async function readHead(root) {
  const sym = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
  if (sym) return { head: sym.trim(), detached: null };
  const oid = await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true });
  return { head: null, detached: oid ? oid.trim() : null };
}

// git status --porcelain=v1 -z : "XY path\0" (이름 변경은 뒤에 원래 경로가 한 번 더)
async function readStatus(root) {
  const out = await git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const staged = [], unstaged = [], conflicted = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const x = p[0], y = p[1], file = p.slice(3);
    if (x === "R" || x === "C") i++; // 원래 경로 건너뛰기
    const unmerged = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    if (unmerged) conflicted.push(file);
    else if (x === "?" && y === "?") unstaged.push(file);
    else {
      if (x !== " ") staged.push(file);
      if (y !== " " && !staged.includes(file)) unstaged.push(file);
    }
  }
  return { staged, unstaged, conflicted };
}

async function readFiles(root) {
  const out = await git(root, ["ls-files", "-z"], { allowFail: true });
  return out ? out.split("\0").filter(Boolean).slice(0, MAX_FILES) : [];
}

async function readStash(root) {
  const out = await git(root, ["stash", "list", `--format=%gd${US}%s`], { allowFail: true });
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((l) => {
    const [ref, msg] = l.split(US);
    return { id: ref, msg, branch: (msg.match(/^(?:WIP on|On) ([^:]+):/) || [])[1] || "", staged: [], unstaged: [] };
  });
}

// 진행 중인 작업 (1단계에서는 표시만 한다)
function readOp(root) {
  const g = path.join(root, ".git");
  const has = (f) => fs.existsSync(path.join(g, f));
  if (has("rebase-merge") || has("rebase-apply")) return "rebase";
  if (has("MERGE_HEAD")) return "merge";
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (has("REVERT_HEAD")) return "revert";
  return null;
}

async function readRemotes(root) {
  const out = await git(root, ["remote", "-v"], { allowFail: true });
  const map = {};
  for (const line of (out || "").split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (m && m[3] === "fetch") map[m[1]] = m[2];
  }
  return Object.entries(map).map(([name, url]) => ({ name, url }));
}

async function readRepo(dir) {
  const root = await repoRoot(dir);
  if (!root) throw new Error(`git 저장소가 아닙니다: ${dir}`);
  const { commits, truncated } = await readCommits(root);
  const [refs, headInfo, working, files, stash, remoteList] = await Promise.all([
    readRefs(root, commits), readHead(root), readStatus(root), readFiles(root), readStash(root), readRemotes(root),
  ]);
  return {
    root,
    repoName: path.basename(root),
    commits,
    truncated,
    branches: refs.branches,
    remotes: refs.remotes,
    upstream: refs.upstream,
    remoteList,
    head: headInfo.head,
    detached: headInfo.detached,
    files,
    working,
    stash,
    op: null,
    gitOp: readOp(root),
    born: {},
  };
}

module.exports = { git, gitRaw, repoRoot, readRepo, readStatus };
