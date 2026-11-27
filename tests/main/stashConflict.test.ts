// stash pop/apply 가 충돌로 멈춘 뒤: 해결하면 그 stash 를 해시로 찾아 지우고(⌘Z 로 되살림), 중단하면 적용 전으로 되돌리고 stash 는 남긴다
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { readRepo } from "@/git/readRepo";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string;
// 전역 · 시스템 git 설정을 읽지 않게 격리
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
const write = (f: string, t: string) => fs.writeFileSync(path.join(repo, f), t);
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");
const run = async (op: OpName, ...args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const stashes = () => sh("stash", "list", "--format=%H").split("\n").filter(Boolean);

// stash 두 개: stash@{0}=older 는 app.js 충돌, stash@{1}... 순서는 아래에서 만든다
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-stash-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  write("app.js", "base\n"); write("other.txt", "o\n");
  sh("add", "-A"); sh("commit", "-q", "-m", "base");
  // 충돌할 stash (추적 안 하는 새 파일도 함께)
  write("app.js", "stashed\n"); write("new.txt", "n\n");
  sh("stash", "push", "-u", "-q", "-m", "conflicting");
  // 충돌 안 하는 stash 를 위에 하나 더 쌓는다 → 충돌할 stash 는 stash@{1}
  write("other.txt", "o2\n");
  sh("stash", "push", "-q", "-m", "plain");
  write("app.js", "committed\n");
  sh("add", "-A"); sh("commit", "-q", "-m", "change app");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("stash pop 충돌 → stash 종류로 멈춤 → 해결 후 계속하면 해시로 찾아 그 stash 만 지우고 ⌘Z 로 되살린다", async () => {
  const target = stashes()[1];
  const r = await run("stashPop", 1, false);
  assert.match(r.warnings![0], /충돌로 멈췄습니다/);
  let op = (await readRepo(repo)).op!;
  assert.equal(op.kind, "stash");
  assert.equal(op.stash?.oid, target);
  assert.equal(op.stash?.keep, false);
  assert.deepEqual(op.conflicts, ["app.js"]);
  assert.equal(stashes().length, 2, "충돌이면 git 은 stash 를 남긴다");

  // 그사이 다른 stash 를 지워 번호가 밀려도 해시로 찾는다
  sh("stash", "drop", "-q", "stash@{0}");
  await run("resolveFile", "app.js", "theirs");
  op = (await readRepo(repo)).op!;
  assert.equal(op?.kind, "stash", "다 해결해도 stash 정리를 고를 때까지 배너가 남는다");
  const c = await run("continueOp");
  assert.ok(c.cmds.includes("git stash drop stash@{0}"));
  assert.deepEqual(stashes(), []);
  assert.equal((await readRepo(repo)).op, null);
  assert.equal(read("app.js"), "stashed\n");

  await run("undo");
  assert.deepEqual(stashes(), [target]);
  await run("redo");
  assert.deepEqual(stashes(), []);
});

test("stash pop 충돌 → 중단하면 적용 전 작업 영역으로 돌아가고 stash 는 남는다", async () => {
  const before = stashes();
  write("other.txt", "untouched wip\n"); // 적용과 상관없는 작업 중 변경은 그대로 둔다
  await run("stashPop", 1, false);
  assert.ok(fs.existsSync(path.join(repo, "new.txt")));
  const r = await run("abortOp");
  assert.ok(r.cmds.includes("git reset --merge"));
  assert.equal(read("app.js"), "committed\n");
  assert.equal(read("other.txt"), "untouched wip\n");
  assert.ok(!fs.existsSync(path.join(repo, "new.txt")), "stash 가 되살린 추적 안 하는 파일은 지운다");
  assert.deepEqual(stashes(), before);
  assert.equal((await readRepo(repo)).op, null);
});

test("stash apply 충돌 → 해결해도 stash 는 지우지 않는다", async () => {
  const before = stashes();
  await run("stashPop", 1, true);
  assert.equal((await readRepo(repo)).op?.stash?.keep, true);
  await run("resolveFile", "app.js", "ours");
  const c = await run("continueOp");
  assert.ok(!c.cmds.some((l) => l.startsWith("git stash drop")));
  assert.deepEqual(stashes(), before);
  assert.equal((await readRepo(repo)).op, null);
});

test("충돌 없는 stash pop 은 표시를 남기지 않는다", async () => {
  await run("stashPop", 0, false);
  assert.equal(read("other.txt"), "o2\n");
  assert.equal((await readRepo(repo)).op, null);
  assert.equal(stashes().length, 1);
});
