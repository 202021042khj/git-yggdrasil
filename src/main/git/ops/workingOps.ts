// 작업 영역 조작: stage · 변경 버리기 · 커밋 · amend · 메시지 수정 · stash
import { git } from "@/git/cli";
import { readOpKind } from "@/git/opState";
import { statusRows } from "@/git/status";
import { backup, headInfo, spec, under, unsupported, type OpContext, type OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";

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

const commitTo: OpFn = async (ctx, [branch, msg, paths]: [string, string, string[] | undefined]) => {
  const { branch: cur } = await headInfo(ctx.root);
  // 브랜치 없이(detached) 커밋하는 경우: 커밋 분할 등 rebase 도중이거나 과거 커밋을 임시로 체크아웃한 상태
  const detachedOk = !cur && (branch === "HEAD" || readOpKind(ctx.root) === "rebase");
  if (branch !== cur && !detachedOk) unsupported(t("m.u.commitOther"));
  if (paths) {
    await ctx.run(["add", "-A", "--", ...spec(paths)]);
    await ctx.run(["commit", "-m", msg, "--", ...spec(paths)]);
    return;
  }
  if (!(await hasStaged(ctx.root))) await ctx.run(["add", "-A"]);
  await ctx.run(["commit", "-m", msg]);
};

const amendInto: OpFn = async (ctx, [id, _msg, paths]: [string, string, string[] | undefined]) => {
  const { tip } = await headInfo(ctx.root);
  if (id !== tip) unsupported(t("m.u.fixup"));
  await backup(ctx.root, "amend", tip);
  if (paths) await ctx.run(["add", "-A", "--", ...spec(paths)]);
  else if (!(await hasStaged(ctx.root))) await ctx.run(["add", "-A"]);
  await ctx.run(["commit", "--amend", "--no-edit"]);
};

/** 커밋 메시지 수정. HEAD 면 amend, 과거 커밋이면 같은 내용·작성자로 새 커밋을 만들고 그 뒤 커밋들을 다시 올린다. */
const reword: OpFn = async (ctx: OpContext, [id, msg]: [string, string]) => {
  const { root } = ctx;
  const { branch, tip } = await headInfo(root);
  if (!branch) throw new Error(t("m.rewordNeedsBranch"));
  if (id === tip) {
    await backup(root, `reword-${branch}`, tip);
    await ctx.run(["commit", "--amend", "--only", "-m", msg]);
    return;
  }
  const isAnc = await git(root, ["merge-base", "--is-ancestor", id, "HEAD"], { allowFail: true });
  if (isAnc === null) throw new Error(t("m.rewordOnlyHead", { branch }));
  await backup(root, `reword-${branch}`, tip);
  const [tree, parents, an, ae, ad] = (await git(root, ["show", "-s", "--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI", id])).trim().split("\x1f");
  const env = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad };
  const pArgs = parents ? parents.split(" ").flatMap((p) => ["-p", p]) : [];
  const created = (await ctx.run(["commit-tree", tree, ...pArgs, "-m", msg], { env })).trim();
  // 메시지만 바뀌었으므로 내용 충돌은 없다. 작업 영역 변경은 autostash 로 보존
  await ctx.run(["rebase", "--rebase-merges", "--autostash", "--onto", created, id, branch]);
};

const stashPush: OpFn = async (ctx, [msg]: [string | undefined]) => {
  await ctx.run(["stash", "push", "-u", ...(msg ? ["-m", msg] : [])]);
};
const stashPop: OpFn = async (ctx, [idx, keep]: [number, boolean]) => {
  await ctx.run(["stash", keep ? "apply" : "pop", `stash@{${idx}}`]);
};
const stashDrop: OpFn = async (ctx, [idx]: [number]) => {
  await ctx.run(["stash", "drop", `stash@{${idx}}`]);
};

export const workingOps = { stageFiles, discard, commitTo, amendInto, reword, stashPush, stashPop, stashDrop };
