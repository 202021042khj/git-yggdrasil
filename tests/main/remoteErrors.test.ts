// 원격 접속 오류 안내 · SSH 가 질문하느라 멈추지 않는지
import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { git, SSH_BATCH } from "@/git/cli";
import { execute } from "@/git/ops/execute";
import { explainRemoteError } from "@/git/remoteErrors";

test("오류 문구별 안내", () => {
  const t = (s: string) => explainRemoteError(s)?.title ?? null;
  assert.match(t("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")!, /SSH 키/);
  assert.match(t("Host key verification failed.\nfatal: Could not read from remote repository.")!, /호스트 키를 확인하지/);
  assert.match(t("@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @")!, /예전과 다릅니다/);
  assert.match(t("ssh: Could not resolve hostname gihtub.com: nodename nor servname provided")!, /gihtub\.com/);
  assert.match(t("fatal: could not read Username for 'https://github.com': terminal prompts disabled")!, /HTTPS 인증/);
  assert.match(explainRemoteError("fatal: could not read Username for 'https://github.com': terminal prompts disabled")!.fix, /GitHub 로그인/);
  assert.match(t("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")!, /찾지 못했습니다/);
  assert.match(t("remote: Permission to a/b.git denied to kim.\nfatal: unable to access '...': The requested URL returned error: 403")!, /쓸 권한/);
  assert.equal(t("error: pathspec 'x' did not match any file(s) known to git"), null, "원격과 무관한 오류는 안내 없음");
});

test("ssh 가 암호를 물을 상황이면 멈추지 않고 바로 실패하고, 실행 결과에 안내가 붙는다", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ygg-ssh-"));
  const repo = path.join(tmp, "repo");
  execFileSync("git", ["init", "-q", repo]);
  // 가짜 ssh: BatchMode 가 넘어오는지 확인하고, 공개 키 거부처럼 실패한다
  const fake = path.join(tmp, "fake-ssh.sh");
  fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > "${tmp}/ssh-args"\necho "git@example.com: Permission denied (publickey)." >&2\nexit 255\n`, { mode: 0o755 });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@example.com:a/b.git"]);
  const saved = process.env.GIT_SSH_COMMAND;
  delete process.env.GIT_SSH_COMMAND;
  try {
    // core.sshCommand 가 있으면 그대로 쓴다 (사용자 설정 존중)
    execFileSync("git", ["-C", repo, "config", "core.sshCommand", `${fake} -o BatchMode=yes`]);
    const r = await execute(repo, "fetch", []);
    assert.equal(r.ok, false);
    assert.match(r.hint?.title ?? "", /SSH 키/);
    assert.match(fs.readFileSync(path.join(tmp, "ssh-args"), "utf8"), /BatchMode=yes/);
    // 설정이 없으면 앱이 BatchMode 를 붙인다: PATH 앞에 둔 가짜 ssh 가 받은 인자로 확인
    execFileSync("git", ["-C", repo, "config", "--unset", "core.sshCommand"]);
    fs.rmSync(path.join(tmp, "ssh-args"));
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    fs.copyFileSync(fake, path.join(bin, "ssh"));
    fs.chmodSync(path.join(bin, "ssh"), 0o755);
    await git(repo, ["fetch", "origin"], { net: true, allowFail: true, env: { PATH: `${bin}:${process.env.PATH}` } });
    const args = fs.readFileSync(path.join(tmp, "ssh-args"), "utf8");
    for (const opt of SSH_BATCH.split(" ").slice(1).filter((a) => a !== "-o")) assert.ok(args.includes(opt), `${opt} 이 ssh 에 넘어가야 함`);
  } finally {
    if (saved !== undefined) process.env.GIT_SSH_COMMAND = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
