// ops.js — 화면에서 고른 조작을 실제 git 명령으로 실행한다 (2단계)
// 화면은 목업 모델로 미리보기만 계산하고, 실행할 때는 { op, args } 만 보낸다.
// 각 조작은 실행한 명령 목록을 돌려준다. 실패하면 git 의 오류 메시지를 그대로 담아 던진다.
const { git, gitRaw } = require("./git");

const NET = { timeout: 120000, net: true }; // 네트워크 명령 (fetch/pull/push): GitHub 로그인 토큰을 붙인다
const github = require("./github");

// 경로 목록 → git pathspec ("" 는 저장소 전체)
const spec = (paths) => (paths || [""]).map((p) => (p === "" ? "." : p));

async function headInfo(root) {
  const branch = (await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true }) || "").trim() || null;
  const tip = (await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true }) || "").trim() || null;
  return { branch, tip };
}

async function status(root) {
  const out = await git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const rows = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    rows.push({ x: p[0], y: p[1], file: p.slice(3) });
    if (p[0] === "R" || p[0] === "C") i++;
  }
  return rows;
}

const under = (f, p) => p === "" || f === p || f.startsWith(p + "/");

// 되돌릴 수 있게 브랜치 위치를 백업 ref 로 남긴다 (refs/yggdrasil/backup/...)
async function backup(root, label, oid) {
  if (!oid) return null;
  const ref = `refs/yggdrasil/backup/${Date.now()}-${label.replace(/[^\w.-]+/g, "_")}`;
  await git(root, ["update-ref", ref, oid]);
  return ref;
}

function unsupported(what) {
  const e = new Error(`${what}은(는) 아직 실제 저장소에서 지원하지 않습니다. 미리보기만 됩니다.`);
  e.unsupported = true;
  throw e;
}

