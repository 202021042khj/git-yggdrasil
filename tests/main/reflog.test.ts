// 예전 커밋 찾기: reflog 읽기, 잃어버린 커밋 판별, 살리기
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describeAction, readReflog } from "@/git/reflog";
import { execute } from "@/git/ops/execute";

let tmp: string, repo: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commit = (msg: string) => { fs.writeFileSync(path.join(repo, "f.txt"), msg + "\n"); sh("add", "-A"); sh("commit", "-q", "-m", msg); return sh("rev-parse", "HEAD"); };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-reflog-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("reflog 문구를 우리말로", () => {
  assert.deepEqual(describeAction("checkout: moving from main to feat"), { action: "체크아웃", detail: "main → feat" });
  assert.deepEqual(describeAction("commit (amend): 고침"), { action: "커밋 수정(amend)", detail: "고침" });
  assert.equal(describeAction("rebase (finish): returning to refs/heads/x").action, "rebase finish");
  assert.equal(describeAction("reset: moving to HEAD~1").action, "되돌리기(reset)");
});

test("reset 으로 버린 커밋은 잃어버림으로 표시되고, 브랜치로 살리면 표시가 사라진다", async () => {
  commit("one");
  const two = commit("two");
  sh("reset", "-q", "--hard", "HEAD~1"); // 앱 밖에서 버림 → 되돌리기 기록에는 없다
  let list = await readReflog(repo);
  const lostTwo = list.find((e) => e.id === two)!;
  assert.equal(lostTwo.lost, true);
  assert.equal(lostTwo.subject, "two");
  assert.ok(list.some((e) => e.action === "되돌리기(reset)"));
  assert.deepEqual(list.map((e) => e.date), [...list.map((e) => e.date)].sort((a, b) => b - a), "최신 순");

  assert.ok((await execute(repo, "createBranch", ["rescue/two", two])).ok);
  list = await readReflog(repo);
  assert.equal(list.find((e) => e.id === two)!.lost, false);
});

test("앱 백업 ref 도 함께 보이지만, 백업만 가리키는 커밋은 잃어버림으로 본다", async () => {
  commit("one");
  const two = commit("two");
  const r = await execute(repo, "resetHead", [sh("rev-parse", "HEAD~1"), "keep"]);
  assert.ok(r.ok, r.error);
  assert.equal(sh("status", "--porcelain"), "", "keep 은 파일까지 맞춘다");
  const list = await readReflog(repo);
  const backup = list.find((e) => e.source === "backup");
  assert.equal(backup?.id, two);
  assert.equal(backup?.lost, true);
});
