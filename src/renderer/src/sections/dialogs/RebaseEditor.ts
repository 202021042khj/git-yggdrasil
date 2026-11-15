// 커밋 정리(interactive rebase) 창: 브랜치의 커밋 순서·합치기·메시지·빼기를 한 번에 정하고 결과를 미리 본 뒤 실행
import "./RebaseEditor.css";
import { runPreviewed } from "@/app/actions";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { pushedSet, stems } from "@/model/graph";
import { isError, preview } from "@/model/preview";
import { toast } from "@/ui/toast";
import type { RebaseStep } from "@shared/types/ipc";

const ACTIONS: Array<[RebaseStep["action"], string, string]> = [
  ["pick", "그대로", "pick"],
  ["reword", "메시지 수정", "reword"],
  ["squash", "위 커밋에 합치기", "squash"],
  ["fixup", "위 커밋에 합치기 (메시지 버림)", "fixup"],
  ["drop", "빼기", "drop"],
];

let branch = "";
let steps: RebaseStep[] = [];
let original: RebaseStep[] = [];
let dragFrom = -1;

const needsMsg = (a: RebaseStep["action"]) => a === "reword" || a === "squash";

/** squash 를 고르면 기본 메시지로 위 커밋과 이 커밋의 메시지를 이어 붙인다 */
function defaultMsg(i: number, action: RebaseStep["action"]): string {
  const s = store.repo;
  const msg = s.commits[steps[i].id].msg;
  if (action !== "squash") return msg;
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j].action === "drop") continue;
    return `${steps[j].msg ?? s.commits[steps[j].id].msg}\n\n${msg}`;
  }
  return msg;
}

function currentPreview() {
  return preview("rebasePlan", store.repo, [branch, steps]);
}

function draw(): void {
  const s = store.repo;
  const pushed = pushedSet(s);
  byId("rebase-list").innerHTML = steps.map((x, i) => {
    const c = s.commits[x.id];
    return `<li class="rb-row a-${x.action}" draggable="true" data-i="${i}">
      <span class="rb-grip" aria-hidden="true">⋮⋮</span>
      <span class="rb-move"><button type="button" class="small" data-up="${i}" aria-label="위로" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="small" data-down="${i}" aria-label="아래로" ${i === steps.length - 1 ? "disabled" : ""}>↓</button></span>
      <select data-act="${i}" aria-label="${esc(c.msg)} 에 할 일">${ACTIONS.map(([v, label]) => `<option value="${v}" ${v === x.action ? "selected" : ""}>${label}</option>`).join("")}</select>
      <span class="rb-main">
        <span class="rb-msg">${esc(c.msg)}</span>
        <span class="muted rb-meta">${short(x.id)}${c.files.length ? ` · 파일 ${c.files.length}개` : ""}${pushed.has(x.id) ? " · push 됨" : ""}</span>
        ${needsMsg(x.action) ? `<textarea data-msg="${i}" rows="${x.action === "squash" ? 3 : 1}" aria-label="새 메시지">${esc(x.msg ?? "")}</textarea>` : ""}
      </span></li>`;
  }).join("");
  const r = currentPreview();
  const run = byId<HTMLButtonElement>("rebase-run");
  run.disabled = isError(r);
  byId("rebase-result").innerHTML = isError(r)
    ? `<p class="muted">${esc(r.error)}</p>`
    : `<p><b>${esc(r.summary)}</b></p>${r.conflicts.length ? `<p class="warn">⚠ 충돌할 수 있는 파일: ${r.conflicts.map(esc).join(", ")} — 체크아웃한 브랜치라면 멈춘 뒤 해결하며 진행합니다.</p>` : ""}${r.rewrites.some((id) => pushed.has(id)) ? `<p class="warn">push 된 커밋을 다시 씁니다. 이후 force push 가 필요합니다.</p>` : ""}`;
}

function move(from: number, to: number): void {
  if (to < 0 || to >= steps.length || from === to) return;
  const [x] = steps.splice(from, 1);
  steps.splice(to, 0, x);
  draw();
  (byId("rebase-list").querySelector(`[data-act="${to}"]`) as HTMLElement | null)?.focus();
}

export function openRebaseEditor(b: string): void {
  const s = store.repo;
  const st = stems(s).stems[b];
  if (!st || !st.ids.length) { toast(`${b} 에 정리할 커밋이 없습니다.`); return; }
  if (!st.base) { toast(`${b} 는 첫 커밋부터 시작하는 줄기라 아직 정리할 수 없습니다.`); return; }
  if (st.ids.some((id) => s.commits[id].parents.length > 1)) { toast("merge 커밋이 있는 줄기는 아직 정리할 수 없습니다."); return; }
  branch = b;
  original = st.ids.map((id) => ({ id, action: "pick" }));
  steps = original.map((x) => ({ ...x }));
  byId("rebase-title").textContent = `${b} 커밋 정리 (${st.ids.length}개)`;
  draw();
  byId<HTMLDialogElement>("rebase").showModal();
}

export function mountRebaseEditor(): void {
  const list = byId("rebase-list");
  const dlg = byId<HTMLDialogElement>("rebase");
  list.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const up = t.closest<HTMLElement>("[data-up]"), down = t.closest<HTMLElement>("[data-down]");
    if (up) move(Number(up.dataset.up), Number(up.dataset.up) - 1);
    if (down) move(Number(down.dataset.down), Number(down.dataset.down) + 1);
  });
  list.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (!t.dataset.act) return;
    const i = Number(t.dataset.act), action = t.value as RebaseStep["action"];
    steps[i] = { id: steps[i].id, action, ...(needsMsg(action) ? { msg: defaultMsg(i, action) } : {}) };
    draw();
    (list.querySelector(`[data-msg="${i}"]`) as HTMLTextAreaElement | null)?.focus();
  });
  list.addEventListener("input", (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (!t.dataset.msg) return;
    steps[Number(t.dataset.msg)].msg = t.value;
    // 입력 중에는 목록을 다시 그리지 않고 결과만 갱신 (커서 유지)
    const r = currentPreview();
    byId<HTMLButtonElement>("rebase-run").disabled = isError(r);
    byId("rebase-result").innerHTML = isError(r) ? `<p class="muted">${esc(r.error)}</p>` : `<p><b>${esc(r.summary)}</b></p>`;
  });
  list.addEventListener("keydown", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (!row || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = Number(row.dataset.i);
    move(i, e.key === "ArrowUp" ? i - 1 : i + 1);
  });
  // 줄 끌어서 순서 바꾸기
  list.addEventListener("dragstart", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (!row) return;
    dragFrom = Number(row.dataset.i);
    e.dataTransfer?.setData("text/plain", String(dragFrom));
    row.classList.add("dragging-row");
  });
  list.addEventListener("dragover", (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    list.querySelectorAll(".drop-before").forEach((el) => el.classList.remove("drop-before"));
    (e.target as Element).closest("[data-i]")?.classList.add("drop-before");
  });
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    const row = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (row && dragFrom >= 0) move(dragFrom, Number(row.dataset.i));
    dragFrom = -1;
  });
  list.addEventListener("dragend", () => { dragFrom = -1; draw(); });

  byId("rebase-reset").onclick = () => { steps = original.map((x) => ({ ...x })); draw(); };
  byId("rebase-cancel").onclick = () => dlg.close();
  byId("rebase-run").onclick = async () => {
    const r = currentPreview();
    if (isError(r)) { toast(r.error); return; }
    dlg.close();
    await runPreviewed("rebasePlan", [branch, steps.map((x) => ({ ...x }))], r);
  };
}