// 실행 + 기록
function runner(root) {
  const cmds = [];
  const note = (line) => cmds.push(line); // 내부 plumbing 대신 사람이 읽을 대응 명령을 기록
  const warnings = [];
  const warn = (msg) => { warnings.push(msg); cmds.push(`# 경고: ${msg}`); };
  const run = async (args, opts) => {
    cmds.push("git " + args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ")); // 기록에는 토큰 설정을 넣지 않는다
    if (opts && opts.net) {
      const a = await github.gitAuth().catch(() => null);
      if (a) return git(root, [...a.args, ...args], { ...opts, env: { ...(opts.env || {}), ...a.env } });
    }
    return git(root, args, opts);
  };
  return { cmds, run, note, warn, warnings };
}

const OPS = {
  async stageFiles(root, run, [paths, to]) {
    if (to === "staged") await run(["add", "-A", "--", ...spec(paths)]);
    else await run(["restore", "--staged", "--", ...spec(paths)]);
  },

  async discard(root, run, [paths]) {
    const rows = await status(root);
    const hit = rows.filter((r) => paths.some((p) => under(r.file, p)));
    const untracked = hit.filter((r) => r.x === "?").map((r) => r.file);
    const tracked = hit.filter((r) => r.x !== "?" && r.x !== "A").map((r) => r.file);
    const added = hit.filter((r) => r.x === "A").map((r) => r.file); // 새로 추가만 된 파일: index 에서 빼고 지운다
    if (tracked.length) await run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
    if (added.length) await run(["rm", "-f", "--", ...added]);
    if (untracked.length) await run(["clean", "-f", "--", ...untracked]);
  },

  async commitTo(root, run, [branch, msg, paths]) {
    const { branch: cur } = await headInfo(root);
    if (branch !== cur) unsupported("체크아웃하지 않은 브랜치에 바로 커밋하기");
    if (paths) {
      await run(["add", "-A", "--", ...spec(paths)]);
      await run(["commit", "-m", msg, "--", ...spec(paths)]);
      return;
    }
    const staged = (await status(root)).some((r) => r.x !== " " && r.x !== "?");
    if (!staged) await run(["add", "-A"]);
    await run(["commit", "-m", msg]);
  },

  async amendInto(root, run, [id, _msg, paths]) {
    const { tip } = await headInfo(root);
    if (id !== tip) unsupported("과거 커밋에 변경 합치기(fixup)");
    await backup(root, "amend", tip);
    if (paths) await run(["add", "-A", "--", ...spec(paths)]);
    else {
      const staged = (await status(root)).some((r) => r.x !== " " && r.x !== "?");
      if (!staged) await run(["add", "-A"]);
    }
    await run(["commit", "--amend", "--no-edit"]);
  },

  // 커밋 메시지 수정. HEAD 면 amend, 과거 커밋이면 같은 내용·작성자로 새 커밋을 만들고 그 뒤 커밋들을 다시 올린다.
  async reword(root, run, [id, msg]) {
    const { branch, tip } = await headInfo(root);
    if (!branch) throw new Error("브랜치를 체크아웃한 상태에서만 메시지를 바꿀 수 있습니다.");
    if (id === tip) {
      await backup(root, `reword-${branch}`, tip);
      await run(["commit", "--amend", "--only", "-m", msg]);
      return;
    }
    const isAnc = await git(root, ["merge-base", "--is-ancestor", id, "HEAD"], { allowFail: true });
    if (isAnc === null) throw new Error(`현재 브랜치(${branch})에 있는 커밋만 메시지를 바꿀 수 있습니다. 먼저 그 브랜치로 checkout 하세요.`);
    await backup(root, `reword-${branch}`, tip);
    const fmt = (await git(root, ["show", "-s", "--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI", id])).trim().split("\x1f");
    const [tree, parents, an, ae, ad] = fmt;
    const env = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad };
    const pArgs = parents ? parents.split(" ").flatMap((p) => ["-p", p]) : [];
    const created = (await run(["commit-tree", tree, ...pArgs, "-m", msg], { env })).trim();
    // 메시지만 바뀌었으므로 내용 충돌은 없다. 작업 영역 변경은 autostash 로 보존
    await run(["rebase", "--rebase-merges", "--autostash", "--onto", created, id, branch]);
  },

  async checkout(root, run, [name]) {
    await run(["switch", name]);
  },

  async switchCreate(root, run, [name]) {
    await run(["switch", "-c", name]);
  },

  async createBranch(root, run, [name, id]) {
    await run(["branch", name, id]);
  },

  // 이름 바꾸기. withRemote 면 원격에도 새 이름으로 올리고 옛 이름을 지운다.
  async renameBranch(root, run, [from, to, withRemote], _extra, _note, warn) {
    const up = (await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${from}@{u}`], { allowFail: true }) || "").trim();
    await run(["branch", "-m", from, to]);
    if (withRemote && up) {
      const [remote, ...rest] = up.split("/");
      await run(["push", "-u", remote, `${to}:${to}`], NET);
      try {
        await run(["push", remote, "--delete", rest.join("/")], NET);
      } catch (err) {
        // 원격의 기본 브랜치는 지울 수 없다 (GitHub 포함). 새 이름은 이미 올렸으니 실패로 치지 않는다.
        if (/refusing to delete the current branch|default branch/i.test(err.stderr || "")) {
          warn(`${up} 는 원격의 기본 브랜치라 지우지 못했습니다. GitHub 저장소 설정에서 기본 브랜치를 ${to} 로 바꾼 뒤 ${up} 를 지우세요.`);
        } else throw err;
      }
    }
  },

  // 원격에만 있는 브랜치를 같은 이름의 로컬 브랜치로 가져와 체크아웃
  async checkoutRemote(root, run, [remoteBranch]) {
    const name = remoteBranch.split("/").slice(1).join("/");
    const exists = await git(root, ["rev-parse", "--verify", "-q", `refs/heads/${name}`], { allowFail: true });
    if (exists) throw new Error(`로컬에 이미 ${name} 브랜치가 있습니다. 그 브랜치로 checkout 하세요.`);
    await run(["switch", "--track", "-c", name, remoteBranch]);
  },

  async deleteBranch(root, run, [name]) {
    // 병합되지 않은 브랜치는 git 이 거절한다 (-d). 강제 삭제는 일부러 막아 둔다.
    await run(["branch", "-d", name]);
  },

  async fetch(root, run) {
    await run(["fetch", "--all", "--prune"], NET);
  },

  async pull(root, run, [branch, mode, remote]) {
    const { branch: cur } = await headInfo(root);
    if (branch !== cur) unsupported("체크아웃하지 않은 브랜치에 pull 하기");
    const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFail: true });
    const rebase = mode === "rebase" ? "--rebase" : "--no-rebase";
    const warn = arguments[5];
    if (up && (!remote || remote === up.trim())) await runOrStop(root, run, ["pull", rebase], warn, NET);
    else {
      const [rname, ...rest] = (remote || `origin/${branch}`).split("/");
      await runOrStop(root, run, ["pull", rebase, rname, rest.join("/")], warn, NET);
    }
  },

  async push(root, run, [branch], extra) {
    const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`], { allowFail: true });
    const force = extra && extra.force ? ["--force-with-lease"] : [];
    if (up) {
      const [rname, ...rest] = up.trim().split("/");
      await run(["push", ...force, rname, `${branch}:${rest.join("/")}`], NET);
    } else {
      const remotes = (await git(root, ["remote"])).split("\n").filter(Boolean);
      if (!remotes.length) {
        const e = new Error("연결된 원격 저장소가 없습니다. 원격 주소를 먼저 추가하세요.");
        e.code = "NO_REMOTE";
        throw e;
      }
      await run(["push", ...force, "-u", remotes.includes("origin") ? "origin" : remotes[0], branch], NET);
    }
  },

  // 원격 관리
  async remoteAdd(root, run, [name, url]) {
    await run(["remote", "add", name, url]);
    await run(["fetch", name], NET);
  },
  async remoteSetUrl(root, run, [name, url]) {
    await run(["remote", "set-url", name, url]);
  },
  async remoteRemove(root, run, [name]) {
    await run(["remote", "remove", name]);
  },

  async stashPush(root, run, [msg]) {
    await run(["stash", "push", "-u", ...(msg ? ["-m", msg] : [])]);
  },
  async stashPop(root, run, [idx, keep]) {
    await run(["stash", keep ? "apply" : "pop", `stash@{${idx}}`]);
  },
  async stashDrop(root, run, [idx]) {
    await run(["stash", "drop", `stash@{${idx}}`]);
  },
};

