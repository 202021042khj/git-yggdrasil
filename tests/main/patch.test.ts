// 패치 내보내기 · 적용: format-patch 로 저장 → 다른 브랜치에 am (⌘Z 로 되돌림) · am 충돌은 진행 중 배너 · diff 는 git apply · 안 맞으면 아무것도 안 바꾸고 알린다
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { isMailPatch, registerPatchOps } from "@/git/ops/patchOps";
import { readRepo } from "@/git/readRepo";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string;
// 전역 · 시스템 git 설정을 읽지 않게 격리
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
const write = (f: string, t: string) => fs.writeFileSync(path.join(repo, f), t);
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");
const run = async (op: OpName, ...args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const commit = (f: string, text: string, msg: string) => { write(f, text); sh("add", "-A"); sh("commit", "-q", "-m", msg); return sh("rev-parse", "HEAD"); };

beforeAll(() => registerPatchOps());
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-patch-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  commit("a.txt", "1\n2\n3\n", "base");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("커밋 둘을 format-patch 로 저장 → 다른 브랜치에 git am --3way → ⌘Z 로 되돌린다", async () => {
  sh("branch", "other");
  const c1 = commit("a.txt", "1\n2\n3\n4\n", "add 4");
  const c2 = commit("b.txt", "b\n", "add b");
  const file = path.join(tmp, "out.patch");
  // 고른 순서와 상관없이 오래된 것부터
  const r = await run("patchExport", "commits", [c2, c1], file);
  assert.ok(r.cmds.some((c) => c.startsWith("git format-patch -1 --stdout --binary")));
  const text = fs.readFileSync(file, "utf8");
  assert.ok(isMailPatch(text));
  assert.ok(text.indexOf("Subject: [PATCH] add 4") < text.indexOf("Subject: [PATCH] add b"));

  sh("switch", "-q", "other");
  const before = sh("rev-parse", "HEAD");
  const a = await run("patchApply", file);
  assert.ok(a.cmds.includes(`git am --3way ${file}`));
  assert.deepEqual(sh("log", "--format=%s", "-2").split("\n"), ["add b", "add 4"]);
  assert.equal(read("b.txt"), "b\n");

  await run("undo");
  assert.equal(sh("rev-parse", "HEAD"), before);
});

test("am 이 충돌로 멈추면 진행 중 배너(kind am) → 해결 후 continue / abort 로 원래대로", async () => {
  sh("branch", "other");
  const c = commit("a.txt", "1\nMAIN\n3\n", "main edit");
  const file = path.join(tmp, "c.patch");
  await run("patchExport", "commits", [c], file);
  sh("switch", "-q", "other");
  commit("a.txt", "1\nOTHER\n3\n", "other edit");
  const before = sh("rev-parse", "HEAD");

  const r = await run("patchApply", file);
  assert.ok(r.warnings?.length, "충돌은 실패가 아니라 멈춤으로 알린다");
  let st = await readRepo(repo);
  assert.equal(st.op?.kind, "am");
  assert.equal(st.op?.current?.msg, "main edit");
  assert.deepEqual(st.op?.conflicts, ["a.txt"]);

  await run("abortOp");
  st = await readRepo(repo);
  assert.equal(st.op, null);
  assert.equal(sh("rev-parse", "HEAD"), before);

  // 다시 적용해서 이번에는 해결하고 계속
  await run("patchApply", file);
  await run("resolveFile", "a.txt", "theirs");
  await run("continueOp");
  assert.equal((await readRepo(repo)).op, null);
  assert.equal(sh("log", "-1", "--format=%s"), "main edit");
});

test("커밋 안 한 변경을 diff 로 저장 → git apply 로 작업 영역에만 적용 (커밋·브랜치는 그대로)", async () => {
  write("a.txt", "1\n2\n3\nnew\n");
  sh("add", "a.txt");
  write("a.txt", "1\n2\n3\nnew\nmore\n");
  const staged = path.join(tmp, "staged.diff"), working = path.join(tmp, "working.diff");
  const rs = await run("patchExport", "staged", [], staged);
  assert.ok(rs.cmds.includes("git diff --cached --binary"));
  await run("patchExport", "working", [], working);
  assert.ok(!fs.readFileSync(staged, "utf8").includes("more"));
  assert.ok(fs.readFileSync(working, "utf8").includes("+more"));
  assert.ok(!isMailPatch(fs.readFileSync(working, "utf8")));

  sh("reset", "-q", "--hard");
  const head = sh("rev-parse", "HEAD");
  const r = await run("patchApply", working);
  assert.ok(r.cmds.includes(`git apply --check ${working}`));
  assert.equal(read("a.txt"), "1\n2\n3\nnew\nmore\n");
  assert.equal(sh("rev-parse", "HEAD"), head);
  assert.equal(r.undoable, 0, "작업 영역만 바뀌어 ⌘Z 기록에 남지 않는다");
});

test("맞지 않는 패치는 아무것도 바꾸지 않고 오류를 알린다", async () => {
  const bad = path.join(tmp, "bad.diff");
  fs.writeFileSync(bad, "diff --git a/zzz.txt b/zzz.txt\n--- a/zzz.txt\n+++ b/zzz.txt\n@@ -1 +1 @@\n-nope\n+yes\n");
  const r = await execute(repo, "patchApply", [bad]);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /zzz\.txt/);
  assert.equal(sh("status", "--porcelain"), "");
});

test("빈 내보내기는 거절", async () => {
  const r = await execute(repo, "patchExport", ["working", [], path.join(tmp, "x.diff")]);
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(tmp, "x.diff")));
});
