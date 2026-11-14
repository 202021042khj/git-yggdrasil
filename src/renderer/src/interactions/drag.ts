// 드래그: 끌기 시작하면 놓을 수 있는 곳마다 동사 라벨을 띄우고, 가까이 가면 자석처럼 붙고,
// 결과를 캔버스 위에 겹쳐 보여 준다. 조작이 여러 개면 놓을 때 메뉴로 고른다.
import { blocked, runPreviewed } from "@/app/actions";
import { setRefreshGuard } from "@/app/repoSession";
import { store } from "@/app/store";
import { SNAP_PX } from "@/constants/layout";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
import { under } from "@/lib/paths";
import { branchesAt, stems } from "@/model/graph";
import { dimmedCommits, visibleRepo } from "@/model/filter";
import { renderGraph } from "@/model/layout";
import { oldestFirst, rangeOnStem, toggleIn } from "@/model/selection";
import { isError, preview, touchesPushed, type Preview } from "@/model/preview";
import { actionsFor, candidateTargets, quickLabelVerb, sourceFromElement, sourceLabel, type Action, type DragSource, type DropTarget } from "@/interactions/targets";
import { pinLaneNames } from "@/sections/CanvasSection";
import { focusMessageInput } from "@/sections/DetailSection";
import { askText } from "@/ui/dialog";
import { closeMenu, menuKey, openMenu } from "@/ui/menu";
import { toast } from "@/ui/toast";

interface DragState {
  src: DragSource;
  srcEl: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
}

interface Placed {
  tgt: DropTarget;
  actions: Action[] | null;
  el: Element;
  hit: { left: number; top: number; width: number; height: number };
  pill: HTMLElement;
}

/** 패널처럼 넓은 놓는 곳 (안에 들어가면 바로 그곳) */
const PANEL = new Set(["working", "trash", "stash", "remote"]);
const DRAG_START_PX = 5;
const DOUBLE_CLICK_MS = 400;

let drag: DragState | null = null;
let placed: Placed[] = [];
let hover: Placed | null = null;
let lastClick = { id: "", t: 0 };

export const isDragging = () => !!drag;

function targetSelector(t: DropTarget): string {
  const q = (v: unknown) => CSS.escape(String(v));
  switch (t.kind) {
    case "label": return `#graph .ref.local[data-branch="${q(t.branch)}"]`;
    case "commit": return `#graph .node[data-id="${q(t.id)}"]`;
    case "gap": return `#graph .gap[data-branch="${q(t.branch)}"][data-index="${t.index}"]`;
    case "working": return ".working-card";
    case "trash": return ".trash";
    case "stash": return ".stash-tray";
    case "remote": return "#graph .remote-band";
    case "canvas": return "#canvas-wrap";
  }
}

/** 결과를 본 캔버스 위에 겹쳐 보여 준다 (지금 그래프는 흐리게) */
export function showInCanvas(res: Preview): void {
  const s = store.repo;
  const oldIds = new Set(Object.keys(s.commits));
  const newIds = new Set(Object.keys(res.state.commits).filter((c) => !oldIds.has(c)));
  const f = store.ui.filter;
  const r = renderGraph(visibleRepo(res.state, f), { newIds, minWidth: byId("canvas-wrap").clientWidth, dim: dimmedCommits(res.state, f) });
  const svg = byId("ghost-graph") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(r.width));
  svg.setAttribute("height", String(r.height));
  svg.innerHTML = r.svg;
  pinLaneNames();
  byId("canvas-wrap").classList.add("previewing");
}

export function hideInCanvas(): void {
  byId("canvas-wrap").classList.remove("previewing");
  byId("ghost-graph").innerHTML = "";
}

