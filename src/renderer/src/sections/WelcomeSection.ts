// 시작 화면: 저장소 열기 · URL 로 clone · 최근 저장소
import { open, recent } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { errorText, esc } from "@/lib/html";
import { askCredential } from "@/ui/credentialDialog";
import { askText } from "@/ui/dialog";
import { toast } from "@/ui/toast";

export function renderWelcome(): void {
  const list = recent();
  byId("recent-list").innerHTML = list.length
    ? list.map((r) => `<button type="button" class="recent" data-path="${esc(r)}"><span class="r-name">${esc(r.split("/").pop())}</span><span class="r-path">${esc(r)}</span></button>`).join("")
    : `<p class="muted">최근에 연 저장소가 없습니다.</p>`;
}

export function showWelcome(): void {
  renderWelcome();
  byId("welcome").classList.remove("hidden");
}

/** clone 하는 동안 화면을 바쁨 상태로 */
export async function cloneInto(url: string, retry = false): Promise<void> {
  toast(`clone 하는 중… ${url}`);
  document.body.classList.add("busy");
  let authUrl: string | null = null;
  try {
    // 인증이 필요한 GitHub 밖 호스트는 로그인 창을 띄우고 같은 위치에 다시 받는다
    await open(window.gitApi.clone(url, retry).catch((err) => {
      const m = /AUTH_REQUIRED (\S+)/.exec(errorText(err));
      if (!m) throw err;
      // 저장한 정보로도 실패: git 은 틀린 자격 증명을 도우미에서 스스로 지운다
      if (retry) throw new Error(`${new URL(m[1]).host} 에 입력한 사용자 이름이나 토큰으로 인증하지 못했습니다. 토큰 권한(저장소 읽기)을 확인하고 다시 clone 해 보세요.`);
      authUrl = m[1];
      return null;
    }));
  } finally {
    document.body.classList.remove("busy");
  }
  if (authUrl && (await askCredential(authUrl))) await cloneInto(url, true);
}

export async function cloneFlow(): Promise<void> {
  const url = await askText("clone 할 저장소 주소", "", "예: https://github.com/아이디/저장소.git — 다음 단계에서 받을 위치(상위 폴더)를 고릅니다.");
  if (url) await cloneInto(url);
}

export function mountWelcome(): void {
  byId("welcome-open").onclick = () => void open(window.gitApi.pick());
  byId("welcome-clone").onclick = () => void cloneFlow();
  byId("recent-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-path]");
    if (b) void open(window.gitApi.open(b.dataset.path!)).then(() => { if (!store.hasRepo()) renderWelcome(); });
  });
}
