// 2단계 조작을 임시 저장소에서 실제 git 으로 실행해 본다: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { execute } = require("../src/main/ops");
const { readRepo } = require("../src/main/git");

let tmp, remote, repo, other;
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const ident = (dir) => { sh(dir, "config", "user.name", "Tester"); sh(dir, "config", "user.email", "tester@example.com"); sh(dir, "config", "commit.gpgsign", "false"); };
const run = async (op, ...args) => {
  const r = await execute(repo, op, args);
  assert.ok(r.ok, `${op} 실패: ${r.error}`);
  return r;
};
const msgs = (dir, n = 10) => sh(dir, "log", `-n${n}`, "--format=%s").split("\n");

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-canvas-test-"));
  remote = path.join(tmp, "remote.git");
  repo = path.join(tmp, "repo");
  other = path.join(tmp, "other");
  sh(tmp, "init", "-q", "--bare", "-b", "main", remote);
  sh(tmp, "init", "-q", "-b", "main", repo);
  ident(repo);
  write(repo, "README.md", "hello\n");
  write(repo, "src/a.js", "a\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "init");
  write(repo, "src/a.js", "a2\n");
  sh(repo, "commit", "-q", "-am", "second");
  write(repo, "src/b.js", "b\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "thrid typo");
  sh(repo, "remote", "add", "origin", remote);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("메시지 수정: HEAD 커밋", async () => {
  const head = sh(repo, "rev-parse", "HEAD");
  await run("reword", head, "third");
  assert.equal(msgs(repo, 1)[0], "third");
  assert.ok(sh(repo, "for-each-ref", "refs/git-canvas/backup").length > 0, "백업 ref 가 남아야 함");
});

test("메시지 수정: 과거 커밋 (작성자·내용 유지, 뒤 커밋 다시 올림)", async () => {
  const second = sh(repo, "rev-parse", "HEAD~1");
  const authorBefore = sh(repo, "show", "-s", "--format=%an %aI", second);
  const treeBefore = sh(repo, "rev-parse", "HEAD^{tree}");
  write(repo, "README.md", "dirty\n"); // 작업 영역 변경이 있어도 보존되어야 한다
  await run("reword", second, "second (fixed)");
  assert.deepEqual(msgs(repo, 3), ["third", "second (fixed)", "init"]);
  assert.equal(sh(repo, "show", "-s", "--format=%an %aI", "HEAD~1"), authorBefore);
  assert.equal(sh(repo, "rev-parse", "HEAD^{tree}"), treeBefore);
  assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8"), "dirty\n");
});

test("stage · unstage · 폴더 단위", async () => {
  write(repo, "src/c.js", "c\n");
  await run("stageFiles", ["src"], "staged");
  assert.match(sh(repo, "diff", "--cached", "--name-only"), /src\/c\.js/);
  await run("stageFiles", ["src"], "unstaged");
  assert.equal(sh(repo, "diff", "--cached", "--name-only"), "");
});

test("경로만 커밋 (나머지 변경은 남김)", async () => {
  await run("commitTo", "main", "add c", ["src"]);
  assert.equal(msgs(repo, 1)[0], "add c");
  assert.match(sh(repo, "status", "--porcelain"), /README\.md/);
});

test("변경 버리기 (추적 파일 + 새 파일)", async () => {
  write(repo, "tmp.txt", "x\n");
  await run("discard", ["README.md", "tmp.txt"]);
  assert.equal(sh(repo, "status", "--porcelain"), "");
  assert.equal(fs.existsSync(path.join(repo, "tmp.txt")), false);
});

test("변경 전체 커밋 → amend", async () => {
  write(repo, "README.md", "hello 2\n");
  await run("commitTo", "main", "update readme");
  write(repo, "README.md", "hello 3\n");
  await run("amendInto", sh(repo, "rev-parse", "HEAD"), "");
  assert.equal(msgs(repo, 1)[0], "update readme");
  assert.equal(sh(repo, "show", "HEAD:README.md"), "hello 3");
});

test("새 브랜치 · checkout · 브랜치 생성/삭제", async () => {
  await run("switchCreate", "feat/x");
  assert.equal(sh(repo, "branch", "--show-current"), "feat/x");
  await run("checkout", "main");
  await run("createBranch", "tmp-branch", sh(repo, "rev-parse", "HEAD~1"));
  await run("deleteBranch", "tmp-branch");
  assert.equal(sh(repo, "branch", "--list", "tmp-branch"), "");
});

test("push (처음 publish) → 다른 사람이 push → fetch → pull", async () => {
  await run("push", "main");
  assert.equal(sh(remote, "rev-parse", "main"), sh(repo, "rev-parse", "main"));
  sh(tmp, "clone", "-q", remote, other);
  ident(other);
  write(other, "team.txt", "team\n");
  sh(other, "add", "-A");
  sh(other, "commit", "-q", "-m", "team change");
  sh(other, "push", "-q");
  await run("fetch");
  const r = await readRepo(repo);
  assert.ok(r.remotes["origin/main"] !== r.branches.main, "fetch 후 origin/main 이 앞서야 함");
  await run("pull", "main", "merge");
  assert.equal(msgs(repo, 1)[0], "team change");
});

test("stash push → pop", async () => {
  write(repo, "README.md", "wip\n");
  await run("stashPush", "my wip");
  assert.equal(sh(repo, "status", "--porcelain"), "");
  await run("stashPop", 0, false);
  assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8"), "wip\n");
  await run("discard", ["README.md"]);
});

test("3단계 조작은 실행하지 않고 안내만", async () => {
  const before = sh(repo, "rev-parse", "HEAD");
  const r = await execute(repo, "rebaseStem", ["main", before]);
  assert.equal(r.ok, false);
  assert.equal(r.unsupported, true);
  assert.equal(sh(repo, "rev-parse", "HEAD"), before);
});

test("병합되지 않은 브랜치 삭제는 git 이 거절", async () => {
  await run("switchCreate", "unmerged");
  write(repo, "u.txt", "u\n");
  await run("commitTo", "unmerged", "unmerged work");
  await run("checkout", "main");
  const r = await execute(repo, "deleteBranch", ["unmerged"]);
  assert.equal(r.ok, false);
  assert.match(r.error, /not fully merged/);
});