function tipHtml(res: Preview, n: number): string {
  const locked = touchesPushed(store.repo, res);
  return `<div class="sum">${esc(res.summary)}</div><code>${esc(res.cmd)}</code>
    ${res.conflicts.length ? `<div class="warn">충돌 예상: ${res.conflicts.map(esc).join(", ")} — 현재 브랜치면 충돌 지점에서 멈추고 해결 모드로 들어갑니다</div>` : ""}
    ${locked ? `<div class="lock">push 된 히스토리를 다시 씁니다 — 실행 전에 확인합니다</div>` : ""}
    ${n > 1 ? `<div class="hint">놓으면 ${n}가지 중에서 고릅니다</div>` : ""}`;
}

// ---------- 끌기 시작: 놓을 곳마다 라벨 ----------
function begin(d: DragState): void {
  const s = store.repo, st = stems(s);
  const layer = byId("v2-layer");
  layer.innerHTML = "";
  placed = [];
  hover = null;
  // 이름표·태그를 끌 때는 화면에 보이는 커밋만 후보로 (큰 저장소에서 모든 커밋을 계산하면 수 초가 걸린다)
  const view = byId("canvas-wrap").getBoundingClientRect();
  const visible = new Set<string>();
  if (d.src.kind === "label" || d.src.kind === "tag") {
    document.querySelectorAll<SVGGElement>("#graph .node[data-id]").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom) visible.add(n.dataset.id!);
    });
  }
  const seen = new Set<string>();
  for (const tgt of candidateTargets(d.src, { commitFilter: (c) => visible.has(c) }, s, st)) {
    if (tgt.kind === "label" && d.src.kind === "label" && tgt.branch === d.src.branch) continue;
    const actions = tgt.lazy ? null : actionsFor(d.src, tgt, s, st);
    if (actions && !actions.length) continue;
    const el = document.querySelector(targetSelector(tgt));
    if (!el || el === d.srcEl || (tgt.kind !== "canvas" && el.contains(d.srcEl))) continue;
    // 다른 브랜치 끝 커밋과 그 이름표는 같은 조작이라 이름표 하나만 남긴다
    const key = (actions ? actions.map((a) => a.verb).join("|") : "lazy") + (tgt.kind === "commit" ? branchesAt(s, tgt.id!).join() : tgt.branch || tgt.kind);
    if (tgt.kind === "commit" && d.src.kind === "commit" && seen.has(key)) continue;
    seen.add(key);
    let rect: { left: number; top: number; width: number; height: number } = el.getBoundingClientRect();
    if (tgt.kind === "canvas") rect = { left: rect.left + 16, top: rect.top + rect.height - 56, width: 10, height: 10 };
    const pill = document.createElement("div");
    pill.className = `v2-pill k-${tgt.kind}`;
    const first = actions ? actions[0].verb : quickLabelVerb(d.src, tgt.id!, s);
    pill.innerHTML = `<span class="v">${esc(tgt.kind === "canvas" ? "빈 곳에 놓기: " + first : first)}</span>${actions && actions.length > 1 ? `<span class="more">외 ${actions.length - 1}</span>` : ""}`;
    layer.appendChild(pill);
    const pw = pill.offsetWidth, ph = pill.offsetHeight;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const x = tgt.kind === "canvas" ? rect.left : cx - pw / 2;
    const y = PANEL.has(tgt.kind) ? cy - ph / 2 : tgt.kind === "commit" ? rect.top - ph - 4 : cy - ph / 2;
    pill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    placed.push({ tgt, actions, el, pill, hit: PANEL.has(tgt.kind) ? rect : { left: x, top: y, width: pw, height: ph } });
  }
  document.body.classList.add("v2-dragging");
  if (!placed.length) toast("이 항목을 놓을 수 있는 곳이 없습니다.");
}

