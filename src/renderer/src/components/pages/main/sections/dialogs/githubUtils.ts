// GitHub 계정 연동: 로그인 · 내 저장소에서 clone · 새 저장소로 올리기 · PR 만들기
import { errorText } from "@/lib/html";
import { createStore } from "@/lib/createStore";
import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { toast } from "@/components/ui/toastUtils";
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { registerContextProvider } from "@/interactions/contextMenu";
import { setPullsLogin } from "@/components/pages/main/sections/sidebar/pullsUtils";
import { t } from "@shared/i18n/i18n";
import type { GhRepo, GhStatus } from "@shared/types/ipc";

export const ghStatusStore = createStore<GhStatus>({ loggedIn: false });
/** 로그인 창 (기기 코드) */
export const ghLoginStore = createStore<{ userCode: string; verificationUri: string } | null>(null);
/** 내 저장소 목록 창 */
export const ghReposStore = createStore<GhRepo[] | null>(null);

let afterLogin: ((ok: boolean) => void) | null = null;

const finishLogin = (ok: boolean) => {
  afterLogin?.(ok);
  afterLogin = null;
};

export const login = async (): Promise<void> => {
  try {
    ghLoginStore.set(await window.ghApi.login());
  } catch (err) {
    finishLogin(false);
    toast(errorText(err));
  }
};

export const cancelLogin = () => {
  void window.ghApi.cancel();
  ghLoginStore.set(null);
  finishLogin(false);
};

export const logout = async (): Promise<void> => {
  const s = ghStatusStore.get();
  if (!confirmAction(t("gh.confirmLogout", { login: s.user?.login || "" }))) return;
  ghStatusStore.set(await window.ghApi.logout());
  setPullsLogin(false);
};

/** 로그인돼 있지 않으면 로그인 창을 띄우고 끝날 때까지 기다린다 */
const requireLogin = (): Promise<boolean> => {
  if (ghStatusStore.get().loggedIn) return Promise.resolve(true);
  return new Promise((resolve) => { afterLogin = resolve; void login(); });
};

const busy = async <T>(msg: string, work: () => Promise<T>): Promise<T | undefined> => {
  toast(msg);
  document.body.classList.add("busy");
  try { return await work(); } catch (err) { toast(errorText(err)); return undefined; } finally { document.body.classList.remove("busy"); }
};

export const cloneFromGithub = async (): Promise<void> => {
  if (!(await requireLogin())) return;
  try { ghReposStore.set(await window.ghApi.repos()); } catch (err) { toast(errorText(err)); }
};

export const publish = async (): Promise<void> => {
  if (!(await requireLogin())) return;
  const s = store.repo, user = ghStatusStore.get().user?.login ?? "";
  const name = await askText(t("gh.newRepoName"), s.repoName || "", t("gh.newRepoHint", { user, branch: s.head }));
  if (!name) return;
  const isPrivate = confirmAction(t("gh.confirmPrivate", { repo: `${user}/${name}` }));
  const r = await busy(t("gh.creating", { name }), () => window.ghApi.createRepo(name, isPrivate));
  if (!r) return;
  store.addLog({ summary: t("gh.createdSummary", { repo: r.fullName }), cmd: [`POST /user/repos  # ${r.fullName}${isPrivate ? t("gh.privateNote") : ""}`, ...r.cmds].join("\n") });
  show(r.repo);
  toast(t("gh.pushedTo", { repo: r.fullName }));
};

const makePR = async (branch: string): Promise<void> => {
  if (!(await requireLogin())) return;
  const d = await window.ghApi.prDefaults(branch).catch(() => null);
  if (!d?.fullName) { toast(t("gh.notGithub")); return; }
  const base = await askText(t("gh.prBase"), d.base || "", t("gh.prBaseHint", { repo: d.fullName, branch }));
  if (!base) return;
  if (base === branch) { toast(t("gh.prSameBranch")); return; }
  const s = store.repo;
  const tip = s.commits[s.branches[branch]];
  const title = await askText(t("gh.prTitle"), tip ? tip.msg.split("\n")[0] : branch);
  if (!title) return;
  const r = await busy(t("gh.prCreating"), () => window.ghApi.pr({ head: branch, base, title }));
  if (!r) return;
  store.addLog({ summary: `PR #${r.number}: ${branch} → ${r.base}`, cmd: [...r.cmds, `gh pr create --base ${r.base} --head ${branch} --title ${JSON.stringify(title)}`].join("\n") });
  show(r.repo);
  toast(t("gh.prCreated", { n: r.number }));
};

/** 앱을 켤 때 한 번: 로그인 상태를 받아 오고, 바뀌면 알림 · PR 메뉴를 연결한다 */
export const initGithub = () => {
  const gh = window.ghApi;
  gh.onChanged((s) => {
    ghStatusStore.set(s);
    setPullsLogin(!!s.loggedIn);
    ghLoginStore.set(null);
    if (s.error) toast(s.error);
    else if (s.loggedIn && s.user) toast(t("gh.loggedIn", { login: s.user.login }));
    finishLogin(!!s.loggedIn);
  });
  registerContextProvider((src) => {
    const b = src.branch;
    if (src.kind !== "label" || !b || !store.repo.branches[b]) return [];
    return [{ label: t("gh.makePr"), cmd: "gh pr create", onPick: () => void makePR(b) }];
  });
  void gh.status().then((s) => { ghStatusStore.set(s); setPullsLogin(!!s.loggedIn); });
};
