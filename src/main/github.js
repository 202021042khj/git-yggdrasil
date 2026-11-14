// github.js — GitHub 계정 연동 (Device Flow 로그인, 토큰 보관·갱신, API)
// 토큰은 OS 키체인 기반 암호화(Electron safeStorage)로 userData 폴더에 저장한다.
// Client ID 는 공개되어도 되는 값이다 (Device Flow 는 Client Secret 을 쓰지 않는다).
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_ID = process.env.YGG_GH_CLIENT_ID || "Ov23liCTALlDkudn2YA3";
const SCOPE = "repo read:user";
const UA = "Git-Yggdrasil";

let safeStorage = null, userDataDir = null;
let auth = null; // { token, refresh, expiresAt, refreshExpiresAt, user: { login, name, avatar } }

function init({ safeStorage: ss, userData }) {
  safeStorage = ss;
  userDataDir = userData;
  auth = load();
}

const file = () => path.join(userDataDir, "github-auth.bin");

function load() {
  try {
    const raw = fs.readFileSync(file());
    const text = safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null;
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

function save() {
  try {
    if (!auth) { fs.rmSync(file(), { force: true }); return; }
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("이 시스템에서는 토큰을 안전하게 저장할 수 없습니다.");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(auth)), { mode: 0o600 });
  } catch (err) {
    console.error("[github] 토큰 저장 실패:", err.message);
  }
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams(params),
  });
  return res.json();
}

function applyTokenResponse(t) {
  const now = Date.now();
  auth = {
    ...(auth || {}),
    token: t.access_token,
    refresh: t.refresh_token || null,
    expiresAt: t.expires_in ? now + t.expires_in * 1000 : null,
    refreshExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : null,
  };
}

// ---------- Device Flow ----------
let pending = null; // 진행 중인 로그인 { cancelled }

async function startLogin() {
  const d = await postForm("https://github.com/login/device/code", { client_id: CLIENT_ID, scope: SCOPE });
  if (d.error) throw new Error(d.error === "device_flow_disabled"
    ? "GitHub OAuth App 설정에서 Enable Device Flow 가 꺼져 있습니다."
    : `로그인 시작 실패: ${d.error_description || d.error}`);
  return { userCode: d.user_code, verificationUri: d.verification_uri, deviceCode: d.device_code, interval: d.interval || 5, expiresIn: d.expires_in };
}

// 사용자가 브라우저에서 승인할 때까지 기다린다
async function waitLogin({ deviceCode, interval, expiresIn }) {
  const me = { cancelled: false };
  pending = me;
  let wait = interval;
  const deadline = Date.now() + (expiresIn || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    if (me.cancelled) throw new Error("로그인을 취소했습니다.");
    const t = await postForm("https://github.com/login/oauth/access_token", {
      client_id: CLIENT_ID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (t.access_token) {
      applyTokenResponse(t);
      auth.user = await fetchUser();
      save();
      pending = null;
      return auth.user;
    }
    if (t.error === "authorization_pending") continue;
    if (t.error === "slow_down") { wait = (t.interval || wait + 5); continue; }
    if (t.error === "expired_token") throw new Error("코드가 만료되었습니다. 다시 로그인해 주세요.");
    if (t.error === "access_denied") throw new Error("GitHub 에서 로그인을 거절했습니다.");
    throw new Error(`로그인 실패: ${t.error_description || t.error}`);
  }
  throw new Error("코드가 만료되었습니다. 다시 로그인해 주세요.");
}

function cancelLogin() { if (pending) pending.cancelled = true; }

function logout() { auth = null; save(); }

// 만료가 가까우면 refresh token 으로 새로 받는다. 실패하면 로그아웃 상태로 돌린다.
async function token() {
  if (!auth || !auth.token) return null;
  if (auth.expiresAt && Date.now() > auth.expiresAt - 5 * 60 * 1000) {
    if (!auth.refresh || (auth.refreshExpiresAt && Date.now() > auth.refreshExpiresAt)) { logout(); return null; }
    const t = await postForm("https://github.com/login/oauth/access_token", {
      client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: auth.refresh,
    });
    if (!t.access_token) { logout(); return null; }
    applyTokenResponse(t);
    save();
  }
  return auth.token;
}

// ---------- API ----------
async function api(method, url, body) {
  const tk = await token();
  if (!tk) throw new Error("GitHub 에 로그인되어 있지 않습니다.");
  const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
    method,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${tk}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA,
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401) { logout(); throw new Error("GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요."); }
  if (!res.ok) {
    const detail = data && (data.errors || []).map((e) => e.message || e.code).filter(Boolean).join(", ");
    throw new Error(`GitHub: ${(data && data.message) || res.statusText}${detail ? ` (${detail})` : ""}`);
  }
  return data;
}

async function fetchUser() {
  const u = await api("GET", "/user");
  return { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
}

const status = () => (auth && auth.token ? { loggedIn: true, user: auth.user } : { loggedIn: false });

async function listRepos() {
  const repos = await api("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
  return repos.map((r) => ({ fullName: r.full_name, private: r.private, cloneUrl: r.clone_url, updated: r.updated_at, description: r.description }));
}

async function createRepo({ name, isPrivate, description }) {
  const r = await api("POST", "/user/repos", { name, private: !!isPrivate, description: description || undefined, auto_init: false });
  return { fullName: r.full_name, cloneUrl: r.clone_url, htmlUrl: r.html_url, defaultBranch: r.default_branch };
}

// https://github.com/owner/repo(.git) 또는 git@github.com:owner/repo(.git) → "owner/repo"
function parseRemote(url) {
  const m = (url || "").match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function repoInfo(fullName) {
  const r = await api("GET", `/repos/${fullName}`);
  return { defaultBranch: r.default_branch, htmlUrl: r.html_url };
}

async function createPull({ fullName, head, base, title, body }) {
  const p = await api("POST", `/repos/${fullName}/pulls`, { head, base, title, body: body || "" });
  return { number: p.number, htmlUrl: p.html_url };
}

// git 이 github.com 에 HTTPS 로 접속할 때 토큰을 쓰게 하는 설정.
// 토큰은 명령 인자에 넣지 않고 환경 변수로만 전달한다 (프로세스 목록에 노출되지 않게).
async function gitAuth() {
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

module.exports = { init, startLogin, waitLogin, cancelLogin, logout, status, listRepos, createRepo, repoInfo, createPull, parseRemote, gitAuth, CLIENT_ID };
