// 작업 영역 조작: stage · 변경 버리기 · 커밋 · amend · 메시지 수정 · stash
import fs from "node:fs";
import path from "node:path";
import { git, gitRaw } from "@/git/cli";
import { gitDir, readOpKind, writeStashMark } from "@/git/opState";
import { commitMsgHook, preCommitHook, verifyArgs, withHooks } from "@/git/hooks";
import { commitTree as newCommit } from "@/git/sign";
import { statusRows } from "@/git/status";
import { backup, headInfo, rev, short, spec, under, unsupported, type OpContext, type OpFn } from "@/git/ops/context";
import { runOrStop, stashList } from "@/git/ops/conflictOps";
import { chain, commitInfo, commitTree, conflictError, firstParentRange } from "@/git/ops/historyOps";
import { t } from "@shared/i18n/i18n";

/** git commit 이 부르는 hook (실패하면 이 중 설치된 것이 막았을 수 있다) */
const COMMIT_HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg"];

const hasStaged = async (root: string) => (await statusRows(root)).some((r) => r.x !== " " && r.x !== "?");

const stageFiles: OpFn = async (ctx, [paths, to]: [string[], "staged" | "unstaged"]) => {
  if (to === "staged") await ctx.run(["add", "-A", "--", ...spec(paths)]);
  else await ctx.run(["restore", "--staged", "--", ...spec(paths)]);
};

const discard: OpFn = async (ctx, [paths]: [string[]]) => {
  const rows = await statusRows(ctx.root);
  const hit = rows.filter((r) => paths.some((p) => under(r.file, p)));
  const untracked = hit.filter((r) => r.x === "?").map((r) => r.file);
  const tracked = hit.filter((r) => r.x !== "?" && r.x !== "A").map((r) => r.file);
  const added = hit.filter((r) => r.x === "A").map((r) => r.file); // 새로 추가만 된 파일: index 에서 빼고 지운다
  if (tracked.length) await ctx.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
  if (added.length) await ctx.run(["rm", "-f", "--", ...added]);
  if (untracked.length) await ctx.run(["clean", "-f", "--", ...untracked]);
};

/**
 * 커밋할 변경을 담은 임시 커밋 (부모 = HEAD). 실제 index 는 건드리지 않고 임시 index 에서 계산한다.
 * paths 지정: 그 경로만 stage 한 상태, 없으면 staged → 없으면 변경 전체. 어디에도 매달리지 않은 객체라 쓰고 버린다.
 */
