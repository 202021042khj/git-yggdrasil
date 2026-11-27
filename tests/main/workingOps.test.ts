// 체크아웃 안 한 브랜치에 바로 커밋 · 과거 커밋에 변경 합치기(fixup) 를 임시 저장소에서 실제로 실행해 본다
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const write = (f: string, text: string) => fs.writeFileSync(path.join(repo, f), text);
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");
const commit = (msg: string, files: Record<string, string>) => { Object.entries(files).forEach(([f, t]) => write(f, t)); sh("add", "-A"); sh("commit", "-q", "-m", msg); return sh("rev-parse", "HEAD"); };
const run = async (op: OpName, args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const msgs = (ref: string, n = 10) => sh("log", `-n${n}`, "--format=%s", ref).split("\n");
const staged = () => sh("diff", "--cached", "--name-only");

// main: init ─ m1 ─ m2 ─ m3        side: (from init) s1
const ids: Record<string, string> = {};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-work-"));
  repo = path.join(tmp, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  sh("config", "user.name", "Tester"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  ids.init = commit("init", { "a.txt": "1\n2\n3\n", "b.txt": "b\n" });
  ids.m1 = commit("m1", { "c.txt": "c\n" });
  ids.m2 = commit("m2", { "a.txt": "1\n2\n3\n4\n" });
  ids.m3 = commit("m3", { "d.txt": "d\n" });
  sh("branch", "side", ids.init);
  sh("switch", "-q", "side");
  ids.s1 = commit("s1", { "s.txt": "s\n" });
  sh("switch", "-q", "main");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("체크아웃 안 한 브랜치에 staged 변경을 바로 커밋 (작업 폴더 그대로, Staged 에서 빠짐)", async () => {
  write("b.txt", "b changed\n"); sh("add", "b.txt");
  write("c.txt", "unstaged\n");
  const mainTip = sh("rev-parse", "main");
  await run("commitTo", ["side", "fix b"]);
  assert.deepEqual(msgs("side", 3), ["fix b", "s1", "init"]);
  assert.equal(sh("show", "side:b.txt"), "b changed");
  assert.equal(sh("show", "side:s.txt"), "s", "side 의 기존 내용 유지");
  assert.equal(sh("rev-parse", "main"), mainTip);
  assert.equal(sh("branch", "--show-current"), "main");
  assert.equal(staged(), "");
  assert.equal(read("b.txt"), "b changed\n", "작업 폴더는 그대로");
  assert.equal(read("c.txt"), "unstaged\n");
});

test("경로만 골라 다른 브랜치에 커밋", async () => {
  write("b.txt", "b2\n"); write("new.txt", "n\n");
  await run("commitTo", ["side", "add new", ["new.txt"]]);
  assert.equal(sh("show", "side:new.txt"), "n");
  assert.equal(sh("show", "side:b.txt"), "b", "고르지 않은 파일은 안 들어감");
});

test("다른 브랜치에 적용하면 충돌이면 아무것도 바꾸지 않는다", async () => {
  sh("switch", "-q", "side"); commit("s2", { "a.txt": "1\n2\nthree\n" }); sh("switch", "-q", "main");
  const side = sh("rev-parse", "side");
  write("a.txt", "1\n2\nX\n4\n"); sh("add", "a.txt");
  const r = await execute(repo, "commitTo", ["side", "conflict"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ["a.txt"]);
  assert.equal(sh("rev-parse", "side"), side);
  assert.equal(staged(), "a.txt", "staged 그대로");
});

test("다른 브랜치 커밋은 ⌘Z 로 되돌린다", async () => {
  write("b.txt", "b changed\n"); sh("add", "b.txt");
  await run("commitTo", ["side", "fix b"]);
  await run("undo", []);
  assert.equal(sh("rev-parse", "side"), ids.s1);
  assert.equal(read("b.txt"), "b changed\n");
});

test("과거 커밋에 staged 변경을 합치고 뒤 커밋을 다시 올린다", async () => {
  write("c.txt", "c fixed\n"); sh("add", "c.txt");
  write("d.txt", "d unstaged\n");
  await run("amendInto", [ids.m1, ""]);
  assert.deepEqual(msgs("main", 4), ["m3", "m2", "m1", "init"]);
  assert.equal(sh("show", "main~2:c.txt"), "c fixed", "m1 에 합쳐짐");
  assert.equal(sh("show", "main~2:a.txt"), "1\n2\n3", "m1 의 다른 내용은 그대로");
  assert.equal(staged(), "");
  assert.equal(read("d.txt"), "d unstaged\n", "unstaged 변경은 그대로");
  assert.equal(sh("diff", "--name-only"), "d.txt");
});

test("과거 커밋 fixup: 뒤 커밋과 충돌하면 아무것도 바꾸지 않는다", async () => {
  write("a.txt", "1\n2\nZ\n4\n"); sh("add", "a.txt"); // m2 가 고친 맥락과 겹친다 → m1 에 넣고 m2 를 다시 올리면 충돌
  const tip = sh("rev-parse", "main");
  const r = await execute(repo, "amendInto", [ids.m1, ""]);
  assert.equal(r.ok, false);
  assert.equal(sh("rev-parse", "main"), tip);
  assert.equal(staged(), "a.txt");
});

test("과거 커밋 fixup: 뒤에 merge 커밋이 있어도 merge 로 다시 만든다", async () => {
  sh("merge", "-q", "--no-ff", "-m", "merge side", "side");
  write("c.txt", "c fixed\n"); sh("add", "c.txt");
  await run("amendInto", [ids.m1, ""]);
  assert.deepEqual(sh("log", "--first-parent", "--format=%s", "main").split("\n"), ["merge side", "m3", "m2", "m1", "init"]);
  assert.equal(sh("rev-parse", "main^2"), ids.s1, "곁가지 부모는 그대로");
  assert.equal(sh("show", "main:c.txt"), "c fixed");
  assert.equal(sh("show", "main:s.txt"), "s");
  assert.equal(staged(), "");
});

test("merge 커밋 자체에도 변경을 합칠 수 있다", async () => {
  sh("merge", "-q", "--no-ff", "-m", "merge side", "side");
  ids.m4 = commit("m4", { "e.txt": "e\n" });
  write("s.txt", "s fixed\n"); sh("add", "s.txt");
  await run("amendInto", [sh("rev-parse", "main~1"), ""]);
  assert.equal(sh("rev-list", "--parents", "-n1", "main~1").split(" ").length, 3);
  assert.equal(sh("show", "main~1:s.txt"), "s fixed");
});

test("과거 커밋 fixup 은 ⌘Z 로 되돌리고 변경은 다시 Staged 로", async () => {
  const tip = sh("rev-parse", "main");
  write("c.txt", "c fixed\n"); sh("add", "c.txt");
  await run("amendInto", [ids.m1, ""]);
  await run("undo", []);
  assert.equal(sh("rev-parse", "main"), tip);
  assert.equal(staged(), "c.txt");
  await run("redo", []);
  assert.equal(sh("show", "main~2:c.txt"), "c fixed");
});
