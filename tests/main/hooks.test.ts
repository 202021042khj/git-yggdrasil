// git hook: 상태 읽기(core.hooksPath 포함) · commit-tree 로 만드는 커밋에도 pre-commit · commit-msg · hook 실패면 아무것도 바꾸지 않음
// · 이 저장소에서만 건너뛰기(--no-verify) · push 의 pre-push. hook 은 임시 저장소 안의 sh 스크립트라 Windows 에서는 건너뛴다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { registerExtraOps } from "@/git/ops/extraOps";
import { hookInfo } from "@/git/hooks";
import type { OpExtra, OpName } from "@shared/types/ipc";

const ISOLATED = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const saved: Record<string, string | undefined> = {};

let tmp: string, repo: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commit = (msg: string, f: string, text: string) => { fs.writeFileSync(path.join(repo, f), text); sh("add", "-A"); sh("commit", "-q", "-m", msg); return sh("rev-parse", "HEAD"); };
const exec = (op: OpName, args: unknown[], extra?: OpExtra) => execute(repo, op, args, extra);
const hook = (name: string, body: string, dir = path.join(repo, ".git", "hooks")) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};
const msgOf = (ref: string) => sh("log", "-1", "--format=%B", ref);

beforeAll(() => {
  for (const [k, v] of Object.entries(ISOLATED)) { saved[k] = process.env[k]; process.env[k] = v; }
  registerExtraOps();
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-hooks-"));
  repo = path.join(tmp, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  sh("config", "user.name", "Tester"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  commit("init", "a.txt", "a\n");
  commit("m1", "b.txt", "b\n");
  sh("branch", "side", "HEAD~1");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("git hooks", () => {
  test("hook 상태: 설치된 hook · 실행 권한 · core.hooksPath(husky)", async () => {
    let info = await hookInfo(repo);
    assert.deepEqual(info.hooks, []);
    assert.equal(info.configured, null);
    hook("pre-commit", "exit 0");
    fs.writeFileSync(path.join(repo, ".git", "hooks", "commit-msg"), "#!/bin/sh\n", { mode: 0o644 });
    info = await hookInfo(repo);
    assert.deepEqual(info.hooks, [{ name: "pre-commit", executable: true }, { name: "commit-msg", executable: false }]);
    sh("config", "core.hooksPath", ".husky");
    hook("pre-push", "exit 0", path.join(repo, ".husky"));
    info = await hookInfo(repo);
    assert.equal(info.configured, ".husky");
    assert.equal(info.husky, true);
    assert.equal(fs.realpathSync(info.dir), fs.realpathSync(path.join(repo, ".husky")));
    assert.deepEqual(info.hooks.map((h) => h.name), ["pre-push"]);
  });

  test("pre-commit 이 실패하면 커밋하지 않고 hook 출력을 보여 준다. 건너뛰기를 켜면 --no-verify 로 커밋", async () => {
    hook("pre-commit", "echo 'lint failed' >&2; exit 1");
    const head = sh("rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "c.txt"), "c\n");
    const r = await exec("commitTo", ["main", "c", undefined]);
    assert.equal(r.ok, false);
    assert.match(r.error || "", /lint failed/);
    assert.ok(r.hint);
    assert.equal(sh("rev-parse", "HEAD"), head);
    const on = await exec("setSkipHooks", [true]);
    assert.ok(on.cmds.includes("git config --local yggdrasil.skipHooks true"));
    assert.equal((await hookInfo(repo)).skip, true);
    const ok = await exec("commitTo", ["main", "c", undefined]);
    assert.ok(ok.ok, ok.error);
    assert.ok(ok.cmds.some((c) => c.startsWith("git commit --no-verify")));
    assert.equal(msgOf("HEAD"), "c");
  });

  test("다른 브랜치에 커밋: commit-msg 가 고친 메시지를 쓰고, 실패면 브랜치를 그대로 둔다", async () => {
    hook("commit-msg", "printf '\\nSigned-off-by: Hook <h@example.com>\\n' >> \"$1\"");
    fs.writeFileSync(path.join(repo, "c.txt"), "c\n");
    const r = await exec("commitTo", ["side", "to side", undefined]);
    assert.ok(r.ok, r.error);
    assert.equal(msgOf("side"), "to side\n\nSigned-off-by: Hook <h@example.com>");

    hook("commit-msg", "echo 'bad message' >&2; exit 1");
    const before = sh("rev-parse", "side");
    fs.writeFileSync(path.join(repo, "d.txt"), "d\n");
    const bad = await exec("commitTo", ["side", "again", undefined]);
    assert.equal(bad.ok, false);
    assert.match(bad.error || "", /commit-msg[\s\S]*bad message/);
    assert.equal(sh("rev-parse", "side"), before);
  });

  test("과거 커밋 메시지 수정 · 커밋 정리 메시지도 commit-msg 를 거친다", async () => {
    const init = sh("rev-parse", "HEAD~1");
    hook("commit-msg", "grep -q '^feat' \"$1\" || { echo 'need feat prefix' >&2; exit 1; }");
    const head = sh("rev-parse", "HEAD");
    const bad = await exec("reword", [init, "nope"]);
    assert.equal(bad.ok, false);
    assert.match(bad.error || "", /need feat prefix/);
    assert.equal(sh("rev-parse", "HEAD"), head);
    const ok = await exec("reword", [init, "feat: init"]);
    assert.ok(ok.ok, ok.error);
    assert.equal(msgOf("HEAD~1"), "feat: init");

    hook("commit-msg", "sed -i.bak 's/^wip/feat/' \"$1\"");
    const stem = [sh("rev-parse", "HEAD~1"), sh("rev-parse", "HEAD")];
    const plan = await exec("rebasePlan", ["main", [{ id: stem[0], action: "pick" }, { id: stem[1], action: "reword", msg: "wip: m1" }]], { base: null, stem });
    assert.ok(plan.ok, plan.error);
    assert.equal(msgOf("HEAD"), "feat: m1");
  });

  test("push: pre-push 가 실패하면 원격을 바꾸지 않고, 건너뛰기면 --no-verify", async () => {
    const remote = path.join(tmp, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    sh("remote", "add", "origin", remote);
    hook("pre-push", "echo 'tests failed' >&2; exit 1");
    const r = await exec("push", ["main"]);
    assert.equal(r.ok, false);
    assert.match(r.error || "", /tests failed/);
    assert.ok(r.hint);
    assert.equal(execFileSync("git", ["--git-dir", remote, "branch"], { encoding: "utf8" }).trim(), "");
    await exec("setSkipHooks", [true]);
    const ok = await exec("push", ["main"]);
    assert.ok(ok.ok, ok.error);
    assert.ok(ok.cmds.some((c) => c.includes("--no-verify")));
  });
});
