// 무시 파일 편집: 저장소 맨 위 .gitignore (공유) 또는 .git/info/exclude (나만) 에 패턴을 더하고 뺀다.
// 경로·패턴은 화면에서 온 값이라 여기서 검사한다 (저장소 밖 경로 · 줄바꿈 거절). 바꾼 파일은 ⌘Z 로 이전 내용을 되쓴다.
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { registerOps } from "@/git/ops/execute";
import type { FileUndo, OpContext, OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";
import type { IgnoreFiles, IgnoreReason, IgnoreTarget } from "@shared/types/ipc";

const TARGETS = new Set<IgnoreTarget>(["gitignore", "exclude"]);
const MATCH_LIMIT = 200;

/** 화면에서 온 저장소 기준 상대 경로 검사: 절대 경로 · .. · .git 안 · 줄바꿈은 거절하고 / 로 정리한 경로를 돌려준다 */
export function safeRel(root: string, p: unknown): string {
  if (typeof p !== "string" || !p || /[\0\r\n]/.test(p)) throw new Error(t("m.ignoreBadPath"));
  const rel = p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!rel || path.posix.isAbsolute(rel) || path.isAbsolute(p)) throw new Error(t("m.ignoreBadPath"));
  const parts = rel.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "") || parts[0] === ".git") throw new Error(t("m.ignoreBadPath"));
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(t("m.ignoreBadPath"));
  return rel;
}

/** 패턴 한 줄 검사 (줄바꿈 · NUL · 빈 값 · 너무 긴 값 거절) */
export function safePattern(p: unknown): string {
  if (typeof p !== "string" || /[\0\r\n]/.test(p) || !p.trim() || p.length > 1000) throw new Error(t("m.ignoreBadPattern"));
  return p;
}

const safeTarget = (v: unknown): IgnoreTarget => {
  if (!TARGETS.has(v as IgnoreTarget)) throw new Error(t("m.ignoreBadPattern"));
  return v as IgnoreTarget;
};