// ---------- 3단계: 히스토리 조작 ----------
// 작업 폴더를 건드리지 않고 merge-tree + commit-tree 로 새 커밋을 계산한다.
// 충돌이 하나라도 있으면 아무 ref 도 바꾸지 않고 충돌 파일을 알려 준다 (해결 화면은 4단계).

const rev = async (root, r) => (await git(root, ["rev-parse", "--verify", `${r}^{commit}`])).trim();
const short = (oid) => oid.slice(0, 7);

async function commitInfo(root, id) {
  const out = await git(root, ["show", "-s", "--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B", id]);
  const [tree, parents, an, ae, ad, ...msg] = out.split("\x1f");
  return { id, tree, parents: parents ? parents.split(" ") : [], an, ae, ad, msg: msg.join("\x1f").replace(/\n+$/, "") };
}

function conflictError(files, what) {
  const e = new Error(`충돌: ${files.join(", ")} — "${what}" 을(를) 적용하다 충돌이 나서 아무것도 바꾸지 않았습니다.`);
  e.conflicts = files;
  return e;
}

// 체크아웃하지 않은 브랜치에서 충돌: 그 브랜치로 체크아웃해야 충돌을 풀며 진행할 수 있다
function needsCheckout(err, branch) {
  err.code = "NEEDS_CHECKOUT";
  err.branch = branch;
  err.message += ` ${branch} 로 체크아웃하면 충돌을 해결하며 진행할 수 있습니다.`;
  return err;
}

