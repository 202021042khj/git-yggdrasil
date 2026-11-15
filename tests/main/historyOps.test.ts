// 3단계 히스토리 조작 + 되돌리기 + 원격 관리를 임시 저장소에서 실제로 실행해 본다
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import type { OpExtra, OpName } from "@shared/types/ipc";


let tmp: string, repo: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (f: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text); };
const commit = (msg: string, files: Record<string, string>) => { Object.entries(files).forEach(([f, t]) => write(f, t)); sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", msg); return sh(repo, "rev-parse", "HEAD"); };
const run = async (op: OpName, args: unknown[], extra?: OpExtra) => { const r = await execute(repo, op, args, extra); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const msgs = (ref: string, n = 10) => sh(repo, "log", `-n${n}`, "--format=%s", ref).split("\n");
const tip = (ref: string) => sh(repo, "rev-parse", ref);

// main: init ─ m1 ─ m2        feat: (from init) f1 ─ f2 ─ f3        fix: (from m1) x1 (app.js 수정)
const ids: Record<string, string> = {};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-hist-"));
  repo = path.join(tmp, "repo");
  sh(tmp, "init", "-q", "-b", "main", repo);
  sh(repo, "config", "user.name", "Tester"); sh(repo, "config", "user.email", "t@example.com"); sh(repo, "config", "commit.gpgsign", "false");
  ids.init = commit("init", { "app.js": "1\n", "README.md": "r\n" });
  ids.m1 = commit("m1", { "README.md": "r2\n" });
  ids.m2 = commit("m2", { "docs.md": "d\n" });
  sh(repo, "switch", "-q", "-c", "feat", ids.init);
  ids.f1 = commit("f1", { "login.js": "l1\n" });
  ids.f2 = commit("f2", { "api.js": "a\n", "app.js": "1\n2\n" });
  ids.f3 = commit("f3", { "login.test.js": "t\n" });
  sh(repo, "switch", "-q", "-c", "fix", ids.m1);
  ids.x1 = commit("x1", { "app.js": "fixed\n" });
  sh(repo, "switch", "-q", "main");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("체크아웃 안 한 브랜치에 cherry-pick (작업 영역 그대로)", async () => {
  await run("cherryPick", [[ids.m2], "feat"]);
  assert.deepEqual(msgs("feat", 4), ["m2", "f3", "f2", "f1"]);
  assert.equal(sh(repo, "branch", "--show-current"), "main");
});

test("충돌이 나면 아무것도 바꾸지 않고 충돌 파일을 알려 준다", async () => {
  const before = tip("feat");
  const r = await execute(repo, "cherryPick", [[ids.x1], "feat"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ["app.js"]);
  assert.equal(tip("feat"), before);
});

test("줄기 rebase (현재 브랜치가 아닌 feat 를 main 위로)", async () => {
  await run("rebaseStem", ["feat", tip("main")], { base: ids.init });
  assert.deepEqual(msgs("feat", 6), ["f3", "f2", "f1", "m2", "m1", "init"]);
});

test("현재 브랜치 rebase 는 작업 영역도 따라간다", async () => {
  sh(repo, "switch", "-q", "feat");
  await run("rebaseStem", ["feat", tip("main")], { base: ids.init });
  assert.ok(fs.existsSync(path.join(repo, "docs.md")));
  assert.equal(sh(repo, "status", "--porcelain"), "");
});

test("커밋 옮기기 (feat → main, feat 에서는 빠짐)", async () => {
  await run("moveCommit", [ids.f1, "main"], { from: "feat" });
  assert.deepEqual(msgs("main", 2), ["f1", "m2"]);
  assert.deepEqual(msgs("feat", 3), ["f3", "f2", "init"]);
});

test("커밋 제거 · 합치기 · 순서 바꾸기", async () => {
  await run("dropCommit", [ids.f2], { from: "feat" });
  assert.deepEqual(msgs("feat", 3), ["f3", "f1", "init"]);
  const [f3, f1] = sh(repo, "rev-list", "-n2", "feat").split("\n");
  await run("squash", [f3, f1], { from: "feat" });
  assert.deepEqual(msgs("feat", 2), ["f1", "init"]);
  assert.ok(sh(repo, "show", "--name-only", "--format=", "feat").includes("login.test.js"));
});

test("순서 바꾸기", async () => {
  await run("reorder", [ids.f3, "feat", 0], { stem: [ids.f1, ids.f2, ids.f3], base: ids.init });
  assert.deepEqual(msgs("feat", 4), ["f2", "f1", "f3", "init"]);
});

test("merge: 체크아웃 안 한 브랜치에 (merge 커밋) · 현재 브랜치에", async () => {
  sh(repo, "branch", "side", ids.m2);
  await run("merge", ["feat", "side"]);
  assert.match(msgs("side", 1)[0], /Merge branch 'feat' into side/);
  assert.equal(sh(repo, "rev-list", "--parents", "-n1", "side").split(" ").length, 3);
  assert.equal(sh(repo, "branch", "--show-current"), "main");
  await run("merge", ["feat", "main"]);
  assert.match(msgs("main", 1)[0], /Merge branch 'feat'/);
  assert.ok(fs.existsSync(path.join(repo, "login.js")), "현재 브랜치 merge 는 작업 영역도 갱신");
});

test("merge 충돌이면 아무것도 바꾸지 않는다 (fix 와 feat 가 모두 app.js 수정)", async () => {
  const before = tip("fix");
  const r = await execute(repo, "merge", ["feat", "fix"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, ["app.js"]);
  assert.equal(tip("fix"), before);
});

test("여러 커밋을 한꺼번에 cherry-pick (떨어진 커밋도, 오래된 것부터)", async () => {
  await run("cherryPick", [[ids.f1, ids.f3], "main"]);
  assert.deepEqual(msgs("main", 4), ["f3", "f1", "m2", "m1"]);
  assert.equal(fs.existsSync(path.join(repo, "api.js")), false, "사이의 f2 는 가져오지 않는다");
});

test("커밋 정리: 순서 바꾸기 · 메시지 수정 · squash · 빼기를 한 번에 (체크아웃 없이)", async () => {
  // feat: f1 ─ f2 ─ f3  →  f3(새 메시지) ─ f1+f2(합친 메시지), 그리고 아무것도 빼지 않은 경우와 뺀 경우
  await run("rebasePlan", ["feat", [
    { id: ids.f3, action: "reword", msg: "테스트 먼저" },
    { id: ids.f1, action: "pick" },
    { id: ids.f2, action: "squash", msg: "로그인과 API" },
  ]], { base: ids.init });
  assert.deepEqual(msgs("feat", 3), ["로그인과 API", "테스트 먼저", "init"]);
  assert.deepEqual(sh(repo, "show", "--name-only", "--format=", "feat").split("\n").sort(), ["api.js", "app.js", "login.js"]);
  assert.equal(sh(repo, "branch", "--show-current"), "main", "작업 영역은 그대로");
  const tipBefore = tip("feat");
  const bad = await execute(repo, "rebasePlan", ["feat", [{ id: sh(repo, "rev-parse", "feat~1"), action: "drop" }, { id: tipBefore, action: "fixup" }]], { base: ids.init });
  assert.equal(bad.ok, false, "남는 첫 커밋이 fixup 이면 거부");
  assert.match(bad.error ?? "", /합칠 커밋이 없습니다/);
  await run("rebasePlan", ["feat", [{ id: sh(repo, "rev-parse", "feat~1"), action: "drop" }, { id: tipBefore, action: "pick" }]], { base: ids.init });
  assert.deepEqual(msgs("feat", 2), ["로그인과 API", "init"]);
  const stale = await execute(repo, "rebasePlan", ["feat", [{ id: ids.f1, action: "pick" }]], { base: ids.init });
  assert.equal(stale.ok, false, "브랜치와 맞지 않는 계획은 거부");
});

test("커밋 정리: 충돌이 나면 현재 브랜치에서는 실제 rebase -i 로 멈추고, 해결 후 계속하면 계획대로", async () => {
  // fix: x1(app.js=fixed) ─ x2(app.js=again). x1 을 빼면 x2 가 m1 위에서 app.js 충돌
  sh(repo, "switch", "-q", "fix");
  write("app.js", "again\n"); sh(repo, "commit", "-qam", "x2");
  const x2 = tip("fix");
  const r = await run("rebasePlan", ["fix", [{ id: ids.x1, action: "drop" }, { id: x2, action: "reword", msg: "x2 만 남김" }]], { base: ids.m1 });
  assert.match(r.warnings?.[0] ?? "", /충돌로 멈췄습니다/);
  write("app.js", "again\n"); sh(repo, "add", "app.js");
  await run("continueOp", []);
  assert.deepEqual(msgs("fix", 2), ["x2 만 남김", "m1"], "멈췄다 이어서도 메시지가 바뀐다 (exec amend)");
  assert.equal(fs.readFileSync(path.join(repo, "app.js"), "utf8"), "again\n");
});

test("되돌리기: rebase → undo 하면 원래 위치", async () => {
  const before = tip("feat");
  await run("rebaseStem", ["feat", tip("main")], { base: ids.init });
  await run("undo", []);
  assert.equal(tip("feat"), before);
});

test("되돌리기: 커밋 → undo 하면 변경은 Staged 로 남는다", async () => {
  write("new.txt", "n\n");
  await run("commitTo", ["main", "add new"]);
  await run("undo", []);
  assert.equal(msgs("main", 1)[0], "m2");
  assert.match(sh(repo, "status", "--porcelain"), /^A {2}new\.txt/m);
});

test("되돌리기: 브랜치 생성 → undo 하면 삭제", async () => {
  await run("createBranch", ["tmp", ids.m1]);
  await run("undo", []);
  assert.equal(sh(repo, "branch", "--list", "tmp"), "");
});

test("다시 실행: rebase → undo → redo 하면 rebase 결과로 돌아간다", async () => {
  await run("rebaseStem", ["feat", tip("main")], { base: ids.init });
  const rebased = tip("feat");
  const u = await run("undo", []);
  assert.equal(u.redoable, 1);
  await run("redo", []);
  assert.equal(tip("feat"), rebased);
  await run("undo", []);
  assert.notEqual(tip("feat"), rebased);
});

test("다시 실행: 커밋 → undo → redo 하면 같은 커밋, 작업 영역 깨끗", async () => {
  write("new.txt", "n\n");
  await run("commitTo", ["main", "add new"]);
  const made = tip("main");
  await run("undo", []);
  await run("redo", []);
  assert.equal(tip("main"), made);
  assert.equal(sh(repo, "status", "--porcelain"), "");
});

test("다시 실행: 브랜치 생성·이름 변경, 새 조작을 하면 redo 기록이 사라진다", async () => {
  await run("createBranch", ["tmp", ids.m1]);
  await run("renameBranch", ["tmp", "tmp2", false]);
  await run("undo", []);
  await run("undo", []);
  assert.equal(sh(repo, "branch", "--list", "tmp*"), "");
  await run("redo", []);
  await run("redo", []);
  assert.equal(tip("tmp2"), ids.m1);
  await run("undo", []);
  const r = await run("moveBranch", ["feat", ids.f1]);
  assert.equal(r.redoable, 0);
  assert.equal((await execute(repo, "redo", [])).ok, false);
});

test("reset --mixed 와 브랜치 포인터 옮기기", async () => {
  await run("resetHead", [ids.m1, "mixed"]);
  assert.equal(tip("main"), ids.m1);
  assert.match(sh(repo, "status", "--porcelain"), /docs\.md/);
  await run("moveBranch", ["feat", ids.f1]);
  assert.equal(tip("feat"), ids.f1);
});

test("원격 추가 · 주소 변경 · 삭제, 원격 없이 push 하면 NO_REMOTE", async () => {
  const r0 = await execute(repo, "push", ["main"]);
  assert.equal(r0.code, "NO_REMOTE");
  const bare = path.join(tmp, "remote.git");
  sh(tmp, "init", "-q", "--bare", bare);
  await run("remoteAdd", ["origin", bare]);
  await run("push", ["main"]);
  assert.equal(sh(bare, "rev-parse", "main"), tip("main"));
  await run("remoteSetUrl", ["origin", bare + "x"]);
  assert.equal(sh(repo, "remote", "get-url", "origin"), bare + "x");
  await run("remoteRemove", ["origin"]);
  assert.equal(sh(repo, "remote"), "");
});

test("브랜치 이름 변경 → 되돌리기", async () => {
  await run("renameBranch", ["feat", "feature", false]);
  assert.equal(sh(repo, "branch", "--list", "feat"), "");
  assert.ok(sh(repo, "branch", "--list", "feature").length > 0);
  await run("undo", []);
  assert.equal(sh(repo, "branch", "--list", "feature"), "");
  assert.ok(sh(repo, "branch", "--list", "feat").length > 0);
});

test("현재 브랜치 이름 변경 + 원격까지 반영", async () => {
  const bare = path.join(tmp, "remote.git");
  sh(tmp, "init", "-q", "--bare", "-b", "main", bare);
  sh(repo, "remote", "add", "origin", bare);
  sh(repo, "push", "-q", "-u", "origin", "main");
  const r = await run("renameBranch", ["main", "dev", true]);
  assert.equal(sh(repo, "branch", "--show-current"), "dev");
  assert.equal(sh(repo, "rev-parse", "--abbrev-ref", "dev@{u}"), "origin/dev");
  assert.ok(sh(bare, "branch", "--list", "dev").length > 0);
  // main 은 원격의 기본 브랜치라 지울 수 없다 → 실패가 아니라 경고
  assert.equal(r.warnings!.length, 1);
  assert.match(r.warnings![0], /기본 브랜치/);

  // 기본 브랜치가 아닌 브랜치는 원격에서 옛 이름까지 지운다
  sh(repo, "push", "-q", "-u", "origin", "feat");
  await run("renameBranch", ["feat", "feature", true]);
  assert.equal(sh(bare, "branch", "--list", "feat"), "");
  assert.ok(sh(bare, "branch", "--list", "feature").length > 0);
});

test("원격에만 있는 브랜치를 로컬로 가져오기", async () => {
  const bare = path.join(tmp, "remote.git");
  sh(tmp, "init", "-q", "--bare", "-b", "main", bare);
  sh(repo, "remote", "add", "origin", bare);
  sh(repo, "push", "-q", "origin", "feat:topic");
  sh(repo, "fetch", "-q", "origin");
  await run("checkoutRemote", ["origin/topic"]);
  assert.equal(sh(repo, "branch", "--show-current"), "topic");
  assert.equal(sh(repo, "rev-parse", "--abbrev-ref", "topic@{u}"), "origin/topic");
  const again = await execute(repo, "checkoutRemote", ["origin/topic"]);
  assert.equal(again.ok, false);
});
