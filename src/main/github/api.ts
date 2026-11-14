// GitHub REST API: 사용자, 저장소 목록·생성, PR
import { logout, token } from "@/github/auth";
import { GH_API, GH_USER_AGENT } from "@/github/constants";
import type { GhRepo, GhUser } from "@shared/types/ipc";

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const tk = await token();
  if (!tk) throw new Error("GitHub 에 로그인되어 있지 않습니다.");
  const res = await fetch(url.startsWith("http") ? url : `${GH_API}${url}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tk}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": GH_USER_AGENT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401) {
    logout();
    throw new Error("GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) {
    const detail = data && (data.errors || []).map((e: { message?: string; code?: string }) => e.message || e.code).filter(Boolean).join(", ");
    throw new Error(`GitHub: ${(data && data.message) || res.statusText}${detail ? ` (${detail})` : ""}`);
  }
  return data as T;
}

export async function fetchUser(): Promise<GhUser> {
  const u = await api<{ login: string; name: string | null; avatar_url: string }>("GET", "/user");
  return { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
}

export async function listRepos(): Promise<GhRepo[]> {
  const repos = await api<Array<{ full_name: string; private: boolean; clone_url: string; updated_at: string; description: string | null }>>(
    "GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
  return repos.map((r) => ({ fullName: r.full_name, private: r.private, cloneUrl: r.clone_url, updated: r.updated_at, description: r.description }));
}

export async function createRepo({ name, isPrivate, description }: { name: string; isPrivate: boolean; description?: string }) {
  const r = await api<{ full_name: string; clone_url: string; html_url: string; default_branch: string }>(
    "POST", "/user/repos", { name, private: !!isPrivate, description: description || undefined, auto_init: false });
  return { fullName: r.full_name, cloneUrl: r.clone_url, htmlUrl: r.html_url, defaultBranch: r.default_branch };
}

export async function repoInfo(fullName: string) {
  const r = await api<{ default_branch: string; html_url: string }>("GET", `/repos/${fullName}`);
  return { defaultBranch: r.default_branch, htmlUrl: r.html_url };
}

export async function createPull({ fullName, head, base, title, body }: { fullName: string; head: string; base: string; title: string; body?: string }) {
  const p = await api<{ number: number; html_url: string }>("POST", `/repos/${fullName}/pulls`, { head, base, title, body: body || "" });
  return { number: p.number, htmlUrl: p.html_url };
}

/** https://github.com/owner/repo(.git) 또는 git@github.com:owner/repo(.git) → "owner/repo" */
export function parseRemote(url: string | null | undefined): string | null {
  const m = (url || "").match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
