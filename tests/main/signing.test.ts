// 커밋 서명: 설정 읽기 · 저장소에만 켜고 끄기 · commit-tree 로 만드는 커밋도 서명 · 서명 실패면 아무것도 바꾸지 않음
// 전역 설정·실제 키체인·에이전트는 쓰지 않는다: 임시 폴더에 만든 버리는 SSH 키와 저장소 설정만 쓴다.
import { afterAll, afterEach, beforeAll, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { execute } from "@/git/ops/execute";
import { registerExtraOps } from "@/git/ops/extraOps";
import { signatureOf, signingInfo } from "@/git/sign";
import type { OpName } from "@shared/types/ipc";

const ISOLATED = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", SSH_AUTH_SOCK: "", GNUPGHOME: "" };
const saved: Record<string, string | undefined> = {};
const hasSshSign = /namespace|-n/.test(spawnSync("ssh-keygen", ["-Y", "sign"], { encoding: "utf8" }).stderr || "");

let tmp: string, repo: string, key: string;
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commit = (msg: string, f: string, text: string) => { fs.writeFileSync(path.join(repo, f), text); sh("add", "-A"); sh("commit", "-q", "-m", msg); return sh("rev-parse", "HEAD"); };
const run = async (op: OpName, args: unknown[]) => { const r = await execute(repo, op, args); assert.ok(r.ok, `${op} 실패: ${r.error}`); return r; };
const sig = (ref: string) => sh("log", "-1", "--format=%G?", ref);

beforeAll(() => {
  for (const [k, v] of Object.entries(ISOLATED)) { saved[k] = process.env[k]; process.env[k] = v; }
  registerExtraOps();
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-sign-"));
  repo = path.join(tmp, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  sh("config", "user.name", "Tester"); sh("config", "user.email", "t@example.com"); sh("config", "commit.gpgsign", "false");
  commit("init", "a.txt", "a\n");
  commit("m1", "b.txt", "b\n");
  sh("switch", "-q", "-c", "side", "HEAD~1");
  commit("s1", "s.txt", "s\n");
  sh("switch", "-q", "main");
  key = path.join(tmp, "id_test");
  if (hasSshSign) {
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "t@example.com", "-f", key]);
    const allowed = path.join(tmp, "allowed_signers");
    fs.writeFileSync(allowed, `t@example.com ${fs.readFileSync(`${key}.pub`, "utf8")}`);
    sh("config", "gpg.format", "ssh");
    sh("config", "user.signingkey", key);
    sh("config", "gpg.ssh.allowedSignersFile", allowed);
  }
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("서명 끄기·켜기는 이 저장소 설정에만 쓰고, 읽은 값이 따라온다", async () => {
  assert.equal((await signingInfo(repo)).enabled, false);
  assert.equal((await signingInfo(repo)).local, false);
  const r = await run("setSigning", [true]);
  assert.ok(r.cmds.some((c) => c === "git config --local commit.gpgsign true"));
  assert.equal(sh("config", "--local", "commit.gpgsign"), "true");
  const info = await signingInfo(repo);
  assert.equal(info.enabled, true);
  assert.equal(info.local, true);
  await run("setSigning", [false]);
  assert.equal((await signingInfo(repo)).enabled, false);
});

test("서명하지 않은 커밋은 unsigned", async () => {
  assert.equal((await signatureOf(repo, sh("rev-parse", "HEAD"))).status, "unsigned");
});

test.skipIf(!hasSshSign)("서명을 켜면 commit-tree 로 만드는 커밋(merge · reword · 다른 브랜치에 커밋)도 서명된다", async () => {
  sh("config", "commit.gpgsign", "true");
  // 체크아웃 안 한 브랜치로 merge (merge-tree + commit-tree)
  await run("merge", ["main", "side"]);
  assert.equal(sig("side"), "G");
  // 과거 커밋 메시지 수정 (commit-tree + rebase)
  await run("reword", [sh("rev-parse", "HEAD~1"), "init (reworded)"]);
  assert.equal(sig("HEAD~1"), "G");
  assert.equal(sig("HEAD"), "G", "다시 올린 커밋도 서명 (rebase 는 commit.gpgsign 을 따른다)");
  // 체크아웃 안 한 브랜치에 바로 커밋
  sh("branch", "other", "HEAD");
  fs.writeFileSync(path.join(repo, "c.txt"), "c\n"); sh("add", "c.txt");
  await run("commitTo", ["other", "add c"]);
  assert.equal(sig("other"), "G");
  const s = await signatureOf(repo, sh("rev-parse", "other"));
  assert.equal(s.status, "verified");
  assert.equal(s.signer, "t@example.com");
});

test.skipIf(!hasSshSign)("서명에 실패하면 오류를 내고 브랜치는 그대로", async () => {
  sh("config", "commit.gpgsign", "true");
  sh("config", "user.signingkey", path.join(tmp, "missing-key"));
  const before = sh("rev-parse", "side");
  const r = await execute(repo, "merge", ["main", "side"]);
  assert.equal(r.ok, false);
  assert.match(r.error || "", /서명|sign/i);
  assert.equal(sh("rev-parse", "side"), before);
});
