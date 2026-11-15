// 원격: 목록 · 추가 · 주소 변경 · 연결 삭제 · 원격에만 있는 브랜치 가져오기
import "./RemotesSection.css";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
import { askText, confirmAction } from "@/ui/dialog";

export function renderRemotes(): void {
  const s = store.repo;
  const list = s.remoteList || [];
  const box = byId("remote-list");
  box.innerHTML = list.length
    ? list.map((r) => `<div class="remote-row" title="${esc(r.url)}">
        <span class="rn">${esc(r.name)}</span><span class="ru">${esc(r.url)}</span>
        <button type="button" data-remote-edit="${esc(r.name)}">주소</button>
        <button type="button" data-remote-del="${esc(r.name)}" aria-label="${esc(r.name)} 삭제">삭제</button></div>`).join("")
    : `<p class="muted remote-empty">연결된 원격이 없습니다.</p>`;
  const onlyRemote = Object.keys(s.remotes).filter((r) => !s.branches[r.split("/").slice(1).join("/")]);
  if (onlyRemote.length) {
    box.insertAdjacentHTML("beforeend", `<div class="remote-only"><p class="muted">원격에만 있는 브랜치</p>${onlyRemote.map((r) =>
      `<div class="remote-row"><span class="ru">${esc(r)}</span><button type="button" data-remote-co="${esc(r)}">가져오기</button></div>`).join("")}</div>`);
  }
}

export function mountRemotes(): void {
  byId("remote-list").addEventListener("click", async (e) => {
    const t = e.target as Element;
    const edit = t.closest<HTMLElement>("[data-remote-edit]");
    const del = t.closest<HTMLElement>("[data-remote-del]");
    const co = t.closest<HTMLElement>("[data-remote-co]");
    if (edit) {
      const name = edit.dataset.remoteEdit!;
      const cur = store.repo.remoteList?.find((r) => r.name === name)?.url || "";
      const url = await askText(`${name} 주소 바꾸기`, cur);
      if (url && url !== cur) await run({ op: "remoteSetUrl", args: [name, url], summary: `원격 ${name} 주소 변경` });
    } else if (del) {
      const name = del.dataset.remoteDel!;
      if (confirmAction(`원격 ${name} 연결을 지울까요?\n원격 저장소 자체는 지워지지 않고, 이 폴더와의 연결과 원격 브랜치 정보만 사라집니다.`)) {
        await run({ op: "remoteRemove", args: [name], summary: `원격 ${name} 연결 삭제` });
      }
    } else if (co) {
      await run({ op: "checkoutRemote", args: [co.dataset.remoteCo], summary: `${co.dataset.remoteCo} 를 로컬 브랜치로 가져오기` });
    }
  });
  byId("remote-add").onclick = async () => {
    const url = await askText("원격 저장소 주소", "", "예: https://github.com/아이디/저장소.git");
    if (!url) return;
    const name = await askText("원격 이름", (store.repo.remoteList || []).some((r) => r.name === "origin") ? "upstream" : "origin");
    if (name) await run({ op: "remoteAdd", args: [name, url], summary: `원격 ${name} 추가` });
  };
}
