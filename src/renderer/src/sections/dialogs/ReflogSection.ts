// 예전 커밋 찾기 (reflog): 되돌리기 기록 밖에서 사라진 커밋을 찾아 브랜치로 살리거나 가져온다
import "./ReflogSection.css";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { errorText, esc, short } from "@/lib/html";
import { fullTime, relTime } from "@/lib/time";
import { revealCommit } from "@/sections/canvas/CanvasSection";
import { askText, confirmAction } from "@/ui/dialog";
import { openMenu } from "@/ui/menu";
import type { ReflogEntry } from "@shared/types/ipc";

let entries: ReflogEntry[] = [];

function draw(): void {
  const onlyLost = byId<HTMLInputElement>("reflog-lost").checked;
  const list = onlyLost ? entries.filter((e) => e.lost) : entries;
  byId("reflog-list").innerHTML = list.length
    ? list.map((e) => `<button type="button" role="listitem" class="rl-row ${e.lost ? "lost" : ""}" data-rl="${entries.indexOf(e)}" aria-haspopup="menu">
        <span class="rl-when" title="${esc(fullTime(e.date))}">${esc(relTime(e.date))}</span>
        <span class="rl-main"><span class="rl-subject">${esc(e.subject)}</span>
          <span class="muted rl-what">${esc(e.action)}${e.detail ? ` · ${esc(e.detail)}` : ""}</span></span>
        <code class="rl-id">${short(e.id)}</code>${e.lost ? '<span class="pr-badge bad">잃어버림</span>' : ""}</button>`).join("")
    : `<p class="muted">${onlyLost ? "잃어버린 커밋이 없습니다. 모든 기록이 브랜치·태그에서 닿습니다." : "기록이 없습니다."}</p>`;
}

export async function openReflog(): Promise<void> {
  if (!store.hasRepo()) return;
  const dlg = byId<HTMLDialogElement>("reflog");
  byId("reflog-list").innerHTML = `<p class="muted">불러오는 중…</p>`;
  if (!dlg.open) dlg.showModal();
  try {
    entries = await window.gitApi.reflog();
  } catch (err) {
    byId("reflog-list").innerHTML = `<p class="muted">${esc(errorText(err))}</p>`;
    return;
  }
  draw();
}

function entryMenu(e: ReflogEntry, x: number, y: number): void {
  const s = store.repo;
  const inGraph = !!s.commits[e.id];
  const head = s.head && s.branches[s.head] ? s.head : null;
  openMenu(x, y, `${short(e.id)} ${e.subject}`, [
    ...(inGraph ? [{ label: "그래프에서 보기", cmd: "", onPick: () => { byId<HTMLDialogElement>("reflog").close(); revealCommit(e.id); } }] : []),
    {
      label: "여기서 새 브랜치로 살리기…", cmd: `git branch <이름> ${short(e.id)}`,
      onPick: async () => {
        const name = await askText("살릴 브랜치 이름", `rescue/${short(e.id)}`, "이 커밋을 끝으로 하는 브랜치를 만듭니다. 작업 영역은 그대로입니다.");
        if (!name) return;
        if (await run({ op: "createBranch", args: [name, e.id], summary: `예전 커밋 ${short(e.id)} 를 브랜치 ${name} 로 살리기` })) void openReflog();
      },
    },
    ...(head ? [{
      label: `${head} 에 이 커밋만 복사 (cherry-pick)`, cmd: `git cherry-pick ${short(e.id)}`,
      onPick: async () => { if (await run({ op: "cherryPick", args: [[e.id], head], summary: `예전 커밋 ${short(e.id)} 를 ${head} 에 복사` })) void openReflog(); },
    }, {
      label: `${head} 를 이 커밋으로 되돌리기…`, cmd: `git reset --keep ${short(e.id)}`,
      onPick: async () => {
        if (!confirmAction(`${head} 브랜치를 ${short(e.id)} "${e.subject}" 로 옮깁니다.\n파일도 그 커밋 상태로 바뀝니다. 커밋하지 않은 변경과 겹치면 git 이 거절하니 변경은 안전합니다.\n지금 끝에 있는 커밋은 reflog 와 앱 백업에 남아 이 창에서 다시 찾을 수 있습니다. 계속할까요?`)) return;
        if (await run({ op: "resetHead", args: [e.id, "keep"], summary: `${head} 를 예전 커밋 ${short(e.id)} 로 되돌리기` })) void openReflog();
      },
    }] : []),
  ]);
}

export function mountReflog(): void {
  byId("reflog-open").onclick = () => void openReflog();
  byId("reflog-close").onclick = () => byId<HTMLDialogElement>("reflog").close();
  byId("reflog-lost").onchange = draw;
  byId("reflog-list").addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-rl]");
    if (!b) return;
    const r = b.getBoundingClientRect();
    entryMenu(entries[Number(b.dataset.rl)], r.left + 40, r.bottom);
  });
}
