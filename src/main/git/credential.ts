// GitHub 밖 HTTPS 호스트(GitLab·Bitbucket·사내 서버 등) 인증: git 자격 증명 도우미에 저장·삭제
// 비밀번호(토큰)는 명령 인자가 아니라 표준 입력으로만 넘긴다. 저장은 사용자의 git 설정에 있는 도우미
// (macOS 키체인 등)가 맡고, 앱은 따로 보관하지 않는다.
import { execFile } from "node:child_process";
import os from "node:os";
import { t } from "@shared/i18n/i18n";

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

/** 인증이 필요해서 실패했으면 그 원격의 https://호스트 */
export function authUrlFromError(stderr: string | null | undefined): string | null {
  const m = /(?:could not read (?:Username|Password) for|Authentication failed for) '(https?:\/\/[^'\s]+)'/.exec(stderr || "");
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function run(args: string[], input: string | null, cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile("git", args, { cwd, timeout: 15000, env: { ...process.env, ...ENV } }, (e, out, err) =>
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out, err }));
    if (input !== null) child.stdin?.end(input);
  });
}

/** 자격 증명 프로토콜에 줄바꿈이 섞이면 다른 항목을 끼워 넣을 수 있다 */
function clean(name: string, v: string): string {
  if (/[\r\n\0]/.test(v)) throw new Error(t("m.cred.newline", { field: name }));
  return v;
}

function credInput(url: string, username?: string, password?: string): string {
  const u = new URL(clean(t("m.cred.url"), url));
  if (u.protocol !== "https:") throw new Error(t("m.cred.httpsOnly"));
  const lines = [`protocol=https`, `host=${u.host}`];
  if (username !== undefined) lines.push(`username=${clean(t("cred.user"), username)}`);
  if (password !== undefined) lines.push(`password=${clean(t("m.cred.token"), password)}`);
  return lines.join("\n") + "\n\n";
}

/** 이 OS 의 안전한 기본 도우미 (평문 파일에 저장하는 store 는 쓰지 않는다) */
export function systemHelper(platform = process.platform): string | null {
  return platform === "darwin" ? "osxkeychain" : platform === "win32" ? "manager" : null;
}

export async function credentialHelpers(cwd: string): Promise<string[]> {
  const r = await run(["config", "--get-all", "credential.helper"], null, cwd);
  return r.out.split("\n").map((s) => s.trim()).filter(Boolean);
}

export interface SaveResult {
  /** 실제로 저장에 쓴 도우미 */
  helpers: string[];
  /** 이번에 git 전역 설정에 도우미를 켰는지 */
  enabledHelper: string | null;
}

/**
 * git credential approve 로 저장. 도우미가 하나도 없으면 enableHelper 일 때만
 * git config --global credential.helper <OS 기본> 을 켠다 (사용자가 창에서 동의한 경우).
 */
export async function saveCredential(cwd: string | null, url: string, username: string, password: string, enableHelper = false): Promise<SaveResult> {
  const dir = cwd || os.homedir();
  if (!username.trim() || !password) throw new Error(t("m.cred.both"));
  let helpers = await credentialHelpers(dir);
  let enabledHelper: string | null = null;
  if (!helpers.length) {
    const sys = systemHelper();
    if (!enableHelper || !sys) {
      const e = new Error(sys
        ? t("m.cred.needHelper", { helper: sys })
        : t("m.cred.noHelper"));
      (e as Error & { code?: string }).code = "NO_HELPER";
      throw e;
    }
    const set = await run(["config", "--global", "credential.helper", sys], null, dir);
    if (set.code) throw new Error(t("m.cred.enableFailed", { error: set.err.trim() }));
    enabledHelper = sys;
    helpers = [sys];
  }
  const r = await run(["credential", "approve"], credInput(url, username.trim(), password), dir);
  if (r.code) throw new Error(t("m.cred.saveFailed", { error: r.err.trim() }));
  return { helpers, enabledHelper };
}

/** 저장된 자격 증명 지우기 (틀린 토큰을 저장한 경우 등) */
export async function forgetCredential(cwd: string | null, url: string): Promise<void> {
  const r = await run(["credential", "reject"], credInput(url), cwd || os.homedir());
  if (r.code) throw new Error(t("m.cred.forgetFailed", { error: r.err.trim() }));
}
