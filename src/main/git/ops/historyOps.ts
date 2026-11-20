// 히스토리 조작: cherry-pick · 커밋 옮기기 · 제거 · rebase · 합치기 · 순서 변경 · revert · merge
// 작업 폴더를 건드리지 않고 merge-tree + commit-tree 로 새 커밋을 계산한다.
// 충돌이 있으면: 현재 브랜치면 실제 git 명령으로 멈추고(해결 모드), 아니면 아무것도 바꾸지 않고 체크아웃이 필요하다고 알린다.
import fs from "node:fs";
import path from "node:path";
import { git, gitRaw } from "@/git/cli";
import { gitDir } from "@/git/opState";
import type { RebaseStep } from "@shared/types/ipc";
import { runOrStop } from "@/git/ops/conflictOps";
import { backup, headInfo, rev, short, type OpContext, type OpError, type OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";

interface CommitInfo {
  id: string;
  tree: string;
  parents: string[];
  an: string;
  ae: string;
  ad: string;
  msg: string;
}

export async function commitInfo(root: string, id: string): Promise<CommitInfo> {
  const out = await git(root, ["show", "-s", "--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B", id]);
  const [tree, parents, an, ae, ad, ...msg] = out.split("\x1f");
  return { id, tree, parents: parents ? parents.split(" ") : [], an, ae, ad, msg: msg.join("\x1f").replace(/\n+$/, "") };
}

function conflictError(files: string[], what: string): OpError {
  const e: OpError = new Error(t("m.conflict", { files: files.join(", "), what }));
  e.conflicts = files;
  return e;
}

/** 체크아웃하지 않은 브랜치에서 충돌: 그 브랜치로 체크아웃해야 충돌을 풀며 진행할 수 있다 */
function needsCheckout(err: OpError, branch: string): OpError {
  err.code = "NEEDS_CHECKOUT";
  err.branch = branch;
  err.message += ` ${t("m.checkoutToResolve", { branch })}`;
  return err;
}

async function commitTree(root: string, tree: string, parents: string[], c: CommitInfo, msg = c.msg): Promise<string> {
  const env = { GIT_AUTHOR_NAME: c.an, GIT_AUTHOR_EMAIL: c.ae, GIT_AUTHOR_DATE: c.ad };
  return (await git(root, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", msg], { env })).trim();
}

/** c 의 변경(부모→c)을 tip 위에 적용한 tree */
async function applyTree(root: string, tip: string, c: CommitInfo): Promise<string> {
  if (c.parents.length > 1) throw new Error(t("m.mergeCommit", { id: short(c.id) }));
  if (!c.parents.length) throw new Error(t("m.rootCommit", { id: short(c.id) }));
  const r = await gitRaw(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${c.parents[0]}`, tip, c.id]);
  const lines = r.stdout.split("\n");
  if (r.code === 1) throw conflictError(lines.slice(1).filter(Boolean), c.msg.split("\n")[0]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || t("m.mergeTree"));
  return lines[0].trim();
}

interface ChainItem {
  id: string;
  /** 직전 커밋에 합친다 */
  fixup?: boolean;
  /** 새 메시지 (fixup 이면 합친 커밋의 메시지) */
  msg?: string;
}

/** items 를 onto 위에 차례로 쌓은 새 끝 커밋 */
async function chain(root: string, onto: string, items: ChainItem[]): Promise<string> {
  let tip = onto;
  let prev = null as CommitInfo | null; // 직전에 만든 커밋 (fixup 대상)
  for (const it of items) {
    const c = await commitInfo(root, it.id);
    const tree = await applyTree(root, tip, c);
    if (it.fixup && prev) {
      const msg = it.msg ?? prev.msg;
      tip = await commitTree(root, tree, prev.parents, prev, msg);
      prev = { ...prev, id: tip, tree, msg };
    } else {
      const parent = prev ? prev.id : onto;
      const msg = it.msg ?? c.msg;
      tip = await commitTree(root, tree, [tip], c, msg);
      prev = { ...c, id: tip, tree, parents: [parent], msg };
    }
  }
  return tip;
}

/** 첫 부모만 따라간 base..tip 의 커밋 (오래된 것부터) */
async function firstParentRange(root: string, base: string | null, tip: string): Promise<string[]> {
  const out = await git(root, ["rev-list", "--reverse", "--first-parent", base ? `${base}..${tip}` : tip]);
  return out.split("\n").filter(Boolean);
}

/** 브랜치를 옮긴다. 현재 브랜치면 작업 영역도 맞춘다 (로컬 변경은 보존, 겹치면 git 이 거절) */
async function setBranch(ctx: OpContext, branch: string, newOid: string, oldOid: string): Promise<void> {
  const { branch: cur } = await headInfo(ctx.root);
  await backup(ctx.root, branch, oldOid);
  if (branch === cur) await ctx.run(["reset", "--keep", newOid]);
  else await git(ctx.root, ["update-ref", `refs/heads/${branch}`, newOid, oldOid]);
}

const isConflict = (err: unknown): err is OpError => !!(err as OpError)?.conflicts;

const cherryPick: OpFn = async (ctx, [ids, branch]: [string[], string]) => {
  const tip = await rev(ctx.root, branch);
  let next: string;
  try {
    next = await chain(ctx.root, tip, ids.map((id) => ({ id })));
  } catch (err) {
    if (!isConflict(err)) throw err;
    if (branch !== (await headInfo(ctx.root)).branch) throw needsCheckout(err, branch);
    await runOrStop(ctx, ["cherry-pick", ...ids]);
    return;
  }
  ctx.note(`git cherry-pick ${ids.map(short).join(" ")}  # ${t("m.n.onto", { branch })}`);
  await setBranch(ctx, branch, next, tip);
};

const moveCommit: OpFn = async (ctx, [id, branch]: [string, string]) => {
  const from = ctx.extra.from;
  if (!from) throw new Error(t("m.unknownBranch"));
  const c = await commitInfo(ctx.root, id);
  const dstTip = await rev(ctx.root, branch), srcTip = await rev(ctx.root, from);
  const moved = await chain(ctx.root, dstTip, [{ id }]);
  const rest = await firstParentRange(ctx.root, id, srcTip);
  const left = await chain(ctx.root, c.parents[0], rest.map((x) => ({ id: x })));
  ctx.note(`git cherry-pick ${short(id)}  # → ${branch}`);
  ctx.note(`git rebase --onto ${short(id)}~1 ${short(id)} ${from}  # ${t("m.n.removeFrom", { branch: from })}`);
  await setBranch(ctx, branch, moved, dstTip);
  await setBranch(ctx, from, left, srcTip);
};

const dropCommit: OpFn = async (ctx, [id]: [string]) => {
  const from = ctx.extra.from;
  if (!from) throw new Error(t("m.unknownBranch"));
  const c = await commitInfo(ctx.root, id);
  const tip = await rev(ctx.root, from);
  const rest = await firstParentRange(ctx.root, id, tip);
  const next = await chain(ctx.root, c.parents[0], rest.map((x) => ({ id: x })));
  ctx.note(`git rebase --onto ${short(id)}~1 ${short(id)} ${from}  # ${t("m.n.drop", { id: short(id) })}`);
  await setBranch(ctx, from, next, tip);
};

const rebaseStem: OpFn = async (ctx, [branch, onto]: [string, string]) => {
  const base = ctx.extra.base;
  if (!base) throw new Error(t("m.unknownBase"));
  const tip = await rev(ctx.root, branch);
  const list = await firstParentRange(ctx.root, base, tip);
  let next: string;
  try {
    next = await chain(ctx.root, onto, list.map((id) => ({ id })));
  } catch (err) {
    if (!isConflict(err)) throw err;
    if (branch !== (await headInfo(ctx.root)).branch) throw needsCheckout(err, branch);
    await backup(ctx.root, branch, tip);
    await runOrStop(ctx, ["rebase", "--autostash", "--onto", onto, base, branch]);
    return;
  }
  ctx.note(`git rebase --onto ${short(onto)} ${short(base)} ${branch}`);
  await setBranch(ctx, branch, next, tip);
};

const squash: OpFn = async (ctx, [src, dst]: [string, string]) => {
  const from = ctx.extra.from;
  if (!from) throw new Error(t("m.unknownBranch"));
  const tip = await rev(ctx.root, from);
  const srcFirst = (await gitRaw(ctx.root, ["merge-base", "--is-ancestor", src, dst])).code === 0;
  const base = (await commitInfo(ctx.root, srcFirst ? src : dst)).parents[0];
  const items: ChainItem[] = [];
  for (const id of await firstParentRange(ctx.root, base, tip)) {
    if (id === src) continue;
    items.push({ id });
    if (id === dst) items.push({ id: src, fixup: true });
  }
  const next = await chain(ctx.root, base, items);
  ctx.note(`git rebase -i ${short(base)}  # ${t("m.n.fixup", { src: short(src), dst: short(dst) })}`);
  await setBranch(ctx, from, next, tip);
};

const reorder: OpFn = async (ctx, [id, branch, index]: [string, string, number]) => {
  const { stem, base } = ctx.extra;
  if (!stem || !base) throw new Error(t("m.unknownStem"));
  const from = stem.indexOf(id);
  const order = stem.filter((c) => c !== id);
  order.splice(index > from ? index - 1 : index, 0, id);
  const tip = await rev(ctx.root, branch);
  const next = await chain(ctx.root, base, order.map((c) => ({ id: c })));
  ctx.note(`git rebase -i ${short(base)}  # ${t("m.n.reorder", { id: short(id) })}`);
  await setBranch(ctx, branch, next, tip);
};

const revertCommit: OpFn = async (ctx, [id]: [string]) => {
  await runOrStop(ctx, ["revert", "--no-edit", id]);
};

const merge: OpFn = async (ctx, [src, dst]: [string, string]) => {
  const { branch: cur } = await headInfo(ctx.root);
  if (dst === cur) {
    await runOrStop(ctx, ["merge", "--no-edit", src]);
    return;
  }
  const a = await rev(ctx.root, dst), b = await rev(ctx.root, src);
  if ((await gitRaw(ctx.root, ["merge-base", "--is-ancestor", a, b])).code === 0) {
    ctx.note(`git fetch . ${src}:${dst}  # ${t("m.n.ff")}`);
    await setBranch(ctx, dst, b, a);
    return;
  }
  const r = await gitRaw(ctx.root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b]);
  const lines = r.stdout.split("\n");
  if (r.code === 1) throw needsCheckout(conflictError(lines.slice(1).filter(Boolean), `merge ${src} → ${dst}`), dst);
  if (r.code !== 0) throw new Error(r.stderr.trim());
  const id = (await git(ctx.root, ["commit-tree", lines[0].trim(), "-p", a, "-p", b, "-m", `Merge branch '${src}' into ${dst}`])).trim();
  ctx.note(`git merge ${src}  # ${t("m.n.onto", { branch: dst })}`);
  await setBranch(ctx, dst, id, a);
};

/** 계획 확인: 줄기의 커밋이 빠짐없이 한 번씩, 첫 줄은 합치기가 아니어야 한다 */
export function checkPlan(stem: string[], steps: RebaseStep[]): void {
  const ids = steps.map((s) => s.id);
  if (ids.length !== stem.length || new Set(ids).size !== ids.length || !ids.every((id) => stem.includes(id))) {
    throw new Error(t("m.planMismatch"));
  }
  const kept = steps.filter((s) => s.action !== "drop");
  if (!kept.length) throw new Error(t("m.planDropAll"));
  if (kept[0].action === "squash" || kept[0].action === "fixup") throw new Error(t("m.planFirstSquash"));
  for (const s of steps) {
    if ((s.action === "reword" || s.action === "squash") && s.msg !== undefined && !s.msg.trim()) throw new Error(t("pv.planEmptyMsg"));
  }
}

/** 실제 git rebase -i 에 넘길 todo (충돌로 멈추며 진행해야 할 때). 메시지는 파일로 넘긴다 */
export function todoFor(steps: RebaseStep[], msgFile: (i: number) => string): string {
  const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  const lines: string[] = [];
  steps.forEach((s, i) => {
    if (s.action === "drop") { lines.push(`drop ${s.id}`); return; }
    lines.push(`${s.action === "squash" || s.action === "fixup" ? "fixup" : "pick"} ${s.id}`);
    if (s.msg !== undefined && (s.action === "reword" || s.action === "squash")) lines.push(`exec git commit --amend -q --no-verify -F ${q(msgFile(i))}`);
  });
  return lines.join("\n") + "\n";
}

/** 커밋 정리: 순서·합치기·메시지·빼기를 한 번에. ctx.extra.base = 줄기 시작점 */
const rebasePlan: OpFn = async (ctx, [branch, steps]: [string, RebaseStep[]]) => {
  const base = ctx.extra.base;
  if (!base) throw new Error(t("m.unknownBase"));
  const tip = await rev(ctx.root, branch);
  checkPlan(await firstParentRange(ctx.root, base, tip), steps);
  const items: ChainItem[] = steps.filter((s) => s.action !== "drop").map((s) => ({
    id: s.id,
    fixup: s.action === "squash" || s.action === "fixup",
    msg: s.action === "reword" || s.action === "squash" ? s.msg : undefined,
  }));
  let next: string;
  try {
    next = await chain(ctx.root, base, items);
  } catch (err) {
    if (!isConflict(err)) throw err;
    if (branch !== (await headInfo(ctx.root)).branch) throw needsCheckout(err, branch);
    // 현재 브랜치: 실제 rebase -i 로 같은 계획을 실행하고, 충돌이 나면 멈춰서 해결 모드로
    const dir = path.join(await gitDir(ctx.root), "ygg-rebase");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    steps.forEach((s, i) => { if (s.msg !== undefined) fs.writeFileSync(path.join(dir, `msg-${i}`), s.msg); });
    const todo = path.join(dir, "todo");
    fs.writeFileSync(todo, todoFor(steps, (i) => path.join(dir, `msg-${i}`)));
    await backup(ctx.root, branch, tip);
    await runOrStop(ctx, ["rebase", "-i", "--autostash", base], { env: { GIT_SEQUENCE_EDITOR: `cp '${todo.replace(/'/g, "'\\''")}'` } });
    return;
  }
  const n = steps.filter((s) => s.action !== "pick").length;
  ctx.note(`git rebase -i ${short(base)}  # ${branch}: ${steps.map((s) => `${s.action} ${short(s.id)}`).join(", ")}${n ? "" : t("m.n.orderOnly")}`);
  await setBranch(ctx, branch, next, tip);
};

export const historyOps = { rebasePlan, cherryPick, moveCommit, dropCommit, rebaseStem, squash, reorder, revertCommit, merge };
