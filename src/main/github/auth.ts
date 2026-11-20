// GitHub 로그인 (Device Flow) · 토큰 보관·갱신 · git 자격 증명 연결
// 토큰은 OS 키체인 기반 암호화(Electron safeStorage)로 userData 폴더에 저장한다.
// Client ID 는 공개되어도 되는 값이다 (Device Flow 는 Client Secret 을 쓰지 않는다).
import fs from "node:fs";
import path from "node:path";
import { GH_CLIENT_ID, GH_SCOPE, GH_USER_AGENT } from "@/github/constants";
import { t as tr } from "@shared/i18n/i18n";
import type { GhStatus, GhUser } from "@shared/types/ipc";

/** Electron safeStorage 중 쓰는 부분 (테스트에서 가짜로 바꿀 수 있게) */
export interface SecretStore {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(buf: Buffer): string;
}

interface AuthData {
  token: string;
  refresh: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  user?: GhUser;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
  interval?: number;
}

let store: SecretStore | null = null;
let userDataDir = "";
let auth: AuthData | null = null;

export function initAuth(opts: { safeStorage: SecretStore | null; userData: string }): void {
  store = opts.safeStorage;
  userDataDir = opts.userData;
  auth = load();
}

const file = () => path.join(userDataDir, "github-auth.bin");

function load(): AuthData | null {
  try {
    const raw = fs.readFileSync(file());
    const text = store?.isEncryptionAvailable() ? store.decryptString(raw) : null;
    return text ? (JSON.parse(text) as AuthData) : null;
  } catch {
    return null;
  }
}

function save(): void {
  try {
    if (!auth) { fs.rmSync(file(), { force: true }); return; }
    if (!store?.isEncryptionAvailable()) throw new Error(tr("m.gh.noSafeStorage"));
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file(), store.encryptString(JSON.stringify(auth)), { mode: 0o600 });
  } catch (err) {
    console.error("[github] failed to save token:", (err as Error).message);
  }
}

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse & Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": GH_USER_AGENT },
    body: new URLSearchParams(params),
  });
  return (await res.json()) as TokenResponse & Record<string, unknown>;
}

function applyTokenResponse(t: TokenResponse): void {
  const now = Date.now();
  auth = {
    ...(auth || {}),
    token: t.access_token!,
    refresh: t.refresh_token || null,
    expiresAt: t.expires_in ? now + t.expires_in * 1000 : null,
    refreshExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : null,
  };
}

// ---------- Device Flow ----------
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

let pending: { cancelled: boolean } | null = null;

export async function startLogin(): Promise<DeviceCode> {
  const d = await postForm("https://github.com/login/device/code", { client_id: GH_CLIENT_ID, scope: GH_SCOPE });
  if (d.error) {
    throw new Error(d.error === "device_flow_disabled"
      ? tr("m.gh.deviceFlowOff")
      : tr("m.gh.startFailed", { error: d.error_description || d.error }));
  }
  return {
    userCode: d.user_code as string,
    verificationUri: d.verification_uri as string,
    deviceCode: d.device_code as string,
    interval: (d.interval as number) || 5,
    expiresIn: (d.expires_in as number) || 900,
  };
}

/** 사용자가 브라우저에서 승인할 때까지 기다린다 */
export async function waitLogin({ deviceCode, interval, expiresIn }: DeviceCode, fetchUser: () => Promise<GhUser>): Promise<GhUser> {
  const me = { cancelled: false };
  pending = me;
  let wait = interval;
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    if (me.cancelled) throw new Error(tr("m.gh.cancelled"));
    const t = await postForm("https://github.com/login/oauth/access_token", {
      client_id: GH_CLIENT_ID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (t.access_token) {
      applyTokenResponse(t);
      auth!.user = await fetchUser();
      save();
      pending = null;
      return auth!.user;
    }
    if (t.error === "authorization_pending") continue;
    if (t.error === "slow_down") { wait = t.interval || wait + 5; continue; }
    if (t.error === "expired_token") throw new Error(tr("m.gh.codeExpired"));
    if (t.error === "access_denied") throw new Error(tr("m.gh.denied"));
    throw new Error(tr("m.gh.failed", { error: t.error_description || t.error || "" }));
  }
  throw new Error(tr("m.gh.codeExpired"));
}

export function cancelLogin(): void {
  if (pending) pending.cancelled = true;
}

export function logout(): void {
  auth = null;
  save();
}

export const authStatus = (): GhStatus => (auth?.token ? { loggedIn: true, user: auth.user } : { loggedIn: false });

/** 만료가 가까우면 refresh token 으로 새로 받는다. 실패하면 로그아웃 상태로 돌린다. */
export async function token(): Promise<string | null> {
  if (!auth?.token) return null;
  if (auth.expiresAt && Date.now() > auth.expiresAt - 5 * 60 * 1000) {
    if (!auth.refresh || (auth.refreshExpiresAt && Date.now() > auth.refreshExpiresAt)) { logout(); return null; }
    const t = await postForm("https://github.com/login/oauth/access_token", {
      client_id: GH_CLIENT_ID, grant_type: "refresh_token", refresh_token: auth.refresh,
    });
    if (!t.access_token) { logout(); return null; }
    applyTokenResponse(t);
    save();
  }
  return auth.token;
}

/**
 * git 이 github.com 에 HTTPS 로 접속할 때 토큰을 쓰게 하는 설정.
 * 토큰은 명령 인자에 넣지 않고 환경 변수로만 전달한다 (프로세스 목록에 노출되지 않게). 다른 호스트에는 주지 않는다.
 */
export async function gitAuth(): Promise<{ args: string[]; env: Record<string, string> } | null> {
  const tk = await token();
  if (!tk) return null;
  return {
    args: [
      "-c", "credential.https://github.com.helper=",
      "-c", 'credential.https://github.com.helper=!f() { test "$1" = get && echo username=x-access-token && echo "password=$YGG_GH_TOKEN"; }; f',
    ],
    env: { YGG_GH_TOKEN: tk },
  };
}
