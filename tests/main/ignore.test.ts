// .gitignore 편집: 패턴 추가 (만들기 · 끝 줄바꿈 · 중복) · exclude · 삭제 · 추적 멈추고 무시 · ⌘Z / 다시 실행 · 경로 검사 · check-ignore
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { ignoreMatches, ignoreWhy, readIgnoreFiles, registerIgnoreOps, safeRel } from "@/git/ops/ignoreOps";
import { readStatus } from "@/git/status";
import { dirPattern, escapeGlob, extPattern, filePattern } from "@shared/ignore";
import type { OpName } from "@shared/types/ipc";

let tmp: string, repo: string;
// 전역 · 시스템 git 설정을 읽지 않게 격리
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
const write = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");
const run = async (op: OpName, ...args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };

beforeAll(() => registerIgnoreOps());
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-ignore-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "T"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  write("a.txt", "a\n"); sh("add", "-A"); sh("commit", "-q", "-m", "base");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("패턴 만들기: 특수 문자 escape · 확장자 · 폴더", () => {
  assert.equal(filePattern("logs/a[1]*.log"), "/logs/a\\[1\\]\\*.log");
  assert.equal(filePattern("#x"), "/\\#x");
  assert.equal(escapeGlob("a  "), "a\\ \\ ");
  assert.equal(extPattern("x/y.log"), "*.log");
  assert.equal(extPattern(".env"), null);
  assert.equal(dirPattern("build/out/a.o"), "/build/out/");
  assert.equal(dirPattern("a.o"), null);
});

test("추적 안 하는 파일 무시: .gitignore 를 만들고, 끝 줄바꿈을 맞추고, 중복은 더하지 않는다 → ⌘Z · 다시 실행", async () => {
  write("debug.log", "x");
  assert.deepEqual((await readStatus(repo)).untracked, ["debug.log"]);
  const r = await run("ignoreAdd", ["/debug.log"], "gitignore");
  assert.ok(r.cmds.some((c) => c.includes("'/debug.log' >> .gitignore")));
  assert.equal(read(".gitignore"), "/debug.log\n");
  assert.ok(!(await readStatus(repo)).untracked?.includes("debug.log"));
  assert.equal(r.undoable, 1);

  const dup = await run("ignoreAdd", ["/debug.log"], "gitignore");
  assert.equal(dup.warnings?.length, 1);
  assert.equal(read(".gitignore"), "/debug.log\n");

  // 끝 줄바꿈이 없는 파일 뒤에 붙일 때
  fs.writeFileSync(path.join(repo, ".gitignore"), "/debug.log");
  await run("ignoreAdd", ["*.tmp"], "gitignore");
  assert.equal(read(".gitignore"), "/debug.log\n*.tmp\n");
  await run("undo");
  assert.equal(read(".gitignore"), "/debug.log");
  await run("redo");
  assert.equal(read(".gitignore"), "/debug.log\n*.tmp\n");
});

test("나만 무시: .git/info/exclude 에 쓰고 .gitignore 는 만들지 않는다. 처음 만든 파일은 ⌘Z 로 지운다", async () => {
  fs.rmSync(path.join(repo, ".git/info/exclude"), { force: true });
  write("secret.env", "k");
  await run("ignoreAdd", ["/secret.env"], "exclude");
  assert.ok(!fs.existsSync(path.join(repo, ".gitignore")));
  assert.deepEqual((await readIgnoreFiles(repo)).exclude, ["/secret.env"]);
  assert.equal((await readStatus(repo)).untracked?.length, 0);
  await run("undo");
  assert.ok(!fs.existsSync(path.join(repo, ".git/info/exclude")));
});

test("패턴 삭제 → ⌘Z 로 되살린다", async () => {
  write(".gitignore", "# c\n*.log\n/build/\n");
  await run("ignoreRemove", "*.log", "gitignore");
  assert.equal(read(".gitignore"), "# c\n/build/\n");
  assert.deepEqual((await readIgnoreFiles(repo)).gitignore, ["/build/"]);
  await run("undo");
  assert.equal(read(".gitignore"), "# c\n*.log\n/build/\n");
  const miss = await execute(repo, "ignoreRemove", ["*.nope", "gitignore"]);
  assert.equal(miss.ok, false);
});

test("추적 멈추고 무시: git rm --cached + .gitignore (삭제로 stage 됨 경고) → ⌘Z 로 index 와 파일을 되돌린다", async () => {
  const r = await run("untrackIgnore", "a.txt", "/a.txt");
  assert.ok(r.cmds.includes("git rm --cached -r -q -- a.txt"));
  assert.equal(r.warnings?.length, 1);
  assert.equal(sh("ls-files", "a.txt"), "");
  assert.ok(fs.existsSync(path.join(repo, "a.txt")));
  assert.equal(read(".gitignore"), "/a.txt\n");
  assert.match(sh("status", "--porcelain"), /^D {2}a\.txt$/m);

  await run("undo");
  assert.equal(sh("ls-files", "a.txt"), "a.txt");
  assert.ok(!fs.existsSync(path.join(repo, ".gitignore")));
  assert.equal(sh("status", "--porcelain"), "");

  await run("redo");
  assert.equal(sh("ls-files", "a.txt"), "");
  assert.equal(read(".gitignore"), "/a.txt\n");
  // 추적 안 하는 파일은 거절
  write("new.txt", "n");
  assert.equal((await execute(repo, "untrackIgnore", ["new.txt", "/new.txt"])).ok, false);
});

test("경로 · 패턴 검사: 저장소 밖 · 절대 경로 · .git · 줄바꿈은 거절한다", async () => {
  for (const bad of ["../x", "/etc/passwd", "a/../../x", ".git/config", "a\nb", "", "./a"]) {
    assert.throws(() => safeRel(repo, bad), `${JSON.stringify(bad)}`);
  }
  assert.equal(safeRel(repo, "dir/a.txt"), "dir/a.txt");
  assert.equal((await execute(repo, "ignoreAdd", [["a\n!b"], "gitignore"])).ok, false);
  assert.equal((await execute(repo, "ignoreAdd", [["x"], "../../etc"])).ok, false);
  assert.equal((await execute(repo, "untrackIgnore", ["../outside", "/x"])).ok, false);
  assert.ok(!fs.existsSync(path.join(repo, ".gitignore")));
});

test("걸리는 파일 미리 보기 · 왜 무시되는가 (git check-ignore -v)", async () => {
  write("build/a.o", "o"); write("build/b.o", "o"); write("keep.o", "k");
  write(".gitignore", "*.o\n!keep.o\n");
  const m = await ignoreMatches(repo, "*.txt");
  assert.deepEqual(m, { untracked: [], tracked: ["a.txt"] });
  assert.deepEqual((await ignoreMatches(repo, "/build/")).untracked.sort(), ["build/a.o", "build/b.o"]);
  assert.deepEqual(await ignoreWhy(repo, "build/a.o"), { source: ".gitignore", line: 1, pattern: "*.o", negated: false });
  assert.deepEqual(await ignoreWhy(repo, "keep.o"), { source: ".gitignore", line: 2, pattern: "!keep.o", negated: true });
  assert.equal(await ignoreWhy(repo, "a.txt"), null);
  await assert.rejects(ignoreWhy(repo, "../x"));
});
