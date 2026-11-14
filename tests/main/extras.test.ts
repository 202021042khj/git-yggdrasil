// 서브모듈 · worktree · LFS 표시와 조작
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readRepo } from "@/git/readRepo";
import { execute } from "@/git/ops/execute";
import { registerExtraOps } from "@/git/ops/extraOps";

let tmp: string, repo: string;
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const init = (dir: string) => {
  sh(tmp, "init", "-q", "-b", "main", dir);
  sh(dir, "config", "user.name", "T"); sh(dir, "config", "user.email", "t@example.com"); sh(dir, "config", "commit.gpgsign", "false");
};
const commitAll = (dir: string, msg: string) => { sh(dir, "add", "-A"); sh(dir, "commit", "-q", "-m", msg); };
const saved: Record<string, string | undefined> = {};

beforeAll(() => registerExtraOps());
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ygg-extras-")));
  // 로컬 경로 서브모듈은 최신 git 에서 기본으로 막혀 있다 (시험용으로만 허용)
  for (const k of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) saved[k] = process.env[k];
  Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "always" });
  repo = path.join(tmp, "repo");
  init(repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  commitAll(repo, "base");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("서브모듈: 상태 읽기, 받지 않은 것을 받기", async () => {
  const lib = path.join(tmp, "lib");
  init(lib);
  fs.writeFileSync(path.join(lib, "lib.txt"), "lib\n");
  commitAll(lib, "lib v1");
  sh(repo, "submodule", "add", "-q", lib, "vendor/lib");
  commitAll(repo, "add submodule");
  let st = await readRepo(repo);
  assert.equal(st.submodules?.[0].path, "vendor/lib");
  assert.equal(st.submodules?.[0].state, "ok");
  assert.equal(st.submodules?.[0].url, lib);

  sh(repo, "submodule", "deinit", "-q", "-f", "vendor/lib");
  st = await readRepo(repo);
  assert.equal(st.submodules?.[0].state, "uninitialized");
  const r = await execute(repo, "submoduleUpdate", ["vendor/lib"]);
  assert.ok(r.ok, r.error);
  assert.equal((await readRepo(repo)).submodules?.[0].state, "ok");
  assert.equal(fs.readFileSync(path.join(repo, "vendor/lib/lib.txt"), "utf8"), "lib\n");
  assert.equal((await execute(repo, "submoduleUpdate", ["nope"])).ok, false);
});

test("worktree: 만들기 · 같은 브랜치 중복 거부 · 변경 있으면 안 지움 · 지우기", async () => {
  sh(repo, "branch", "feat");
  const r = await execute(repo, "worktreeAdd", ["feat", tmp]);
  assert.ok(r.ok, r.error);
  const dest = path.join(tmp, "repo-feat");
  let wts = (await readRepo(repo)).worktrees!;
  assert.deepEqual(wts.map((w) => [path.basename(w.path), w.branch, w.main, w.current]), [["repo", "main", true, true], ["repo-feat", "feat", false, false]]);
  assert.equal((await execute(repo, "worktreeAdd", ["feat", tmp])).ok, false, "같은 브랜치는 한 곳에서만");
  assert.equal((await execute(repo, "worktreeAdd", ["feat", "relative/dir"])).ok, false, "상대 경로 거부");

  fs.writeFileSync(path.join(dest, "wip.txt"), "wip\n");
  const dirty = await execute(repo, "worktreeRemove", [dest]);
  assert.equal(dirty.ok, false);
  assert.match(dirty.error ?? "", /커밋하지 않은 변경/);
  fs.rmSync(path.join(dest, "wip.txt"));
  assert.ok((await execute(repo, "worktreeRemove", [dest])).ok);
  assert.equal(fs.existsSync(dest), false);
  wts = (await readRepo(repo)).worktrees!;
  assert.equal(wts.length, 1);
  assert.equal((await execute(repo, "worktreeRemove", [repo])).ok, false, "원래 저장소는 지울 수 없다");
});

test("LFS: .gitattributes 에 filter=lfs 가 있으면 해당 파일을 표시", async () => {
  assert.equal((await readRepo(repo)).lfs, undefined, "LFS 를 안 쓰면 확인하지 않는다");
  fs.writeFileSync(path.join(repo, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
  fs.writeFileSync(path.join(repo, "art.psd"), "x");
  execFileSync("git", ["-c", "filter.lfs.clean=cat", "-c", "filter.lfs.smudge=cat", "add", "-A"], { cwd: repo });
  sh(repo, "commit", "-q", "-m", "art");
  const lfs = (await readRepo(repo)).lfs;
  assert.deepEqual(lfs?.files, ["art.psd"]);
});
