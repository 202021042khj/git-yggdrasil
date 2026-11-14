// P3: 태그 · 과거 커밋 체크아웃 · upstream · 원격 브랜치 삭제 · 부분 stage · 커밋 분할 · 검색 · 파일 히스토리 · blame
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { execute } from "@/git/ops/execute";
import { registerP3Ops } from "@/git/ops/p3Ops";
import { readRepo } from "@/git/readRepo";
import { blame, fileHistory, hunks, searchCommits } from "@/git/query";
import type { OpExtra, OpName } from "@shared/types/ipc";

let tmp: string, repo: string, bare: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (f: string, t: string) => fs.writeFileSync(path.join(repo, f), t);
const commit = (msg: string, files: Record<string, string>) => {
  Object.entries(files).forEach(([f, t]) => write(f, t));
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", msg);
  return sh(repo, "rev-parse", "HEAD");
};
const run = async (op: OpName, args: unknown[] = [], extra?: OpExtra) => {
  const r = await execute(repo, op, args, extra);
  assert.ok(r.ok, `${op} 실패: ${r.error}`);
  return r;
};
const lines = (n: number, tag = "") => Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join("\n") + "\n";

let ids: Record<string, string>;

beforeAll(() => registerP3Ops());
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-p3-"));
  repo = path.join(tmp, "repo");
  bare = path.join(tmp, "remote.git");
  sh(tmp, "init", "-q", "--bare", "-b", "main", bare);
  sh(tmp, "init", "-q", "-b", "main", repo);
  sh(repo, "config", "user.name", "Tester");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "commit.gpgsign", "false");
  sh(repo, "remote", "add", "origin", bare);
  ids = {};
  ids.a = commit("add app", { "app.js": lines(30) });
  ids.b = commit("Fix login bug", { "login.js": "login\n" });
  ids.c = commit("tweak app", { "app.js": lines(30, "!") });
  sh(repo, "push", "-q", "-u", "origin", "main");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("태그: 만들기(일반·주석) → 옮기기 → push → 삭제", async () => {
  await run("tagCreate", ["v1", ids.a]);
  await run("tagCreate", ["v2", ids.b, "두 번째 릴리스"]);
  let st = await readRepo(repo);
  assert.equal(st.tags!.v1.target, ids.a);
  assert.equal(st.tags!.v2.annotated, true);
  assert.equal(st.tags!.v2.message, "두 번째 릴리스");

  await run("tagMove", ["v2", ids.c]);
  st = await readRepo(repo);
  assert.equal(st.tags!.v2.target, ids.c);
  assert.equal(st.tags!.v2.message, "두 번째 릴리스", "주석 태그는 옮겨도 메시지 유지");

  await run("tagPush", ["v2"]);
  assert.ok(sh(bare, "tag", "--list", "v2").length > 0);
  await run("tagDelete", ["v1"]);
  assert.equal((await readRepo(repo)).tags!.v1, undefined);
});

test("과거 커밋 임시 체크아웃 → 브랜치 없이 보기 → 새 브랜치로 이어가기", async () => {
  const r = await run("checkoutCommit", [ids.a]);
  assert.match(r.warnings![0], /임시로 체크아웃/);
  const st = await readRepo(repo);
  assert.equal(st.head, "");
  assert.equal(st.detached, ids.a);
  await run("switchCreate", ["from-old"]);
  assert.equal(sh(repo, "branch", "--show-current"), "from-old");
});

test("upstream 설정·해제와 원격 브랜치 삭제", async () => {
  sh(repo, "branch", "topic");
  sh(repo, "push", "-q", "origin", "topic");
  sh(repo, "fetch", "-q");
  await run("setUpstream", ["topic", "origin/topic"]);
  assert.equal(sh(repo, "rev-parse", "--abbrev-ref", "topic@{u}"), "origin/topic");
  await run("setUpstream", ["topic", ""]);
  assert.throws(() => sh(repo, "rev-parse", "--abbrev-ref", "topic@{u}"));
  await run("deleteRemoteBranch", ["origin/topic"]);
  assert.equal(sh(bare, "branch", "--list", "topic"), "");
  const main = await execute(repo, "deleteRemoteBranch", ["origin/main"]);
  assert.equal(main.ok, false, "원격 기본 브랜치는 지울 수 없다");
  assert.match(main.error ?? "", /기본 브랜치/);
});

test("부분 stage: 한 파일의 변경 덩어리 중 하나만 stage → 다시 unstage", async () => {
  const t = lines(30, "!").split("\n");
  t[1] = "CHANGED TOP";
  t[27] = "CHANGED BOTTOM";
  write("app.js", t.join("\n"));
  const before = await hunks(repo, "app.js", false);
  assert.equal(before.length, 2, "멀리 떨어진 두 변경은 덩어리 두 개");
  await run("stageHunk", ["app.js", 1, false]); // 아래쪽만 stage
  const staged = sh(repo, "diff", "--cached");
  assert.match(staged, /CHANGED BOTTOM/);
  assert.doesNotMatch(staged, /CHANGED TOP/);
  assert.match(sh(repo, "diff"), /CHANGED TOP/, "위쪽은 아직 unstaged");
  const st = await readRepo(repo);
  assert.ok(st.working.staged.includes("app.js") && st.working.unstaged.includes("app.js"), "일부만 stage 한 파일은 양쪽에");
  await run("stageHunk", ["app.js", 0, true]); // stage 된 덩어리 되돌리기
  assert.equal(sh(repo, "diff", "--cached"), "");
});

