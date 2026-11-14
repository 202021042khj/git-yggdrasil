// 4단계: 충돌로 멈춘 뒤 해결 · 계속 · 건너뛰기 · 중단을 실제 git 으로 해 본다
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { setOpener } from "@/git/ops/conflictOps";
import { readRepo } from "@/git/readRepo";
import type { OpExtra, OpName } from "@shared/types/ipc";


let tmp: string, repo: string, ids: Record<string, string>;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (f: string, t: string) => fs.writeFileSync(path.join(repo, f), t);
const commit = (msg: string, files: Record<string, string>) => { Object.entries(files).forEach(([f, t]) => write(f, t)); sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", msg); return sh(repo, "rev-parse", "HEAD"); };
const run = async (op: OpName, args: unknown[] = [], extra?: OpExtra) => { const r = await execute(repo, op, args, extra); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const opOf = async () => (await readRepo(repo)).op!;

// main: base ─ m1(app.js=main)     topic: base ─ t1(app.js=topic) ─ t2(other.txt)
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-conflict-"));
  repo = path.join(tmp, "repo");
  sh(tmp, "init", "-q", "-b", "main", repo);
  sh(repo, "config", "user.name", "T"); sh(repo, "config", "user.email", "t@example.com"); sh(repo, "config", "commit.gpgsign", "false");
  ids = {};
  ids.base = commit("base", { "app.js": "base\n" });
  ids.m1 = commit("m1", { "app.js": "main\n" });
  sh(repo, "switch", "-q", "-c", "topic", ids.base);
  ids.t1 = commit("t1", { "app.js": "topic\n" });
  ids.t2 = commit("t2", { "other.txt": "o\n" });
  sh(repo, "switch", "-q", "main");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("현재 브랜치 merge 충돌 → 멈춤 → A 쪽 선택 → 계속하면 merge 커밋", async () => {
  const r = await run("merge", ["topic", "main"]);
  assert.match(r.warnings![0], /충돌로 멈췄습니다/);
  let op = await opOf();
  assert.equal(op.kind, "merge");
  assert.deepEqual(op.conflicts, ["app.js"]);
  assert.deepEqual(op.resolved, {});
  assert.equal(op.theirsName, "topic");

  const early = await execute(repo, "continueOp", []);
  assert.equal(early.ok, false, "해결 전에는 계속할 수 없다");

  await run("resolveFile", ["app.js", "ours"]);
  op = await opOf();
  assert.deepEqual(op.resolved, { "app.js": "done" }, "해결한 파일은 ✓ 로 남는다");
  await run("continueOp");
  assert.equal(await opOf(), null);
  assert.equal(fs.readFileSync(path.join(repo, "app.js"), "utf8"), "main\n");
  assert.equal(sh(repo, "rev-list", "--parents", "-n1", "HEAD").split(" ").length, 3);
});

test("현재 브랜치 rebase 충돌 → 몇 번째 커밋인지 보여 주고 B 쪽으로 해결 → 계속", async () => {
  sh(repo, "switch", "-q", "topic");
  const r = await run("rebaseStem", ["topic", ids.m1], { base: ids.base });
  assert.match(r.warnings![0], /충돌로 멈췄습니다/);
  const op = await opOf();
  assert.equal(op.kind, "rebase");
  assert.equal(op.branch, "topic");
  assert.equal(op.step, 0);
  assert.equal(op.total, 2);
  assert.equal(op.current?.msg, "t1");
  await run("resolveFile", ["app.js", "theirs"]); // rebase 에서 theirs = 적용 중인 내 커밋
  await run("continueOp");
  assert.equal(await opOf(), null);
  assert.deepEqual(sh(repo, "log", "--format=%s", "-n4").split("\n"), ["t2", "t1", "m1", "base"]);
  assert.equal(fs.readFileSync(path.join(repo, "app.js"), "utf8"), "topic\n");
});

test("rebase 충돌에서 건너뛰기 · 중단", async () => {
  sh(repo, "switch", "-q", "topic");
  const before = sh(repo, "rev-parse", "topic");
  await run("rebaseStem", ["topic", ids.m1], { base: ids.base });
  await run("abortOp");
  assert.equal(await opOf(), null);
  assert.equal(sh(repo, "rev-parse", "topic"), before, "중단하면 시작 전으로");

  await run("rebaseStem", ["topic", ids.m1], { base: ids.base });
  await run("skipOp");
  assert.equal(await opOf(), null);
  assert.deepEqual(sh(repo, "log", "--format=%s", "-n3").split("\n"), ["t2", "m1", "base"]);
});

test("직접 편집: 충돌 표시가 남아 있으면 에디터로 열고, 정리하면 해결로 표시", async () => {
  await run("merge", ["topic", "main"]);
  let opened: string | null = null;
  setOpener((f) => { opened = f; });
  const r = await run("resolveFile", ["app.js", "both"]);
  assert.equal(opened, path.join(repo, "app.js"));
  assert.match(r.warnings![0], /에디터로 열었습니다/);
  assert.deepEqual((await opOf()).resolved, {});
  write("app.js", "main + topic\n");
  await run("resolveFile", ["app.js", "both"]);
  assert.deepEqual((await opOf()).resolved, { "app.js": "done" });
  await run("continueOp");
  assert.equal(fs.readFileSync(path.join(repo, "app.js"), "utf8"), "main + topic\n");
});

test("체크아웃 안 한 브랜치의 충돌은 NEEDS_CHECKOUT 으로 알리고 아무것도 바꾸지 않는다", async () => {
  const before = sh(repo, "rev-parse", "topic");
  const r = await execute(repo, "cherryPick", [[ids.m1], "topic"]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "NEEDS_CHECKOUT");
  assert.equal(r.branch, "topic");
  assert.equal(sh(repo, "rev-parse", "topic"), before);
  // 체크아웃하고 다시 하면 멈춤 모드
  await run("checkout", ["topic"]);
  const r2 = await run("cherryPick", [[ids.m1], "topic"]);
  assert.match(r2.warnings![0], /충돌로 멈췄습니다/);
  assert.equal((await opOf()).kind, "cherry-pick");
  await run("abortOp");
  assert.equal(await opOf(), null);
});

test("revert 충돌도 멈춘다", async () => {
  commit("m2", { "app.js": "main2\n" });
  const r = await run("revertCommit", [ids.m1]);
  assert.match(r.warnings![0], /충돌로 멈췄습니다/);
  assert.equal((await opOf()).kind, "revert");
  await run("abortOp");
  assert.equal(await opOf(), null);
});

test("pull 충돌도 멈춘다 (merge)", async () => {
  const bare = path.join(tmp, "remote.git");
  sh(tmp, "init", "-q", "--bare", "-b", "main", bare);
  sh(repo, "remote", "add", "origin", bare);
  sh(repo, "push", "-q", "-u", "origin", "main");
  const other = path.join(tmp, "other");
  sh(tmp, "clone", "-q", bare, other);
  sh(other, "config", "user.name", "O"); sh(other, "config", "user.email", "o@example.com");
  fs.writeFileSync(path.join(other, "app.js"), "theirs\n");
  sh(other, "commit", "-q", "-am", "remote change");
  sh(other, "push", "-q");
  commit("local change", { "app.js": "mine\n" });
  const r = await run("pull", ["main", "merge"]);
  assert.match(r.warnings![0], /충돌로 멈췄습니다/);
  assert.equal((await opOf()).kind, "merge");
});
