// GitHub IPC: 로그인 · 저장소 목록 · 새 저장소로 올리기 · PR
import { clipboard, shell } from "electron";
import { handle } from "@/ipc/guard";
import { git } from "@/git/cli";
import { upstreamOf } from "@/git/ops/context";
import { execute } from "@/git/ops/execute";
import { readRepo } from "@/git/readRepo";
import { createPull, createRepo, fetchUser, listPulls, listRepos, parseRemote, repoInfo } from "@/github/api";
import { authStatus, cancelLogin, logout, startLogin, waitLogin } from "@/github/auth";
import { requireRoot, send } from "@/repo/session";
import { t } from "@shared/i18n/i18n";

const remoteUrl = async (root: string, name: string) => ((await git(root, ["remote", "get-url", name], { allowFail: true })) || "").trim();

export function registerGithubIpc(): void {
  handle("gh:status", () => authStatus());

  handle("gh:login", async () => {
    const d = await startLogin();
    clipboard.writeText(d.userCode); // gh CLI 처럼 코드를 미리 복사해 둔다
    void shell.openExternal(d.verificationUri);
    waitLogin(d, fetchUser)
      .then((user) => send("gh:changed", { loggedIn: true, user }))
      .catch((err: Error) => send("gh:changed", { ...authStatus(), error: err.message }));
    return { userCode: d.userCode, verificationUri: d.verificationUri };
  });

  handle("gh:cancel", () => cancelLogin());
  handle("gh:logout", () => { logout(); return authStatus(); });
  handle("gh:repos", () => listRepos());
  handle("gh:openUrl", (_e, url: string) => {
    if (/^https:\/\/github\.com\//.test(url)) void shell.openExternal(url);
  });

  // 지금 저장소를 새 GitHub 저장소로 만들어 올린다: 원격 추가 + 현재 브랜치 push
  handle("gh:createRepo", async (_e, { name, isPrivate }: { name: string; isPrivate: boolean }) => {
    const root = requireRoot();
    const created = await createRepo({ name, isPrivate });
    const remotes = ((await git(root, ["remote"])) || "").split("\n").filter(Boolean);
    const remoteName = remotes.includes("origin") ? "github" : "origin";
    const add = await execute(root, "remoteAdd", [remoteName, created.cloneUrl]);
    if (!add.ok) throw new Error(add.error);
    const branch = ((await git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true })) || "").trim();
    const cmds = [...add.cmds];
    if (branch) {
      const push = await execute(root, "push", [branch]);
      cmds.push(...push.cmds);
      if (!push.ok) throw new Error(push.error);
    }
    return { ...created, remoteName, cmds, repo: await readRepo(root) };
  });

  // PR 만들기: 브랜치가 원격에 없으면 먼저 push 한다
  handle("gh:pr", async (_e, { head, base, title, body }: { head: string; base?: string; title: string; body?: string }) => {
    const root = requireRoot();
    const cmds: string[] = [];
    let up = await upstreamOf(root, head);
    if (!up) {
      const push = await execute(root, "push", [head]);
      cmds.push(...push.cmds);
      if (!push.ok) throw new Error(push.error);
      up = await upstreamOf(root, head);
    }
    const [remoteName, ...rest] = up.split("/");
    const url = await remoteUrl(root, remoteName);
    const fullName = parseRemote(url);
    if (!fullName) throw new Error(t("m.gh.notGithubRemote", { remote: remoteName, url }));
    const baseBranch = base || (await repoInfo(fullName)).defaultBranch;
    const pr = await createPull({ fullName, head: rest.join("/"), base: baseBranch, title, body });
    void shell.openExternal(pr.htmlUrl);
    return { ...pr, base: baseBranch, cmds, repo: await readRepo(root) };
  });

  // 열린 PR 목록: origin(없으면 첫 GitHub 원격) 저장소 기준
  handle("gh:pulls", async () => {
    const root = requireRoot();
    const remotes = ((await git(root, ["remote"])) || "").split("\n").filter(Boolean);
    const order = [...remotes.filter((r) => r === "origin"), ...remotes.filter((r) => r !== "origin")];
    for (const remote of order) {
      const fullName = parseRemote(await remoteUrl(root, remote));
      if (fullName) return { fullName, remote, pulls: await listPulls(fullName) };
    }
    return { fullName: null, remote: null, pulls: [] };
  });

  // PR 창에 미리 채울 기본 브랜치
  handle("gh:prDefaults", async (_e, head: string) => {
    const root = requireRoot();
    const up = await upstreamOf(root, head);
    const fullName = parseRemote(await remoteUrl(root, up ? up.split("/")[0] : "origin"));
    if (!fullName) return { fullName: null };
    const info = await repoInfo(fullName).catch(() => null);
    return { fullName, base: info ? info.defaultBranch : "main" };
  });
}