async function commitTree(root, tree, parents, c, msg = c.msg) {
  const env = { GIT_AUTHOR_NAME: c.an, GIT_AUTHOR_EMAIL: c.ae, GIT_AUTHOR_DATE: c.ad };
  return (await git(root, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", msg], { env })).trim();
}

// base→c 의 변경을 tip 위에 적용한 tree 를 계산한다
async function applyTree(root, tip, c) {
  if (c.parents.length > 1) throw new Error(`merge 커밋 ${short(c.id)} 은 아직 옮기거나 다시 쓸 수 없습니다.`);
  if (!c.parents.length) throw new Error(`첫 커밋 ${short(c.id)} 은 옮길 수 없습니다.`);
  const r = await gitRaw(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${c.parents[0]}`, tip, c.id]);
  const lines = r.stdout.split("\n");
  if (r.code === 1) throw conflictError(lines.slice(1).filter(Boolean), c.msg.split("\n")[0]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "merge-tree 실패");
  return lines[0].trim();
}

// items: [{ id, fixup? }] 을 onto 위에 차례로 쌓는다. fixup 은 직전 커밋에 합친다.
async function chain(root, onto, items) {
  let tip = onto;
  let tipInfo = null;
  for (const it of items) {
    const c = await commitInfo(root, it.id);
    const tree = await applyTree(root, tip, c);
    if (it.fixup && tipInfo) {
      tip = await commitTree(root, tree, tipInfo.parents, tipInfo);
      tipInfo = { ...tipInfo, id: tip, tree };
    } else {
      tip = await commitTree(root, tree, [tip], c, it.msg || c.msg);
      tipInfo = { ...c, id: tip, tree, parents: [tipInfo ? tipInfo.id : onto] };
    }
  }
  return tip;
}

// 첫 부모만 따라간 base..tip 의 커밋 (오래된 것부터)
async function firstParentRange(root, base, tip) {
  const out = await git(root, ["rev-list", "--reverse", "--first-parent", base ? `${base}..${tip}` : tip]);
  return out.split("\n").filter(Boolean);
}

// 브랜치를 옮긴다. 현재 브랜치면 작업 영역도 맞춘다 (로컬 변경은 보존, 겹치면 git 이 거절)
async function setBranch(root, run, branch, newOid, oldOid) {
  const { branch: cur } = await headInfo(root);
  await backup(root, branch, oldOid);
  if (branch === cur) await run(["reset", "--keep", newOid]);
  else await git(root, ["update-ref", `refs/heads/${branch}`, newOid, oldOid]);
}

const HISTORY = {
  async cherryPick(root, run, [ids, branch], extra, note, warn) {
    const tip = await rev(root, branch);
    let next;
    try {
      next = await chain(root, tip, ids.map((id) => ({ id })));
    } catch (err) {
      // 충돌: 현재 브랜치면 실제 cherry-pick 으로 멈추고 해결 모드로, 아니면 체크아웃이 필요하다고 알린다
      if (!err.conflicts) throw err;
      if (branch !== (await headInfo(root)).branch) throw needsCheckout(err, branch);
      await runOrStop(root, run, ["cherry-pick", ...ids], warn);
      return;
    }
    note(`git cherry-pick ${ids.map(short).join(" ")}  # ${branch} 에, 체크아웃 없이`);
    await setBranch(root, run, branch, next, tip);
  },

  async moveCommit(root, run, [id, branch], extra, note) {
    const from = extra && extra.from;
    if (!from) throw new Error("커밋이 속한 브랜치를 알 수 없습니다.");
    const c = await commitInfo(root, id);
    const dstTip = await rev(root, branch), srcTip = await rev(root, from);
    const moved = await chain(root, dstTip, [{ id }]);
    const rest = await firstParentRange(root, id, srcTip);
    const left = await chain(root, c.parents[0], rest.map((x) => ({ id: x })));
    note(`git cherry-pick ${short(id)}  # → ${branch}`);
    note(`git rebase --onto ${short(id)}~1 ${short(id)} ${from}  # ${from} 에서 빼기`);
    await setBranch(root, run, branch, moved, dstTip);
    await setBranch(root, run, from, left, srcTip);
  },

  async dropCommit(root, run, [id], extra, note) {
    const from = extra && extra.from;
    if (!from) throw new Error("커밋이 속한 브랜치를 알 수 없습니다.");
    const c = await commitInfo(root, id);
    const tip = await rev(root, from);
    const rest = await firstParentRange(root, id, tip);
    const next = await chain(root, c.parents[0], rest.map((x) => ({ id: x })));
    note(`git rebase --onto ${short(id)}~1 ${short(id)} ${from}  # ${short(id)} 제거`);
    await setBranch(root, run, from, next, tip);
  },

  async rebaseStem(root, run, [branch, onto], extra, note, warn) {
    const base = extra && extra.base;
    if (!base) throw new Error("이 브랜치의 시작점을 알 수 없습니다.");
    const tip = await rev(root, branch);
    const list = await firstParentRange(root, base, tip);
    let next;
    try {
      next = await chain(root, onto, list.map((id) => ({ id })));
    } catch (err) {
      if (!err.conflicts) throw err;
      if (branch !== (await headInfo(root)).branch) throw needsCheckout(err, branch);
      await backup(root, branch, tip);
      await runOrStop(root, run, ["rebase", "--autostash", "--onto", onto, base, branch], warn);
      return;
    }
    note(`git rebase --onto ${short(onto)} ${short(base)} ${branch}`);
    await setBranch(root, run, branch, next, tip);
  },

  async squash(root, run, [src, dst], extra, note) {
    const from = extra && extra.from;
    const tip = await rev(root, from);
    const srcFirst = (await gitRaw(root, ["merge-base", "--is-ancestor", src, dst])).code === 0;
    const first = srcFirst ? src : dst;
    const base = (await commitInfo(root, first)).parents[0];
    const list = await firstParentRange(root, base, tip);
    const items = [];
    for (const id of list) {
      if (id === src) continue;
      items.push({ id });
      if (id === dst) items.push({ id: src, fixup: true });
    }
    const next = await chain(root, base, items);
    note(`git rebase -i ${short(base)}  # ${short(src)} 을 ${short(dst)} 에 fixup`);
    await setBranch(root, run, from, next, tip);
  },

  async reorder(root, run, [id, branch, index], extra, note) {
    const stem = extra && extra.stem, base = extra && extra.base;
    if (!stem || !base) throw new Error("줄기 정보를 알 수 없습니다.");
    const from = stem.indexOf(id);
    const order = stem.filter((c) => c !== id);
    order.splice(index > from ? index - 1 : index, 0, id);
    const tip = await rev(root, branch);
    const next = await chain(root, base, order.map((c) => ({ id: c })));
    note(`git rebase -i ${short(base)}  # ${short(id)} 순서 변경`);
    await setBranch(root, run, branch, next, tip);
  },

  async revertCommit(root, run, [id], _e, _n, warn) {
    await runOrStop(root, run, ["revert", "--no-edit", id], warn);
  },

  async moveBranch(root, run, [branch, id]) {
    const { branch: cur } = await headInfo(root);
    const old = await rev(root, branch);
    await backup(root, branch, old);
    if (branch === cur) await run(["reset", "--keep", id]);
    else await run(["branch", "-f", branch, id]);
  },

  async resetHead(root, run, [id, mode]) {
    const { tip } = await headInfo(root);
    await backup(root, "reset", tip);
    await run(["reset", `--${mode || "mixed"}`, id]);
  },

  async merge(root, run, [src, dst], extra, note, warn) {
    const { branch: cur } = await headInfo(root);
    if (dst === cur) {
      await runOrStop(root, run, ["merge", "--no-edit", src], warn);
      return;
    }
    const a = await rev(root, dst), b = await rev(root, src);
    if ((await gitRaw(root, ["merge-base", "--is-ancestor", a, b])).code === 0) {
      note(`git fetch . ${src}:${dst}  # fast-forward, 체크아웃 없이`);
      await setBranch(root, run, dst, b, a);
      return;
    }
    const r = await gitRaw(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b]);
    const lines = r.stdout.split("\n");
    if (r.code === 1) throw needsCheckout(conflictError(lines.slice(1).filter(Boolean), `merge ${src} → ${dst}`), dst);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    const me = await commitInfo(root, a);
    const id = (await git(root, ["commit-tree", lines[0].trim(), "-p", a, "-p", b, "-m", `Merge branch '${src}' into ${dst}`])).trim();
    void me;
    note(`git merge ${src}  # ${dst} 에, 체크아웃 없이`);
    await setBranch(root, run, dst, id, a);
  },
};
Object.assign(OPS, HISTORY);

// ---------- 4단계: 충돌 해결과 진행 중 작업 ----------
const { readOp, recordConflicts } = require("./git");
const fsx = require("node:fs");
const pathx = require("node:path");

let opener = null; // 파일을 에디터로 여는 함수 (main 에서 shell.openPath 를 넣어 준다)
function setOpener(fn) { opener = fn; }

async function unmergedFiles(root) {
  const out = await git(root, ["diff", "--name-only", "--diff-filter=U", "-z"], { allowFail: true });
  return (out || "").split("\0").filter(Boolean);
}

const hasMarkers = (root, file) => {
  try { return /^(<{7}|>{7}) /m.test(fsx.readFileSync(pathx.join(root, file), "utf8")); } catch { return false; }
};

// 실제 git 명령을 실행하다 충돌로 멈추면, 실패가 아니라 "진행 중" 으로 남기고 알린다
async function runOrStop(root, run, args, warn, opts) {
  try {
    await run(args, opts);
    return false;
  } catch (err) {
    if (readOp(root) || (await unmergedFiles(root)).length) {
      const files = await recordConflicts(root);
      warn(`충돌로 멈췄습니다 (${files.join(", ")}). 오른쪽 패널에서 해결한 뒤 위 배너의 계속을 누르세요.`);
      return true;
    }
    throw err;
  }
}

Object.assign(OPS, {
  // choice: ours(A 쪽) · theirs(B 쪽) · both(에디터에서 직접 고치기 → 다시 누르면 해결 완료)
  async resolveFile(root, run, [file, choice], _e, _n, warn) {
    const unmerged = await unmergedFiles(root);
    if (!unmerged.includes(file) && !(choice === "both" && hasMarkers(root, file))) {
      throw new Error(`${file} 은(는) 충돌 중인 파일이 아닙니다.`);
    }
    if (choice === "both") {
      if (hasMarkers(root, file)) {
        if (opener) opener(pathx.join(root, file));
        warn(`${file} 을(를) 에디터로 열었습니다. <<<<<<< ======= >>>>>>> 표시를 정리하고 저장한 뒤 다시 "직접 편집" 을 누르면 해결로 표시합니다.`);
        return;
      }
      await run(["add", "--", file]);
      return;
    }
    try {
      await run(["checkout", `--${choice}`, "--", file]);
      await run(["add", "--", file]);
    } catch (err) {
      // 한쪽에서 지운 파일: 그쪽을 고르면 삭제가 해결이다
      if (/does not have (our|their) version/.test(err.stderr || "")) await run(["rm", "-q", "--", file]);
      else throw err;
    }
  },

  async continueOp(root, run, _a, _e, _n, warn) {
    const left = await unmergedFiles(root);
    if (left.length) throw new Error(`아직 해결하지 않은 파일이 있습니다: ${left.join(", ")}`);
    const kind = readOp(root);
    const marker = (await git(root, ["diff", "--cached", "--name-only", "-z"], { allowFail: true }) || "").split("\0").filter((f) => f && hasMarkers(root, f));
    if (marker.length) throw new Error(`충돌 표시(<<<<<<<)가 남아 있는 파일이 있습니다: ${marker.join(", ")}`);
    if (kind === "rebase") await runOrStop(root, run, ["rebase", "--continue"], warn);
    else if (kind === "merge") await run(["commit", "--no-edit"]);
    else if (kind === "cherry-pick") await runOrStop(root, run, ["cherry-pick", "--continue"], warn);
    else if (kind === "revert") await runOrStop(root, run, ["revert", "--continue"], warn);
    // kind 가 없으면 (stash 충돌 등) 파일 정리만으로 끝
  },

  async skipOp(root, run, _a, _e, _n, warn) {
    const kind = readOp(root);
    if (kind === "rebase") await runOrStop(root, run, ["rebase", "--skip"], warn);
    else if (kind === "cherry-pick") await runOrStop(root, run, ["cherry-pick", "--skip"], warn);
    else throw new Error("건너뛸 수 있는 작업이 아닙니다.");
  },

  async abortOp(root, run) {
    const kind = readOp(root);
    if (kind === "rebase") await run(["rebase", "--abort"]);
    else if (kind === "merge") await run(["merge", "--abort"]);
    else if (kind === "cherry-pick") await run(["cherry-pick", "--abort"]);
    else if (kind === "revert") await run(["revert", "--abort"]);
    else throw new Error("중단할 진행 중 작업이 없습니다. 충돌 파일은 A 쪽이나 B 쪽을 골라 정리하세요.");
  },
});

// ---------- 되돌리기 ----------
// 조작 전후의 브랜치 위치를 비교해 바뀐 것만 기록한다. (stage·변경 버리기처럼 브랜치가 안 바뀌는 조작은 되돌릴 수 없음)
const undoStacks = new Map(); // root → [{ op, before, after, head }]

async function snapshot(root) {
  // for-each-ref 는 %x1f 표기를 모르므로 실제 구분 문자를 넣는다
  const out = await git(root, ["for-each-ref", "--format=%(refname:short)\x1f%(objectname)", "refs/heads"]);
  const heads = {};
  out.split("\n").filter(Boolean).forEach((l) => { const [b, o] = l.split("\x1f"); heads[b] = o; });
  const { branch } = await headInfo(root);
  return { heads, head: branch };
}

// 커밋류는 되돌려도 변경 내용을 Staged 로 남긴다. 나머지는 작업 영역까지 이전 상태로.
const SOFT_UNDO = new Set(["commitTo", "amendInto", "reword"]);

OPS.undo = async (root, run, _args, _extra, note) => {
  const stack = undoStacks.get(root) || [];
  const last = stack.pop();
  if (!last) throw new Error("되돌릴 작업이 없습니다. (브랜치 위치를 바꾼 조작만 되돌릴 수 있습니다)");
  if (last.op === "renameBranch") { // 이름 변경은 이름만 되돌린다 (원격에 반영한 것은 그대로)
    await run(["branch", "-m", last.args[1], last.args[0]]);
    note("# 되돌림: 브랜치 이름 변경 (원격은 그대로)");
    undoStacks.set(root, stack);
    return;
  }
  const now = await snapshot(root);
  if (last.head && now.head !== last.head && last.before.heads[last.head]) await run(["switch", last.head]);
  const names = new Set([...Object.keys(last.before.heads), ...Object.keys(last.after.heads)]);
  for (const b of names) {
    const was = last.before.heads[b], is = last.after.heads[b];
    if (was === is) continue;
    const cur = (await snapshot(root));
    if (!was) { // 조작으로 생긴 브랜치 → 지운다
      if (cur.head === b) throw new Error(`${b} 가 체크아웃되어 있어 지울 수 없습니다.`);
      await run(["branch", "-D", b]);
    } else if (cur.head === b) {
      await run(["reset", SOFT_UNDO.has(last.op) ? "--soft" : "--keep", was]);
    } else {
      await run(["branch", "-f", b, was]);
    }
  }
  note(`# 되돌림: ${last.op}`);
  undoStacks.set(root, stack);
};

async function execute(root, op, args, extra) {
  const fn = OPS[op];
  if (!fn) throw new Error(`알 수 없는 조작: ${op}`);
  const { cmds, run, note, warn, warnings } = runner(root);
  const before = op === "undo" ? null : await snapshot(root).catch(() => null);
  try {
    await fn(root, run, args || [], extra, note, warn);
    if (before) {
      const after = await snapshot(root);
      if (JSON.stringify(after.heads) !== JSON.stringify(before.heads)) {
        const stack = undoStacks.get(root) || [];
        stack.push({ op, args, before, after, head: before.head });
        undoStacks.set(root, stack.slice(-50));
      }
    }
    return { ok: true, cmds, warnings, undoable: (undoStacks.get(root) || []).length };
  } catch (err) {
    return {
      ok: false, cmds, unsupported: !!err.unsupported, conflicts: err.conflicts,
      code: ["NO_REMOTE", "NEEDS_CHECKOUT"].includes(err.code) ? err.code : undefined, branch: err.branch,
      error: err.stderr || String(err.message || err),
    };
  }
}

module.exports = { execute, OPS, setOpener };
