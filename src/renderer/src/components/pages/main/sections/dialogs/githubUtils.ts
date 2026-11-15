// GitHub 계정 연동: 로그인 · 내 저장소에서 clone · 새 저장소로 올리기 · PR 만들기
import { errorText } from "@/lib/html";
import { createStore } from "@/lib/createStore";
import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { toast } from "@/components/ui/toastUtils";
import { show } from "@/app/repoSession";
import { store } from "@/app/store";
import { registerContextProvider } from "@/interactions/contextMenu";
import { setPullsLogin } from "@/components/pages/main/sections/sidebar/pullsUtils";
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
  if (!confirmAction(`GitHub 계정 ${s.user?.login || ""} 에서 로그아웃할까요?\n이 컴퓨터에 저장된 토큰을 지웁니다.`)) return;
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
  const name = await askText("새 GitHub 저장소 이름", s.repoName || "", `${user} 계정에 만들고, 원격으로 연결한 뒤 ${s.head} 브랜치를 push 합니다.`);
  if (!name) return;
  const isPrivate = confirmAction(`${user}/${name} 을(를) 비공개 저장소로 만들까요?\n확인 = 비공개, 취소 = 공개`);
  const r = await busy(`GitHub 에 ${name} 저장소를 만드는 중…`, () => window.ghApi.createRepo(name, isPrivate));
  if (!r) return;
  store.addLog({ summary: `GitHub 저장소 ${r.fullName} 만들고 올리기`, cmd: [`POST /user/repos  # ${r.fullName}${isPrivate ? " (비공개)" : ""}`, ...r.cmds].join("\n") });
  show(r.repo);
  toast(`${r.fullName} 에 올렸습니다.`);
};

const makePR = async (branch: string): Promise<void> => {
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
};

/** 앱을 켤 때 한 번: 로그인 상태를 받아 오고, 바뀌면 알림 · PR 메뉴를 연결한다 */
export const initGithub = () => {
  const gh = window.ghApi;
  gh.onChanged((s) => {
    ghStatusStore.set(s);
    setPullsLogin(!!s.loggedIn);
    ghLoginStore.set(null);
    if (s.error) toast(s.error);
    else if (s.loggedIn && s.user) toast(`GitHub 에 ${s.user.login} 로 로그인했습니다.`);
    finishLogin(!!s.loggedIn);
  });
  registerContextProvider((src) => {
    const b = src.branch;
    if (src.kind !== "label" || !b || !store.repo.branches[b]) return [];
    return [{ label: "GitHub PR 만들기…", cmd: "gh pr create", onPick: () => void makePR(b) }];
  });
  void gh.status().then((s) => { ghStatusStore.set(s); setPullsLogin(!!s.loggedIn); });
};
