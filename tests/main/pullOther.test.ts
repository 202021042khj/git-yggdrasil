// 체크아웃 안 한 브랜치에 pull 을 임시 저장소(+ 로컬 bare 원격)에서 실제로 실행해 본다
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string, other: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const sh = (...args: string[]) => git(repo, ...args);
const setup = (dir: string) => { git(dir, "config", "user.name", "Tester"); git(dir, "config", "user.email", "t@example.com"); git(dir, "config", "commit.gpgsign", "false"); };
const commitIn = (dir: string, msg: string, files: Record<string, string>) => {
  Object.entries(files).forEach(([f, t]) => fs.writeFileSync(path.join(dir, f), t));
  git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", msg);
  return git(dir, "rev-parse", "HEAD");
};
const run = (op: OpName, args: unknown[]) => execute(repo, op, args);
const msgs = (ref: string, n = 10) => sh("log", `-n${n}`, "--format=%s", ref).split("\n");

// origin(bare) 에 main, feat. repo 는 main 체크아웃 · feat 는 origin/feat 추적. other 는 다른 사람의 복제본.
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-pullother-"));
  const origin = path.join(tmp, "origin.git");
  repo = path.join(tmp, "repo"); other = path.join(tmp, "other");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  setup(repo);
  commitIn(repo, "init", { "a.txt": "1\n2\n3\n" });
  sh("remote", "add", "origin", origin);
  sh("branch", "feat");
  sh("push", "-q", "-u", "origin", "main", "feat");
  execFileSync("git", ["clone", "-q", origin, other]);
  setup(other);
  git(other, "switch", "-q", "feat");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const theyPush = (msg: string, files: Record<string, string>) => { const id = commitIn(other, msg, files); git(other, "push", "-q", "origin", "feat"); return id; };

test("앞으로 감기: 작업 폴더 · 현재 브랜치 그대로, ⌘Z 로 되돌림", async () => {
  const before = sh("rev-parse", "feat");
  const id = theyPush("remote1", { "r.txt": "r\n" });
  fs.writeFileSync(path.join(repo, "a.txt"), "dirty\n");
  const r = await run("pull", ["feat", "merge"]);
  assert.ok(r.ok, r.error);
  assert.equal(sh("rev-parse", "feat"), id);
  assert.equal(sh("branch", "--show-current"), "main");
  assert.equal(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "dirty\n");
  assert.ok(sh("for-each-ref", "refs/yggdrasil/backup").includes(before));
  assert.ok((await execute(repo, "undo", [])).ok);
  assert.equal(sh("rev-parse", "feat"), before);
});

test("갈라졌으면 merge 커밋을 메모리에서 만든다", async () => {
  theyPush("remote1", { "r.txt": "r\n" });
  sh("switch", "-q", "feat"); commitIn(repo, "local1", { "l.txt": "l\n" }); sh("switch", "-q", "main");
  const r = await run("pull", ["feat", "merge"]);
  assert.ok(r.ok, r.error);
  assert.match(msgs("feat", 1)[0], /^Merge remote-tracking branch 'origin\/feat' into feat/);
  assert.equal(sh("rev-list", "--count", "--merges", "feat"), "1");
  assert.equal(sh("show", "feat:r.txt"), "r");
  assert.equal(sh("show", "feat:l.txt"), "l");
});

test("rebase 모드: 로컬 커밋을 원격 위로 올린다", async () => {
  theyPush("remote1", { "r.txt": "r\n" });
  sh("switch", "-q", "feat"); commitIn(repo, "local1", { "l.txt": "l\n" }); sh("switch", "-q", "main");
  const r = await run("pull", ["feat", "rebase"]);
  assert.ok(r.ok, r.error);
  assert.deepEqual(msgs("feat", 3), ["local1", "remote1", "init"]);
  assert.equal(sh("rev-parse", "feat~1"), sh("rev-parse", "origin/feat"));
});

test("충돌이면 아무것도 바꾸지 않고 거절", async () => {
  theyPush("remote1", { "a.txt": "remote\n" });
  sh("switch", "-q", "feat"); commitIn(repo, "local1", { "a.txt": "local\n" }); sh("switch", "-q", "main");
  const before = sh("rev-parse", "feat");
  for (const mode of ["merge", "rebase"]) {
    const r = await run("pull", ["feat", mode]);
    assert.equal(r.ok, false);
    assert.equal(sh("rev-parse", "feat"), before);
  }
});

test("pull.ff=only 이면 갈라진 브랜치는 거절", async () => {
  sh("config", "pull.ff", "only");
  theyPush("remote1", { "r.txt": "r\n" });
  sh("switch", "-q", "feat"); commitIn(repo, "local1", { "l.txt": "l\n" }); sh("switch", "-q", "main");
  const before = sh("rev-parse", "feat");
  const r = await run("pull", ["feat", "merge"]);
  assert.equal(r.ok, false);
  assert.equal(sh("rev-parse", "feat"), before);
});

test("upstream 이 없으면 거절", async () => {
  sh("branch", "lonely");
  const r = await run("pull", ["lonely", "merge"]);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /upstream/);
});
