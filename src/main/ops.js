// ops.js — 화면에서 고른 조작을 실제 git 명령으로 실행한다 (2단계)
// 화면은 목업 모델로 미리보기만 계산하고, 실행할 때는 { op, args } 만 보낸다.
// 각 조작은 실행한 명령 목록을 돌려준다. 실패하면 git 의 오류 메시지를 그대로 담아 던진다.
const { git } = require("./git");

const NET = { timeout: 120000 }; // 네트워크 명령 (fetch/pull/push)

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

// 되돌릴 수 있게 브랜치 위치를 백업 ref 로 남긴다 (refs/git-canvas/backup/...)
async function backup(root, label, oid) {
  if (!oid) return null;
  const ref = `refs/git-canvas/backup/${Date.now()}-${label.replace(/[^\w.-]+/g, "_")}`;
  await git(root, ["update-ref", ref, oid]);
  return ref;
}

function unsupported(what) {
  const e = new Error(`${what}은(는) 3단계에서 실제 git 과 연결됩니다. 지금은 미리보기만 됩니다.`);
  e.unsupported = true;
  throw e;
}

// 실행 + 기록
function runner(root) {
  const cmds = [];
  const run = async (args, opts) => {
    cmds.push("git " + args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" "));
    return git(root, args, opts);
  };
  return { cmds, run };
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
    if (up && (!remote || remote === up.trim())) await run(["pull", rebase], NET);
    else {
      const [rname, ...rest] = (remote || `origin/${branch}`).split("/");
      await run(["pull", rebase, rname, rest.join("/")], NET);
    }
  },

  async push(root, run, [branch], extra) {
    const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{u}`], { allowFail: true });
    const force = extra && extra.force ? ["--force-with-lease"] : [];
    if (up) {
      const [rname, ...rest] = up.trim().split("/");
      await run(["push", ...force, rname, `${branch}:${rest.join("/")}`], NET);
    } else await run(["push", ...force, "-u", "origin", branch], NET);
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

// 3단계에서 연결할 조작
for (const name of ["cherryPick", "moveCommit", "rebaseStem", "merge", "squash", "reorder", "dropCommit", "revertCommit", "moveBranch", "resetHead",
  "resolveFile", "continueOp", "skipOp", "abortOp"]) {
  OPS[name] = () => unsupported({
    cherryPick: "cherry-pick", moveCommit: "커밋 옮기기", rebaseStem: "rebase", merge: "merge", squash: "커밋 합치기",
    reorder: "커밋 순서 바꾸기", dropCommit: "커밋 제거", revertCommit: "revert", moveBranch: "브랜치 포인터 옮기기",
    resetHead: "reset", resolveFile: "충돌 해결", continueOp: "계속", skipOp: "건너뛰기", abortOp: "중단",
  }[name]);
}

async function execute(root, op, args, extra) {
  const fn = OPS[op];
  if (!fn) throw new Error(`알 수 없는 조작: ${op}`);
  const { cmds, run } = runner(root);
  try {
    await fn(root, run, args || [], extra);
    return { ok: true, cmds };
  } catch (err) {
    return { ok: false, cmds, unsupported: !!err.unsupported, error: err.stderr || String(err.message || err) };
  }
}

module.exports = { execute, OPS };
