// GitHub 계정 연동: 로그인 · 내 저장소에서 clone · 새 저장소로 올리기 · PR 만들기
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { registerContextProvider } from "@/interactions/contextMenu";
import { byId } from "@/lib/dom";
import { errorText, esc } from "@/lib/html";
import { setPullsLogin } from "@/sections/PullsSection";
import { cloneInto } from "@/sections/WelcomeSection";
import { askText, confirmAction } from "@/ui/dialog";
import { toast } from "@/ui/toast";
import type { GhRepo, GhStatus } from "@shared/types/ipc";

let status: GhStatus = { loggedIn: false };
let loginInfo: { userCode: string; verificationUri: string } | null = null;
let afterLogin: ((ok: boolean) => void) | null = null;
let repos: GhRepo[] = [];

function finishLogin(ok: boolean): void {
  afterLogin?.(ok);
  afterLogin = null;
}

export function renderGithub(): void {
  const b = byId<HTMLButtonElement>("gh-account");
  b.hidden = false;
  if (status.loggedIn && status.user) {
    const u = status.user;
    b.innerHTML = `${u.avatar ? `<img src="${esc(u.avatar)}&s=36" alt="">` : ""}${esc(u.login)}`;
    b.title = `${u.name} (${u.login}) — 클릭하면 로그아웃`;
  } else {
    b.textContent = "GitHub 로그인";
    b.title = "GitHub 계정으로 로그인하면 push·pull 인증, 내 저장소 clone, PR 만들기를 쓸 수 있습니다";
  }
  const s = store.repo;
  const hasGithub = (s.remoteList || []).some((r) => /github\.com[:/]/.test(r.url));
  byId("gh-publish").hidden = !store.hasRepo() || hasGithub;
}

async function login(): Promise<void> {
  try {
    loginInfo = await window.ghApi.login();
  } catch (err) {
    finishLogin(false);
    toast(errorText(err));
    return;
  }
  byId("gh-code").textContent = loginInfo.userCode;
  byId("gh-login-status").textContent = "승인을 기다리는 중…";
  byId<HTMLDialogElement>("gh-login").showModal();
}

/** 로그인돼 있지 않으면 로그인 창을 띄우고 끝날 때까지 기다린다 */
function requireLogin(): Promise<boolean> {
  if (status.loggedIn) return Promise.resolve(true);
  return new Promise((resolve) => { afterLogin = resolve; void login(); });
}

async function busy<T>(msg: string, work: () => Promise<T>): Promise<T | undefined> {
  toast(msg);
  document.body.classList.add("busy");
  try { return await work(); } catch (err) { toast(errorText(err)); return undefined; } finally { document.body.classList.remove("busy"); }
}

function renderRepoList(): void {
  const q = byId<HTMLInputElement>("gh-filter").value.trim().toLowerCase();
  const list = repos.filter((r) => !q || r.fullName.toLowerCase().includes(q));
  byId("gh-repo-list").innerHTML = list.length
    ? list.map((r) => `<button type="button" role="listitem" class="gh-repo" data-i="${repos.indexOf(r)}">
        <span class="n">${esc(r.fullName)}${r.private ? " · 비공개" : ""}</span><span class="d">${esc(r.description || "")}</span></button>`).join("")
    : `<p class="muted">찾는 저장소가 없습니다.</p>`;
}

async function cloneFromGithub(): Promise<void> {
  if (!(await requireLogin())) return;
  try { repos = await window.ghApi.repos(); } catch (err) { toast(errorText(err)); return; }
  byId<HTMLInputElement>("gh-filter").value = "";
  renderRepoList();
  byId<HTMLDialogElement>("gh-repos").showModal();
  byId("gh-filter").focus();
}

