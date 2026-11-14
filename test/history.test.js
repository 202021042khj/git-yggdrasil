// 3단계 히스토리 조작 + 되돌리기 + 원격 관리를 임시 저장소에서 실제로 실행해 본다
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { execute } = require("../src/main/ops");

let tmp, repo;
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text); };
const commit = (msg, files) => { Object.entries(files).forEach(([f, t]) => write(f, t)); sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", msg); return sh(repo, "rev-parse", "HEAD"); };
const run = async (op, args, extra) => { const r = await execute(repo, op, args, extra); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const msgs = (ref, n = 10) => sh(repo, "log", `-n${n}`, "--format=%s", ref).split("\n");
const tip = (ref) => sh(repo, "rev-parse", ref);

// main: init ─ m1 ─ m2        feat: (from init) f1 ─ f2 ─ f3        fix: (from m1) x1 (app.js 수정)
let ids = {};
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
  assert.match(sh(repo, "status", "--porcelain"), /^A  new\.txt/m);
});

test("되돌리기: 브랜치 생성 → undo 하면 삭제", async () => {
  await run("createBranch", ["tmp", ids.m1]);
  await run("undo", []);
  assert.equal(sh(repo, "branch", "--list", "tmp"), "");
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