test("줄 단위 stage: 한 덩어리 안에서 고른 줄만 stage → 고른 줄만 unstage", async () => {
  const t = lines(10, "!").split("\n");
  const old5 = t[4];
  t[3] = "NEW 4"; t[4] = "NEW 5"; // 붙어 있는 두 줄 변경 = 한 덩어리
  write("app.js", t.join("\n"));
  const [h] = await hunks(repo, "app.js", false);
  const pick = [h.lines.indexOf("-" + old5), h.lines.indexOf("+NEW 5")];
  assert.ok(pick.every((i) => i >= 0));
  await run("stageHunk", ["app.js", 0, false, pick]); // 5번째 줄 변경만
  const staged = sh(repo, "diff", "--cached");
  assert.match(staged, /\+NEW 5/);
  assert.doesNotMatch(staged, /NEW 4/);
  assert.match(sh(repo, "diff"), /\+NEW 4/);
  // stage 된 쪽에서 다시 그 줄만 unstage
  const [sh0] = await hunks(repo, "app.js", true);
  const idx = sh0.lines.map((l, i) => (/^[+-]/.test(l) ? i : -1)).filter((i) => i >= 0);
  await run("stageHunk", ["app.js", 0, true, idx]);
  assert.equal(sh(repo, "diff", "--cached"), "");
  assert.match(sh(repo, "diff"), /\+NEW 5/, "작업 영역은 그대로");
});

test("PR 받아 보기: pull/N/head 를 pr/N 브랜치로, 다시 받으면 앞으로 감기", async () => {
  const prRemote = path.join(tmp, "pr-remote.git");
  execFileSync("git", ["init", "-q", "--bare", prRemote]);
  sh(repo, "remote", "add", "gh", prRemote);
  sh(repo, "push", "-q", "gh", `${ids.a}:refs/pull/5/head`);
  const r = await run("checkoutPull", [5, "gh"]);
  assert.match(r.cmds.join("\n"), /fetch gh pull\/5\/head/);
  assert.equal(sh(repo, "branch", "--show-current"), "pr/5");
  assert.equal(sh(repo, "rev-parse", "HEAD"), ids.a);
  sh(repo, "switch", "-q", "main");
  sh(repo, "push", "-q", "-f", "gh", `${ids.b}:refs/pull/5/head`); // PR 에 새 커밋
  await run("checkoutPull", [5, "gh"]);
  assert.equal(sh(repo, "rev-parse", "pr/5"), ids.b);
  assert.equal((await execute(repo, "checkoutPull", [5, "--upload-pack=x"])).ok, false, "옵션처럼 보이는 원격 이름 거부");
});

test("커밋 분할: 끝 커밋은 바로 풀고, 과거 커밋은 멈춘 뒤 나눠 커밋하고 계속", async () => {
  // 끝 커밋
  await run("splitCommit", [ids.c]);
  assert.equal(sh(repo, "log", "-1", "--format=%s"), "Fix login bug");
  assert.match(sh(repo, "status", "--porcelain"), /app\.js/);
  sh(repo, "checkout", "--", "app.js");

  // 과거 커밋: 파일 두 개를 바꾼 커밋을 둘로 나누기
  const two = commit("two files", { "x.txt": "x\n", "y.txt": "y\n" });
  commit("after", { "z.txt": "z\n" });
  const r = await run("splitCommit", [two]);
  assert.match(r.warnings![0], /멈췄습니다/);
  let op = (await readRepo(repo)).op!;
  assert.equal(op.kind, "split");
  assert.deepEqual(op.current?.files?.sort(), ["x.txt", "y.txt"]);
  const blocked = await execute(repo, "continueOp", []);
  assert.equal(blocked.ok, false, "남은 변경이 있으면 계속할 수 없다");
  await run("commitTo", ["main", "x only", ["x.txt"]]);
  await run("commitTo", ["main", "y only", ["y.txt"]]);
  await run("continueOp");
  assert.equal((await readRepo(repo)).op, null);
  assert.deepEqual(sh(repo, "log", "-4", "--format=%s").split("\n"), ["after", "y only", "x only", "Fix login bug"]);
});

test("커밋 분할은 작업 영역에 변경이 있으면 거절", async () => {
  write("app.js", "dirty\n");
  const r = await execute(repo, "splitCommit", [ids.b]);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /작업 영역에 변경/);
});

test("검색: 메시지(대소문자 무시) · 작성자 · 커밋 ID", async () => {
  assert.deepEqual((await searchCommits(repo, "login BUG")).map((h) => h.msg), ["Fix login bug"]);
  assert.equal((await searchCommits(repo, "tester")).length, 3);
  assert.equal((await searchCommits(repo, ids.a.slice(0, 8)))[0].id, ids.a);
  assert.deepEqual(await searchCommits(repo, "   "), []);
});

test("파일 히스토리는 이름 변경을 따라가고, blame 은 줄마다 커밋을 알려 준다", async () => {
  sh(repo, "mv", "app.js", "main.js");
  sh(repo, "commit", "-q", "-m", "rename app → main");
  const hist = await fileHistory(repo, "main.js");
  assert.deepEqual(hist.map((h) => h.msg), ["rename app → main", "tweak app", "add app"]);
  assert.equal(hist[2].path, "app.js");

  const b = await blame(repo, "main.js");
  assert.equal(b.length, 30);
  assert.equal(b[0].summary, "tweak app");
  assert.equal(b[0].author, "Tester");
  assert.equal(b[0].text, "line 1!");
});