/** 무시 파일의 실제 위치 (exclude 는 worktree 도 맞게 git 에 묻는다). 심볼릭 링크면 거절 (저장소 밖을 쓰지 않게) */
async function targetFile(root: string, target: IgnoreTarget): Promise<string> {
  let file: string;
  if (target === "gitignore") file = path.join(root, ".gitignore");
  else {
    const p = (await git(root, ["rev-parse", "--git-path", "info/exclude"])).trim();
    file = path.isAbsolute(p) ? p : path.join(root, p);
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(t("m.ignoreSymlink", { file: path.basename(file) }));
  return file;
}

const readOrNull = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const patternLines = (text: string | null) => (text || "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
const displayName = (target: IgnoreTarget) => (target === "gitignore" ? ".gitignore" : ".git/info/exclude");
/** 기록에 남길 셸 인자 (작은따옴표) */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** 패턴을 파일 끝에 더한다 (없으면 만들고, 끝 줄바꿈을 맞추고, 이미 있는 줄은 건너뛴다). 바꾼 내용을 ⌘Z 기록에 남긴다 */
async function appendPatterns(ctx: OpContext, target: IgnoreTarget, patterns: string[]): Promise<FileUndo | null> {
  const file = await targetFile(ctx.root, target);
  const before = readOrNull(file);
  const have = new Set((before || "").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")));
  const add = [...new Set(patterns)].filter((p) => !have.has(p.replace(/\s+$/, "")));
  if (!add.length) {
    ctx.warn(t("m.ignoreDup", { file: displayName(target) }));
    return null;
  }
  const base = before === null || before === "" ? "" : before.endsWith("\n") ? before : before + "\n";
  const after = base + add.join("\n") + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  for (const p of add) ctx.note(`printf '%s\\n' ${sq(p)} >> ${displayName(target)}`);
  return { file, before, after };
}

/** 패턴 더하기 ([패턴들, 대상]) */
const ignoreAdd: OpFn = async (ctx, [patterns, target]: [string[], IgnoreTarget]) => {
  if (!Array.isArray(patterns) || !patterns.length) throw new Error(t("m.ignoreBadPattern"));
  const undo = await appendPatterns(ctx, safeTarget(target), patterns.map(safePattern));
  if (undo) ctx.fileUndo = undo;
};

/** 패턴 빼기: 그 패턴과 똑같은 줄을 모두 지운다 */
const ignoreRemove: OpFn = async (ctx, [pattern, target]: [string, IgnoreTarget]) => {
  const p = safePattern(pattern).replace(/\s+$/, "");
  const tg = safeTarget(target);
  const file = await targetFile(ctx.root, tg);
  const before = readOrNull(file);
  if (before === null) throw new Error(t("m.ignoreNotFound", { pattern: p }));
  const lines = before.split("\n");
  const kept = lines.filter((l) => l.replace(/\s+$/, "") !== p);
  if (kept.length === lines.length) throw new Error(t("m.ignoreNotFound", { pattern: p }));
  const after = kept.join("\n");
  fs.writeFileSync(file, after);
  ctx.note(`# ${t("m.ignoreRemoved", { pattern: p, file: displayName(tg) })}`);
  ctx.fileUndo = { file, before, after };
};

/** 추적을 멈추고 무시: git rm --cached 후 .gitignore 에 패턴 (파일은 작업 폴더에 남고, 삭제로 stage 된다) */
const untrackIgnore: OpFn = async (ctx, [file, pattern]: [string, string]) => {
  const rel = safeRel(ctx.root, file);
  const pat = safePattern(pattern);
  const staged = (await git(ctx.root, ["ls-files", "-s", "-z", "--", rel])).split("\0").filter(Boolean);
  if (!staged.length) throw new Error(t("m.ignoreNotTracked", { file: rel }));
  const untracked = staged.map((l) => {
    const [meta, p] = l.split("\t");
    const [mode, oid] = meta.split(" ");
    return { mode, oid, path: p };
  });
  await ctx.run(["rm", "--cached", "-r", "-q", "--", rel]);
  const undo = await appendPatterns(ctx, "gitignore", [pat]);
  const gi = path.join(ctx.root, ".gitignore");
  const now = readOrNull(gi);
  ctx.fileUndo = { ...(undo || { file: gi, before: now, after: now }), untracked };
  ctx.warn(t("m.ignoreStagedDeletion", { file: rel }));
};

/** 두 무시 파일의 현재 패턴 */
export async function readIgnoreFiles(root: string): Promise<IgnoreFiles> {
  return {
    gitignore: patternLines(readOrNull(await targetFile(root, "gitignore"))),
    exclude: patternLines(readOrNull(await targetFile(root, "exclude"))),
  };
}

const zlist = (out: string | null) => (out || "").split("\0").filter(Boolean).slice(0, MATCH_LIMIT);

/** 이 패턴 하나만 적용했을 때 걸리는 파일 (git ls-files -i --exclude=<패턴>) */
export async function ignoreMatches(root: string, pattern: unknown): Promise<{ untracked: string[]; tracked: string[] }> {
  const p = safePattern(pattern);
  const untracked = zlist(await git(root, ["ls-files", "-z", "-o", "-i", `--exclude=${p}`], { allowFail: true }));
  const tracked = zlist(await git(root, ["ls-files", "-z", "-c", "-i", `--exclude=${p}`], { allowFail: true }));
  return { untracked, tracked };
}

/** 왜 무시되는가: git check-ignore -v --no-index (추적 중인 파일도 어떤 규칙에 걸리는지 본다) */
export async function ignoreWhy(root: string, file: unknown): Promise<IgnoreReason | null> {
  const rel = safeRel(root, file);
  const out = (await git(root, ["check-ignore", "-v", "--no-index", "--", rel], { allowFail: true })) || "";
  const m = /^(.*?):(\d+):(.*)\t/.exec(out);
  if (!m) return null;
  return { source: m[1], line: Number(m[2]), pattern: m[3], negated: m[3].startsWith("!") };
}

export function registerIgnoreOps(): void {
  registerOps({ ignoreAdd, ignoreRemove, untrackIgnore });
}