async function pendingCommit(root: string, head: string, paths: string[] | undefined): Promise<{ id: string; addAll: boolean }> {
  const dir = path.join(await gitDir(root), "ygg-index");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `index-${process.pid}-${Date.now()}`);
  const real = path.join(await gitDir(root), "index");
  if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
  const env = { GIT_INDEX_FILE: tmp };
  try {
    const addAll = !paths && !(await hasStaged(root));
    if (paths) await git(root, ["add", "-A", "--", ...spec(paths)], { env });
    else if (addAll) await git(root, ["add", "-A"], { env });
    const tree = (await git(root, ["write-tree"], { env })).trim();
    const id = (await git(root, ["commit-tree", tree, "-p", head, "-m", "ygg pending"])).trim(); // 버리는 임시 커밋이라 서명하지 않는다
    return { id, addAll };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** pending(부모 HEAD) 의 변경을 onto 위에 적용한 tree. 충돌이면 아무것도 바꾸지 않고 충돌 오류 */
async function applyPending(root: string, head: string, onto: string, pending: string, what: string): Promise<string> {
  const r = await gitRaw(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${head}`, onto, pending]);
  const lines = r.stdout.split("\n");
  if (r.code === 1) throw conflictError(lines.slice(1).filter(Boolean), what);
  if (r.code !== 0) throw new Error(r.stderr.trim() || t("m.mergeTree"));
  return lines[0].trim();
}

/**
 * 체크아웃하지 않은 브랜치에 바로 커밋. 그 브랜치 끝 위에 (HEAD → 커밋할 변경) 을 적용해 새 커밋을 만든다.
 * 작업 폴더는 그대로 두고, 커밋한 변경은 현재 index 에서만 뺀다 (Unstaged 로 남으니 필요 없으면 버리면 된다).
 */
async function commitOther(ctx: OpContext, branch: string, msg: string, paths: string[] | undefined): Promise<void> {
  const { root } = ctx;
  const { tip: head } = await headInfo(root);
  if (!head) throw new Error(t("m.commitNeedsHead"));
  const target = await rev(root, branch);
  // commit-tree 는 hook 을 돌리지 않으므로 git commit 과 같게 pre-commit · commit-msg 를 직접 돌린다 (실패하면 아무것도 바꾸지 않음)
  await preCommitHook(root);
  msg = await commitMsgHook(root, msg);
  const { id: pending, addAll } = await pendingCommit(root, head, paths);
  const tree = await applyPending(root, head, target, pending, msg.split("\n")[0]);
  const created = await newCommit(root, tree, [target], msg);
  await backup(root, branch, target);
  await git(root, ["update-ref", `refs/heads/${branch}`, created, target]);
  ctx.note(`git commit -m ${JSON.stringify(msg)}  # ${t("m.n.commitOther", { branch })}`);
  if (paths) await ctx.run(["reset", "-q", "--", ...spec(paths)]);
  else if (!addAll) await ctx.run(["reset", "-q"]);
}

const commitTo: OpFn = async (ctx, [branch, msg, paths]: [string, string, string[] | undefined]) => {
  const { branch: cur } = await headInfo(ctx.root);
  const op = readOpKind(ctx.root);
  // 브랜치 없이(detached) 커밋하는 경우: 커밋 분할 등 rebase 도중이거나 과거 커밋을 임시로 체크아웃한 상태
  const detachedOk = !cur && (branch === "HEAD" || op === "rebase");
  if (branch !== cur && !detachedOk) {
    if (op || branch === "HEAD") unsupported(t("m.u.commitOther"));
    await commitOther(ctx, branch, msg, paths);
    return;
  }
  if (paths) {
    await ctx.run(["add", "-A", "--", ...spec(paths)]);
    await withHooks(ctx.root, COMMIT_HOOKS, async () => ctx.run(["commit", ...(await verifyArgs(ctx.root)), "-m", msg, "--", ...spec(paths)]));
    return;
  }
  if (!(await hasStaged(ctx.root))) await ctx.run(["add", "-A"]);
  await withHooks(ctx.root, COMMIT_HOOKS, async () => ctx.run(["commit", ...(await verifyArgs(ctx.root)), "-m", msg]));
};

/**
 * 과거 커밋 id 에 커밋할 변경을 합치고(fixup), 그 뒤 커밋들을 메모리에서 다시 올린다 (작업 폴더는 건드리지 않음).
 * merge 커밋은 merge 로 다시 만든다. 충돌 · 현재 브랜치 밖의 커밋이면 아무것도 바꾸지 않고 거절한다.
 * 끝나면 HEAD 만 옮기고(reset --soft) index 는 그대로라, 합친 변경은 Staged 에서 사라진다.
 */
async function fixupPast(ctx: OpContext, id: string, branch: string, tip: string, paths: string[] | undefined): Promise<void> {
  const { root } = ctx;
  if (readOpKind(root)) unsupported(t("m.u.fixup"));
  const inBranch = (await gitRaw(root, ["merge-base", "--is-ancestor", id, tip])).code === 0;
  if (!inBranch) throw new Error(t("m.fixupNotInBranch", { branch }));
  const c = await commitInfo(root, id);
  await preCommitHook(root); // git commit --fixup 처럼 pre-commit 을 돌린다 (메시지는 원래 커밋 그대로라 commit-msg 는 없음)
  const { id: pending } = await pendingCommit(root, tip, paths);
  const tree = await applyPending(root, tip, id, pending, c.msg.split("\n")[0]);
  const folded = await commitTree(root, tree, c.parents, c);
  const next = (await chain(root, folded, (await firstParentRange(root, id, tip)).map((x) => ({ id: x }))))!;
  await backup(root, `fixup-${branch}`, tip);
  ctx.note(`git commit --fixup ${short(id)} && git rebase -i --autosquash ${short(id)}~1  # ${t("m.n.fixupPast", { id: short(id) })}`);
  if (paths) await ctx.run(["add", "-A", "--", ...spec(paths)]);
  else if (!(await hasStaged(root))) await ctx.run(["add", "-A"]);
  await ctx.run(["reset", "--soft", next]);
}

const amendInto: OpFn = async (ctx, [id, _msg, paths]: [string, string, string[] | undefined]) => {
  const { branch, tip } = await headInfo(ctx.root);
  if (id !== tip) {
    if (!branch || !tip) unsupported(t("m.u.fixup"));
    await fixupPast(ctx, id, branch, tip, paths);
    return;
  }
  await backup(ctx.root, "amend", tip);
  if (paths) await ctx.run(["add", "-A", "--", ...spec(paths)]);
  else if (!(await hasStaged(ctx.root))) await ctx.run(["add", "-A"]);
  await withHooks(ctx.root, COMMIT_HOOKS, async () => ctx.run(["commit", "--amend", ...(await verifyArgs(ctx.root)), "--no-edit"]));
};

/** 커밋 메시지 수정. HEAD 면 amend, 과거 커밋이면 같은 내용·작성자로 새 커밋을 만들고 그 뒤 커밋들을 다시 올린다. */
const reword: OpFn = async (ctx: OpContext, [id, msg]: [string, string]) => {
  const { root } = ctx;
  const { branch, tip } = await headInfo(root);
  if (!branch) throw new Error(t("m.rewordNeedsBranch"));
  if (id === tip) {
    await backup(root, `reword-${branch}`, tip);
    await withHooks(ctx.root, COMMIT_HOOKS, async () => ctx.run(["commit", "--amend", ...(await verifyArgs(root)), "--only", "-m", msg]));
    return;
  }
  const isAnc = await git(root, ["merge-base", "--is-ancestor", id, "HEAD"], { allowFail: true });
  if (isAnc === null) throw new Error(t("m.rewordOnlyHead", { branch }));
  msg = await commitMsgHook(root, msg); // 새로 쓴 메시지: git commit --amend 처럼 commit-msg 를 돌린다
  await backup(root, `reword-${branch}`, tip);
  const [tree, parents, an, ae, ad] = (await git(root, ["show", "-s", "--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI", id])).trim().split("\x1f");
  const env = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad };
  const created = await newCommit(root, tree, parents ? parents.split(" ") : [], msg, { env, run: ctx.run });
  // 메시지만 바뀌었으므로 내용 충돌은 없다. 작업 영역 변경은 autostash 로 보존
  await ctx.run(["rebase", "--rebase-merges", "--autostash", "--onto", created, id, branch]);
};

const stashPush: OpFn = async (ctx, [msg]: [string | undefined]) => {
  await ctx.run(["stash", "push", "-u", ...(msg ? ["-m", msg] : [])]);
};
const stashPop: OpFn = async (ctx, [idx, keep]: [number, boolean]) => {
  const s = (await stashList(ctx.root))[idx];
  if (!s) throw new Error(t("m.noStash", { idx }));
  // 충돌로 멈추면 어떤 stash 였는지 남겨 두어, 해결 뒤 지우거나 중단할 때 쓴다
  await writeStashMark(ctx.root, { oid: s.oid, msg: s.msg, keep });
  try {
    if (!(await runOrStop(ctx, ["stash", keep ? "apply" : "pop", `stash@{${idx}}`]))) await writeStashMark(ctx.root, null);
  } catch (err) {
    await writeStashMark(ctx.root, null);
    throw err;
  }
};
const stashDrop: OpFn = async (ctx, [idx]: [number]) => {
  const s = (await stashList(ctx.root))[idx];
  await ctx.run(["stash", "drop", `stash@{${idx}}`]);
  if (s) ctx.droppedStash = s;
};

export const workingOps = { stageFiles, discard, commitTo, amendInto, reword, stashPush, stashPop, stashDrop };