async function publish(): Promise<void> {
  if (!(await requireLogin())) return;
  const s = store.repo, login = status.user?.login ?? "";
  const name = await askText("새 GitHub 저장소 이름", s.repoName || "", `${login} 계정에 만들고, 원격으로 연결한 뒤 ${s.head} 브랜치를 push 합니다.`);
  if (!name) return;
  const isPrivate = confirmAction(`${login}/${name} 을(를) 비공개 저장소로 만들까요?\n확인 = 비공개, 취소 = 공개`);
  const r = await busy(`GitHub 에 ${name} 저장소를 만드는 중…`, () => window.ghApi.createRepo(name, isPrivate));
  if (!r) return;
  store.addLog({ summary: `GitHub 저장소 ${r.fullName} 만들고 올리기`, cmd: [`POST /user/repos  # ${r.fullName}${isPrivate ? " (비공개)" : ""}`, ...r.cmds].join("\n") });
  show(r.repo);
  toast(`${r.fullName} 에 올렸습니다.`);
}

async function makePR(branch: string): Promise<void> {
  if (!(await requireLogin())) return;
  const d = await window.ghApi.prDefaults(branch).catch(() => null);
  if (!d?.fullName) { toast("이 브랜치의 원격이 GitHub 저장소가 아닙니다. 먼저 GitHub 원격을 연결하세요."); return; }
  const base = await askText("어느 브랜치로 합칠까요? (base)", d.base || "", `${d.fullName} 에 PR 을 만듭니다. ${branch} 가 원격에 없으면 먼저 push 합니다.`);
  if (!base) return;
  if (base === branch) { toast("같은 브랜치로는 PR 을 만들 수 없습니다."); return; }
  const s = store.repo;
  const tip = s.commits[s.branches[branch]];
  const title = await askText("PR 제목", tip ? tip.msg.split("\n")[0] : branch);
  if (!title) return;
  const r = await busy("PR 을 만드는 중…", () => window.ghApi.pr({ head: branch, base, title }));
  if (!r) return;
  store.addLog({ summary: `PR #${r.number}: ${branch} → ${r.base}`, cmd: [...r.cmds, `gh pr create --base ${r.base} --head ${branch} --title ${JSON.stringify(title)}`].join("\n") });
  show(r.repo);
  toast(`PR #${r.number} 을 만들고 브라우저에서 열었습니다.`);
}

export function mountGithub(): void {
  const gh = window.ghApi;
  byId("gh-account").onclick = async () => {
    if (!status.loggedIn) return void login();
    if (confirmAction(`GitHub 계정 ${status.user?.login || ""} 에서 로그아웃할까요?\n이 컴퓨터에 저장된 토큰을 지웁니다.`)) { status = await gh.logout(); setPullsLogin(false); }
    renderGithub();
  };
  byId("gh-reopen").onclick = () => { if (loginInfo) void gh.openUrl(loginInfo.verificationUri); };
  byId("gh-cancel").onclick = () => { void gh.cancel(); byId<HTMLDialogElement>("gh-login").close(); finishLogin(false); };
  byId("gh-filter").oninput = renderRepoList;
  byId("gh-repos-close").onclick = () => byId<HTMLDialogElement>("gh-repos").close();
  byId("gh-repo-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (!b) return;
    const r = repos[Number(b.dataset.i)];
    byId<HTMLDialogElement>("gh-repos").close();
    void cloneInto(r.cloneUrl);
  });
  byId("welcome-gh").onclick = () => void cloneFromGithub();
  byId("gh-publish").onclick = () => void publish();

  gh.onChanged((s) => {
    status = s;
    setPullsLogin(!!s.loggedIn);
    renderGithub();
    const dlg = byId<HTMLDialogElement>("gh-login");
    if (dlg.open) dlg.close();
    if (s.error) toast(s.error);
    else if (s.loggedIn && s.user) toast(`GitHub 에 ${s.user.login} 로 로그인했습니다.`);
    finishLogin(!!s.loggedIn);
  });

  registerContextProvider((src) => {
    const b = src.branch;
    if (src.kind !== "label" || !b || !store.repo.branches[b]) return [];
    return [{ label: "GitHub PR 만들기…", cmd: "gh pr create", onPick: () => void makePR(b) }];
  });

  void gh.status().then((s) => { status = s; setPullsLogin(!!s.loggedIn); renderGithub(); });
}
