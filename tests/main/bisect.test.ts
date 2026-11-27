// git bisect: 표시로 시작 → 가운데 커밋 체크아웃 → 좋음/나쁨으로 좁혀 첫 나쁜 커밋을 찾고, reset 으로 원래 브랜치로 돌아간다
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { registerBisectOps } from "@/git/ops/bisectOps";
import { readRepo } from "@/git/readRepo";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string;
const ids: string[] = [];
// 전역 · 시스템 git 설정을 읽지 않게 격리
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
const write = (f: string, t: string) => fs.writeFileSync(path.join(repo, f), t);
const run = async (op: OpName, ...args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
/** 8번째 커밋(ids[7])부터 bug.txt 에 BUG 가 들어 있다 */
const isBad = () => fs.readFileSync(path.join(repo, "bug.txt"), "utf8").includes("BUG");

beforeAll(() => registerBisectOps());
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-bisect-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  ids.length = 0;
  for (let i = 0; i < 12; i++) {
    write("n.txt", `${i}\n`);
    write("bug.txt", i >= 7 ? "BUG\n" : "ok\n");
    sh("add", "-A"); sh("commit", "-q", "-m", `c${i}`);
    ids.push(sh("rev-parse", "HEAD"));
  }
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("bad 로 시작 → good 을 더하면 가운데로 → 좋음/나쁨으로 첫 나쁜 커밋을 찾고 reset 으로 main 으로 돌아간다", async () => {
  const r0 = await run("bisectStart", "bad", ids[11]);
  assert.ok(r0.cmds.includes("git bisect start"));
  let b = (await readRepo(repo)).bisect!;
  assert.equal(b.original, "main");
  assert.equal(b.bad, ids[11]);
  assert.equal(b.good.length, 0, "good 이 없으면 아직 체크아웃하지 않는다");
  assert.equal(sh("rev-parse", "HEAD"), ids[11]);

  await run("bisectMark", "good", ids[0]);
  b = (await readRepo(repo)).bisect!;
  assert.notEqual(b.current, ids[11], "가운데 커밋으로 옮긴다");
  assert.ok(b.steps !== null && b.steps >= 1 && b.remaining !== null);

  // 표시는 ⌘Z 기록에 남지 않는다 (브랜치를 옮기지 않는다)
  const undo = await execute(repo, "undo", []);
  assert.equal(undo.ok, false);

  for (let i = 0; i < 10 && !b.first; i++) {
    await run("bisectMark", isBad() ? "bad" : "good", null);
    b = (await readRepo(repo)).bisect!;
  }
  assert.equal(b.first, ids[7]);

  await run("bisectReset");
  const s = await readRepo(repo);
  assert.equal(s.bisect, null);
  assert.equal(s.head, "main");
  assert.equal(sh("rev-parse", "HEAD"), ids[11]);
});

test("커밋하지 않은 변경이 있으면 시작을 거절하고 아무것도 바꾸지 않는다", async () => {
  write("n.txt", "dirty\n");
  const r = await execute(repo, "bisectStart", ["good", ids[0]]);
  assert.equal(r.ok, false);
  assert.match(r.error!, /커밋하지 않은 변경/);
  assert.ok(!fs.existsSync(path.join(repo, ".git", "BISECT_START")));
});

test("터미널에서 시작한 bisect 도 읽고, skip 표시와 reset 이 된다", async () => {
  sh("bisect", "start", ids[11], ids[0]);
  let b = (await readRepo(repo)).bisect!;
  assert.equal(b.bad, ids[11]);
  assert.deepEqual(b.good, [ids[0]]);
  const cur = b.current!;
  await run("bisectMark", "skip", null);
  b = (await readRepo(repo)).bisect!;
  assert.deepEqual(b.skipped, [cur]);
  const again = await execute(repo, "bisectStart", ["bad", ids[5]]);
  assert.equal(again.ok, false, "진행 중이면 새로 시작하지 않는다");
  await run("bisectReset");
  assert.equal((await readRepo(repo)).head, "main");
});
