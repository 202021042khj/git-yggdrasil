// GitHub 연동: 원격 주소 해석, 토큰 저장(암호화), git 이 토큰을 쓰는지 (실제 GitHub 에는 접속하지 않는다)
import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { authStatus, gitAuth, initAuth, logout } from "@/github/auth";
import { parseRemote } from "@/github/api";

test("GitHub 원격 주소 → owner/repo", () => {
  assert.equal(parseRemote("https://github.com/khj/git-yggdrasil.git"), "khj/git-yggdrasil");
  assert.equal(parseRemote("https://github.com/khj/git-yggdrasil"), "khj/git-yggdrasil");
  assert.equal(parseRemote("git@github.com:khj/git-yggdrasil.git"), "khj/git-yggdrasil");
  assert.equal(parseRemote("https://gitlab.com/khj/x.git"), null);
});

test("로그인 전에는 git 에 토큰을 붙이지 않는다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-gh-"));
  initAuth({ safeStorage: null, userData: dir });
  assert.equal((await gitAuth())!, null);
  assert.deepEqual(authStatus(), { loggedIn: false });
});

test("저장한 토큰은 암호화되어 파일에 남고, git 자격 증명으로 github.com 에만 전달된다", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-gh-"));
  // 가짜 safeStorage: 뒤집어서 저장 (평문이 파일에 그대로 남지 않는지만 확인)
  const fake = { isEncryptionAvailable: () => true, encryptString: (t: string) => Buffer.from([...t].reverse().join("")), decryptString: (b: Buffer) => [...b.toString()].reverse().join("") };
  fs.writeFileSync(path.join(dir, "github-auth.bin"), fake.encryptString(JSON.stringify({ token: "gho_TESTTOKEN", user: { login: "tester" } })));
  initAuth({ safeStorage: fake, userData: dir });
  assert.equal(authStatus().loggedIn, true);
  assert.ok(!fs.readFileSync(path.join(dir, "github-auth.bin"), "utf8").includes("gho_TESTTOKEN"));

  const a = (await gitAuth())!;
  assert.ok(!a.args.join(" ").includes("gho_TESTTOKEN"), "토큰이 명령 인자에 들어가면 안 됨");
  const fill = (host: string) => execFileSync("git", [...a.args, "credential", "fill"], {
    input: `protocol=https\nhost=${host}\n\n`, encoding: "utf8",
    env: { ...process.env, ...a.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", HOME: dir },
  });
  assert.match(fill("github.com"), /password=gho_TESTTOKEN/);
  assert.throws(() => fill("example.com"), "다른 호스트에는 토큰을 주지 않음");
  logout();
  assert.equal(fs.existsSync(path.join(dir, "github-auth.bin")), false);
});