function distToRect(x: number, y: number, r: Placed["hit"]): number {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

function move(e: PointerEvent): void {
  let best: Placed | null = null, bestD = SNAP_PX;
  for (const t of placed) {
    const dist = distToRect(e.clientX, e.clientY, t.hit);
    if (dist < bestD || (dist === 0 && best && !PANEL.has(t.tgt.kind))) { best = t; bestD = dist; }
  }
  // lazy 라벨: 처음 닿을 때 조작을 계산한다. 할 수 있는 게 없으면 그 라벨은 끈다
  if (best && !best.actions) {
    best.actions = actionsFor(drag!.src, best.tgt);
    const v = best.pill.querySelector(".v")!;
    if (!best.actions.length) {
      best.pill.classList.add("none");
      v.textContent = "놓을 수 없음";
      best.hit = { left: -1e6, top: -1e6, width: 0, height: 0 };
      best = null;
    } else {
      v.textContent = best.actions[0].verb;
      if (best.actions.length > 1) best.pill.insertAdjacentHTML("beforeend", `<span class="more">외 ${best.actions.length - 1}</span>`);
    }
  }
  if (best !== hover) {
    hover?.pill.classList.remove("on");
    hover?.el.classList.remove("drop-hover");
    hover = best;
    if (best) {
      best.pill.classList.add("on");
      best.el.classList.add("drop-hover");
      showInCanvas(best.actions![0].res);
    } else hideInCanvas();
  }
  const tip = byId("tip");
  if (best) {
    tip.innerHTML = tipHtml(best.actions![0].res, best.actions!.length);
    tip.style.left = e.clientX + "px";
    tip.style.top = e.clientY + "px";
    tip.classList.remove("hidden");
  } else tip.classList.add("hidden");
}

function cleanup(): void {
  byId("v2-layer").innerHTML = "";
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  document.body.classList.remove("v2-dragging", "dragging");
  byId("ghost").classList.add("hidden");
  byId("tip").classList.add("hidden");
  placed = [];
  hover = null;
}

function drop(e: PointerEvent): void {
  const src = drag!.src;
  const hit = hover;
  drag = null;
  cleanup();
  if (!hit || !hit.actions) { hideInCanvas(); return; }
  if (hit.actions.length === 1) {
    hideInCanvas();
    void performAction(src, hit.actions[0]);
    return;
  }
  openMenu(e.clientX, e.clientY, `${sourceLabel(src)} → ${hit.tgt.name || hit.tgt.branch || ""}`,
    hit.actions.map((a) => actionMenuItem(src, a)), hideInCanvas);
}

/** 조작 → 메뉴 항목 (드롭 메뉴·오른쪽 클릭 메뉴 공용) */
export function actionMenuItem(src: DragSource, a: Action, label = a.verb) {
  const locked = touchesPushed(store.repo, a.res);
  return {
    label,
    cmd: a.res.cmd,
    warn: [a.res.conflicts.length ? "충돌 예상" : "", locked ? "공유된 히스토리 재작성" : ""].filter(Boolean).join(" · ") || undefined,
    onHover: () => showInCanvas(a.res),
    onPick: () => void performAction(src, a),
  };
}

/** 고른 조작 실행: 필요한 입력(커밋 메시지·브랜치 이름)을 받아 인자를 완성한 뒤 실행 */
export async function performAction(src: DragSource, a: Action): Promise<void> {
  const s = store.repo;
  const input: { msg?: string; name?: string } = {};
  if (a.needs === "msg") {
    const box = byId<HTMLTextAreaElement>("commit-msg");
    const typed = box.value.trim();
    if (a.op === "stashPush") input.msg = typed || undefined;
    else {
      const first = src.kind === "file" ? [...s.working.staged, ...s.working.unstaged].find((f) => under(f, src.file!)) : s.working.staged[0] || s.working.unstaged[0];
      const msg = typed || (await askText("커밋 메시지", "update " + (first || "").split("/").pop(), "메시지 칸에 미리 적어 두면 묻지 않습니다."));
      if (msg === null) return;
      input.msg = msg || "새 커밋";
      box.value = "";
    }
  } else if (a.needs === "name") {
    const name = await askText("새 브랜치 이름", "feat/new");
    if (!name) return;
    input.name = name;
  }
  const args = a.build(input);
  const res = a.needs ? preview(a.op, s, args) : a.res;
  if (isError(res)) { toast(res.error); return; }
  store.update({ selected: null });
  await runPreviewed(a.op, args, res);
}

/** 여러 개 고른 커밋 중 하나를 끌거나 오른쪽 클릭하면 고른 것 전부를 대상으로 */
export function withSelection(src: DragSource): DragSource {
  const multi = store.ui.multi;
  if (src.kind !== "commit" || !src.id || multi.length < 2 || !multi.includes(src.id)) return src;
  return { ...src, ids: oldestFirst(store.repo, multi) };
}

/** 커밋 클릭: ⌘/Ctrl 은 하나씩 더하고 빼기, Shift 는 같은 줄기에서 범위, 그냥 클릭은 하나만 */
function clickCommit(id: string, e: PointerEvent): void {
  const ui = store.ui;
  if (e.metaKey || e.ctrlKey) {
    const base = ui.multi.length ? ui.multi : ui.selected ? [ui.selected] : [];
    const multi = toggleIn(base, id);
    store.update({ multi, selected: multi.includes(id) ? id : multi[multi.length - 1] ?? null, selectedFile: null });
    return;
  }
  if (e.shiftKey && ui.selected) {
    const range = rangeOnStem(store.repo, ui.selected, id);
    if (!range) { toast("범위 선택은 같은 브랜치(줄기) 안에서만 됩니다. 다른 브랜치의 커밋은 ⌘ 클릭으로 더하세요."); return; }
    store.update({ multi: range, selectedFile: null });
    return;
  }
  store.update({ selected: id, multi: [], selectedFile: null });
}

// ---------- 포인터 · 키보드 ----------
export function mountDrag(onCommitDoubleClick: (id: string) => void = focusMessageInput): void {
  setRefreshGuard(isDragging);

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("input, textarea, select, button, .chev, dialog")) return; // 입력 요소는 드래그로 취급하지 않음
    const el = target.closest<HTMLElement>("[data-drag]");
    if (!el) return;
    const src = withSelection(sourceFromElement(el));
    if (src.kind === "working" && !store.repo.working.staged.length && !store.repo.working.unstaged.length) { toast("커밋할 변경이 없습니다."); return; }
    drag = { src, srcEl: el, startX: e.clientX, startY: e.clientY, active: false };
    e.preventDefault();
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START_PX) return;
      if (blocked()) { drag = null; return; }
      drag.active = true;
      document.body.classList.add("dragging");
      const ghost = byId("ghost");
      ghost.textContent = sourceLabel(drag.src);
      ghost.classList.remove("hidden");
      begin(drag);
    }
    const ghost = byId("ghost");
    ghost.style.left = e.clientX + "px";
    ghost.style.top = e.clientY + "px";
    move(e);
  });

  document.addEventListener("pointerup", (e) => {
    if (!drag) return;
    if (drag.active) { drop(e); return; }
    const d = drag;
    drag = null;
    if (d.src.kind !== "commit" || !d.src.id) return;
    // 클릭으로 다시 그리면 브라우저의 dblclick 이벤트가 사라지므로, 더블클릭은 직접 판정한다
    const now = Date.now();
    const dbl = lastClick.id === d.src.id && now - lastClick.t < DOUBLE_CLICK_MS;
    lastClick = { id: d.src.id, t: now };
    if (dbl && !e.metaKey && !e.ctrlKey && !e.shiftKey) onCommitDoubleClick(d.src.id);
    else clickCommit(d.src.id, e);
  });

  document.addEventListener("keydown", (e) => {
    if (menuKey(e)) return;
    if (!drag && e.key === "Escape" && store.ui.multi.length && !(e.target as Element).closest?.("input, textarea, dialog")) {
      store.update({ multi: [] });
      return;
    }
    if (drag?.active && e.key === "Escape") {
      drag = null;
      cleanup();
      hideInCanvas();
      closeMenu();
    }
  });
}
