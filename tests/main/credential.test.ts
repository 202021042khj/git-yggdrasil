// GitHub 밖 HTTPS 호스트 인증: 인증 필요 감지 · 자격 증명 도우미 저장 · 주입 방지
// 실제 키체인이나 사용자 git 설정을 건드리지 않도록 HOME 과 시스템 설정을 임시 폴더로 바꾼다.
import { afterEach, beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { authUrlFromError, forgetCredential, saveCredential, systemHelper } from "@/git/credential";
import { execute } from "@/git/ops/execute";

let tmp: string, repo: string;
const saved: Record<string, string | undefined> = {};
const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-cred-"));
  for (const k of ["HOME", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"]) saved[k] = process.env[k];
  process.env.HOME = tmp;
  process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  repo = path.join(tmp, "repo");
  execFileSync("git", ["init", "-q", repo]);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("인증 실패 문구에서 호스트 주소만 뽑는다", () => {
  assert.equal(authUrlFromError("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled"), "https://gitlab.com");
  assert.equal(authUrlFromError("fatal: Authentication failed for 'https://git.example.com:8443/team/app.git/'"), "https://git.example.com:8443");
  assert.equal(authUrlFromError("fatal: Could not read from remote repository."), null);
});

test("도우미가 없으면 저장하지 않고 알린다 (전역 설정을 몰래 바꾸지 않음)", async () => {
  await assert.rejects(saveCredential(repo, "https://gitlab.com", "kim", "glpat-x"), (e: Error & { code?: string }) => e.code === "NO_HELPER");
  assert.equal(fs.existsSync(path.join(tmp, ".gitconfig")), false);
  assert.equal(systemHelper("darwin"), "osxkeychain");
  assert.equal(systemHelper("linux"), null, "평문 store 도우미는 앱이 켜지 않는다");
});

test("설정된 도우미에 저장하고, 지우기도 된다. 토큰은 명령 인자로 넘기지 않는다", async () => {
  const file = path.join(tmp, "creds");
  sh("config", "credential.helper", `store --file=${file}`);
  const r = await saveCredential(repo, "https://gitlab.com", "kim", "glpat-SECRET");
  assert.deepEqual(r.helpers, [`store --file=${file}`]);
  assert.equal(fs.readFileSync(file, "utf8").trim(), "https://kim:glpat-SECRET@gitlab.com");
  await forgetCredential(repo, "https://gitlab.com");
  assert.equal(fs.readFileSync(file, "utf8").trim(), "");
});

test("줄바꿈으로 다른 항목을 끼워 넣거나 http 주소에 저장하는 것은 거부", async () => {
  sh("config", "credential.helper", `store --file=${path.join(tmp, "creds")}`);
  await assert.rejects(saveCredential(repo, "https://gitlab.com", "kim\nhost=evil.com", "x"), /줄바꿈/);
  await assert.rejects(saveCredential(repo, "https://gitlab.com", "kim", "x\nprotocol=http"), /줄바꿈/);
  await assert.rejects(saveCredential(repo, "http://gitlab.com", "kim", "x"), /HTTPS/);
});

test("원격이 인증을 요구하면 실행 결과에 AUTH_REQUIRED 와 호스트가 붙는다", async () => {
  const server = http.createServer((_q, res) => { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="t"' }); res.end(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    sh("remote", "add", "origin", `http://127.0.0.1:${port}/team/app.git`);
    const r = await execute(repo, "fetch", []);
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTH_REQUIRED");
    assert.equal(r.authUrl, `http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
});
