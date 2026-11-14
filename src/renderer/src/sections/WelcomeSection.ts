// 시작 화면: 저장소 열기 · URL 로 clone · 최근 저장소
import { open, recent } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
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
export async function cloneInto(url: string): Promise<void> {
  toast(`clone 하는 중… ${url}`);
  document.body.classList.add("busy");
  try { await open(window.gitApi.clone(url)); } finally { document.body.classList.remove("busy"); }
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
