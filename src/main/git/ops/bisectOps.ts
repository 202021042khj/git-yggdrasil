// git bisect: 좋은(good) 커밋과 나쁜(bad) 커밋 사이를 반씩 체크아웃하며 처음 나빠진 커밋을 찾는다.
// bisect 는 브랜치를 바꾸지 않고 HEAD 만 옮기므로 ⌘Z 기록에 남지 않는다. 빠져나오는 길은 reset (원래 브랜치로 돌아감) 하나다.
import { git } from "@/git/cli";
import { bisecting } from "@/git/opState";
import { registerOps } from "@/git/ops/execute";
import { short, type OpContext, type OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";

type Mark = "good" | "bad" | "skip";

/** 추적 중인 파일에 변경이 있으면 체크아웃이 막히거나 변경이 다른 커밋으로 따라가므로 미리 거절한다 */
async function refuseDirty(ctx: OpContext): Promise<void> {
  if (((await git(ctx.root, ["status", "--porcelain", "-uno"], { allowFail: true })) || "").trim()) throw new Error(t("m.bisectDirty"));
}

/** 표시 하나 (good·bad·skip). 끝나면 git 이 첫 나쁜 커밋을 알려 준다 */
async function mark(ctx: OpContext, kind: Mark, id?: string | null): Promise<void> {
  const out = await ctx.run(["bisect", kind, ...(id ? [id] : [])]);
  const found = out.match(/^([0-9a-f]{7,40}) is the first bad commit/m);
  if (found) ctx.note(`# ${t("m.bisectFound", { commit: short(found[1]) })}`);
  else if (/only skipped commits left/i.test(out)) ctx.warn(t("m.bisectOnlySkipped"));
}

/** 시작: git bisect start 뒤 고른 커밋에 첫 표시. good·bad 가 다 모이면 git 이 가운데 커밋을 체크아웃한다 */
const bisectStart: OpFn = async (ctx, [kind, id]: ["good" | "bad", string]) => {
  if (await bisecting(ctx.root)) throw new Error(t("m.bisectRunning"));
  await refuseDirty(ctx);
  await ctx.run(["bisect", "start"]);
  await mark(ctx, kind, id);
};

/** 진행 중 표시: id 가 없으면 지금 체크아웃된 커밋(HEAD) */
const bisectMark: OpFn = async (ctx, [kind, id]: [Mark, string | null | undefined]) => {
  if (!(await bisecting(ctx.root))) throw new Error(t("m.bisectNotRunning"));
  await refuseDirty(ctx);
  await mark(ctx, kind, id);
};

/** 끝내기: 시작 전 브랜치로 돌아간다 (.git/BISECT_START 에 적힌 곳) */
const bisectReset: OpFn = async (ctx) => {
  if (!(await bisecting(ctx.root))) throw new Error(t("m.bisectNotRunning"));
  await ctx.run(["bisect", "reset"]);
};

export function registerBisectOps(): void {
  registerOps({ bisectStart, bisectMark, bisectReset });
}
