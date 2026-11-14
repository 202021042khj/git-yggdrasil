// git CLI 호출. 모든 git 실행은 여기를 거친다.
import { execFile } from "node:child_process";

export interface GitOptions {
  /** 실패해도 던지지 않고 null 을 돌려준다 */
  allowFail?: boolean;
  env?: Record<string, string>;
  timeout?: number;
  /** 네트워크 명령 (GitHub 토큰을 붙이는 대상) */
  net?: boolean;
}

export interface GitError extends Error {
  code?: string | number;
  stderr?: string;
}

// 인증 프롬프트가 뜨면 앱이 멈추므로 바로 실패하게 한다 (자격 증명 도우미·SSH 에이전트는 그대로 쓴다)
const BASE_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 네트워크 명령의 SSH 설정: 암호·호스트 키 질문이 뜨면 화면 없는 앱은 시간 초과까지 멈추므로 바로 실패하게 한다.
 * (ssh-agent 에 올린 키는 그대로 쓴다.) 사용자가 GIT_SSH_COMMAND 나 core.sshCommand 를 정해 두었으면 건드리지 않는다.
 */
export const SSH_BATCH = "ssh -o BatchMode=yes -o ConnectTimeout=15";
async function sshEnv(cwd: string): Promise<Record<string, string>> {
  if (process.env.GIT_SSH_COMMAND || process.env.GIT_SSH) return {};
  const custom = await new Promise<string>((resolve) =>
    execFile("git", ["config", "--get", "core.sshCommand"], { cwd, env: { ...process.env, ...BASE_ENV } }, (_e, out) => resolve((out || "").trim())));
  return custom ? {} : { GIT_SSH_COMMAND: SSH_BATCH };
}

export function git(cwd: string, args: string[], opts: GitOptions & { allowFail: true }): Promise<string | null>;
export function git(cwd: string, args: string[], opts?: GitOptions): Promise<string>;
export function git(cwd: string, args: string[], { allowFail = false, env = {}, timeout = 30000, net = false }: GitOptions = {}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const run = (ssh: Record<string, string>) => execFile("git", args, { cwd, timeout, maxBuffer: MAX_BUFFER, env: { ...process.env, ...BASE_ENV, ...ssh, ...env } }, (err, stdout, stderr) => {
      if (err && !allowFail) {
        const e: GitError = new Error(`git ${args.join(" ")}: ${(stderr || err.message).trim()}`);
        e.code = err.code ?? undefined;
        e.stderr = (stderr || (err.killed ? "시간 초과로 중단했습니다." : err.message)).trim();
        return reject(e);
      }
      resolve(err ? null : stdout);
    });
    if (net) void sshEnv(cwd).then(run); else run({});
  });
}

export interface RawResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 종료 코드까지 필요한 경우 (예: merge-tree 는 충돌이면 1 을 돌려준다) */
export function gitRaw(cwd: string, args: string[], { env = {}, timeout = 30000 }: GitOptions = {}): Promise<RawResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, maxBuffer: MAX_BUFFER, env: { ...process.env, ...BASE_ENV, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr }));
  });
}

export async function repoRoot(dir: string): Promise<string | null> {
  const out = await git(dir, ["rev-parse", "--show-toplevel"], { allowFail: true });
  return out ? out.trim() : null;
}
