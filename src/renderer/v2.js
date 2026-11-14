// v2.js — v2 드래그 UX
//  1) 드래그를 시작하면 놓을 수 있는 모든 곳에 "동사 라벨"이 뜬다 (문법을 외울 필요 없음)
//  2) 조작이 여러 개인 곳에 놓으면 메뉴로 고른다 (수정키 대신)
//  3) 이름표를 끌면 커밋까지 함께 이동(rebase)이 기본, 줄기 핸들은 없음
//  4) 결과가 본 캔버스 위에 겹쳐 보인다
//  5) 오른쪽 클릭(또는 Shift+F10)으로 같은 조작을 드래그 없이 고를 수 있다 (WCAG 2.2 Dragging Movements)

let uiMode = (() => { try { return localStorage.getItem("ygg-ui") || "v2"; } catch { return "v2"; } })();

function setMode(m) {
  uiMode = m;
  try { localStorage.setItem("ygg-ui", m); } catch {}
  document.body.classList.toggle("v2", m === "v2");
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  closeMenu();
  render();
}

const branchesAt = (id) => Object.keys(state.branches).filter((b) => state.branches[b] === id);

// ---------- (끄는 것, 놓는 곳) → 가능한 조작 목록 ----------
function actionsFor(src, tgt) {
  const s = state;
  if (s.op) return [];
  const out = [];
  const add = (verb, make) => {
    // 조작 하나가 실패해도 다른 놓을 곳 라벨은 계속 뜨도록 격리한다
    let res;
    try { res = make({}); } catch (err) { console.error(`[v2] "${verb}" 계산 실패`, err); return; }
    if (res && !res.error) out.push({ verb, res, make });
  };

  if (src.kind === "commit") {
    const id = src.id, own = ownerBranch(s, id);
    let target = tgt;
    // 다른 브랜치의 끝 커밋 = 그 브랜치 이름표와 같다
    if (tgt.kind === "commit" && ownerBranch(s, tgt.id) !== own) {
      const b = branchesAt(tgt.id).find((x) => x !== own);
      if (!b) return [];
      target = { kind: "label", branch: b };
    }
    if (target.kind === "label") {
      const b = target.branch;
      if (b === own) return [];
      add(`${b} 브랜치로 옮기기`, () => Ops.moveCommit(s, id, b));
      add(`${b} 브랜치에 복사`, () => Ops.cherryPick(s, [id], b));
      // "이 작업을 저쪽에 합치고 싶다"는 생각으로 커밋을 끄는 경우: 커밋이 속한 브랜치 전체 merge
      if (own && own !== b) add(`${own} 브랜치 전체를 ${b}에 합치기`, () => Ops.merge(s, own, b));
    } else if (target.kind === "commit") {
      if (target.id !== id && own) add("이 커밋에 합치기", () => Ops.squash(s, id, target.id));
    } else if (target.kind === "gap") {
      add("여기로 순서 옮기기", () => Ops.reorder(s, id, target.branch, +target.index));
    } else if (target.kind === "working") {
      const parent = s.commits[id].parents[0];
      if (parent && isAncestor(s, id, s.branches[s.head])) {
        add("커밋 취소, 변경은 작업 영역으로", () => Ops.resetHead(s, parent, "mixed"));
        add("커밋 취소, 변경은 Staged로", () => Ops.resetHead(s, parent, "soft"));
      }
    } else if (target.kind === "trash") {
      const pushed = pushedSet(s).has(id);
      add(pushed ? "되돌림 커밋 만들기" : "커밋 제거", () => (pushed ? Ops.revertCommit(s, id) : Ops.dropCommit(s, id)));
    } else if (target.kind === "canvas") {
      add("여기서 새 브랜치", (i) => Ops.createBranch(s, i.name || "new-branch", id));
    }
  } else if (src.kind === "label") {
    const b = src.branch;
    if (tgt.kind === "label" && tgt.branch !== b) {
      const t = tgt.branch;
      add(`${t} 위로 올리기`, () => Ops.rebaseStem(s, b, s.branches[t]));
      add(`${t} 브랜치에 합치기`, () => Ops.merge(s, b, t));
      add(`${t} 위치로 포인터만 옮기기`, () => Ops.moveBranch(s, b, s.branches[t]));
    } else if (tgt.kind === "commit") {
      const x = tgt.id;
      if (b === s.head && x !== s.branches[b] && isAncestor(s, x, s.branches[b])) {
        add("여기로 되돌리기, 변경은 작업 영역으로", () => Ops.resetHead(s, x, "mixed"));
        add("여기로 되돌리기, 변경은 Staged로", () => Ops.resetHead(s, x, "soft"));
        add("여기로 되돌리기, 변경 버림", () => Ops.resetHead(s, x, "hard"));
      } else {
        add("이 커밋 위로 올리기", () => Ops.rebaseStem(s, b, x));
        add("포인터만 옮기기", () => Ops.moveBranch(s, b, x));
      }
    } else if (tgt.kind === "remote") add("push", () => Ops.push(s, b));
    else if (tgt.kind === "trash") add("브랜치 삭제", () => Ops.deleteBranch(s, b));
  } else if (src.kind === "working" || src.kind === "file") {
    const paths = src.kind === "file" ? [src.file] : undefined;
    const msgOf = (i) => i.msg || "새 커밋";
    if (tgt.kind === "label") {
      add(src.kind === "file" ? "이 경로만 커밋" : "여기에 커밋", (i) => Ops.commitTo(s, tgt.branch, msgOf(i), paths));
    } else if (tgt.kind === "commit") {
      if (ownerBranch(s, tgt.id) === s.head) add("이 커밋에 합치기", (i) => Ops.amendInto(s, tgt.id, msgOf(i), paths));
      else {
        const b = branchesAt(tgt.id)[0];
        if (b) add("여기에 커밋", (i) => Ops.commitTo(s, b, msgOf(i), paths));
      }
    } else if (tgt.kind === "trash") add("변경 버리기", () => Ops.discard(s, paths || [""]));
    else if (tgt.kind === "stash" && src.kind === "working") add("stash에 보관", (i) => Ops.stashPush(s, i.msg));
  } else if (src.kind === "stash") {
    const i = +src.stash;
    if (tgt.kind === "working") {
      add("stash 꺼내기", () => Ops.stashPop(s, i, false));
      add("적용만 하고 stash 유지", () => Ops.stashPop(s, i, true));
    } else if (tgt.kind === "trash") add("stash 삭제", () => Ops.stashDrop(s, i));
  } else if (src.kind === "remote") {
    if (tgt.kind === "label") {
      const t = tgt.branch, r = src.remote, own = r === "origin/" + t;
      add(own ? "pull (merge)" : "가져와 합치기", () => Ops.pull(s, t, "merge", r));
      add(own ? "pull (rebase)" : "가져와 그 위로 올리기", () => Ops.pull(s, t, "rebase", r));
    }
  }
  return out;
}

// 상태에서 후보 놓는 곳을 만든다 (DOM 과 무관 — 오른쪽 클릭 메뉴도 이걸 쓴다)
function candidateTargets(src) {
  const s = state;
  const t = [];
  Object.keys(s.branches).forEach((b) => t.push({ kind: "label", branch: b, name: b }));
  if (src.kind === "commit") {
    const own = ownerBranch(s, src.id);
    if (own) {
      stems(s).stems[own].ids.forEach((c) => c !== src.id && t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
      stems(s).stems[own].ids.forEach((_, i, arr) => t.push({ kind: "gap", branch: own, index: i, name: `${i + 1}번째 자리` }));
      t.push({ kind: "gap", branch: own, index: stems(s).stems[own].ids.length, name: "맨 끝" });
    }
    t.push({ kind: "canvas", name: "빈 곳" });
  }
  if (src.kind === "label") {
    // 이름표는 아무 커밋에나 놓을 수 있다
    Object.keys(s.commits).forEach((c) => stems(s).owner.has(c) && t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
  }
  if (src.kind === "working" || src.kind === "file") {
    stems(s).stems[s.head]?.ids.forEach((c) => t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
  }
  t.push({ kind: "working", name: "작업 영역" }, { kind: "trash", name: "휴지통" }, { kind: "stash", name: "stash" }, { kind: "remote", name: "origin" });
  return t;
}

function targetSelector(tgt) {
  const q = (v) => CSS.escape(String(v));
  return {
    label: `#graph .ref.local[data-branch="${q(tgt.branch)}"]`,
    commit: `#graph .node[data-id="${q(tgt.id)}"]`,
    gap: `#graph .gap[data-branch="${q(tgt.branch)}"][data-index="${tgt.index}"]`,
    working: ".working-card",
    trash: ".trash",
    stash: ".stash-tray",
    remote: "#graph .remote-band",
    canvas: "#canvas-wrap",
  }[tgt.kind];
}

// ---------- 드래그 중 ----------
const PANEL = new Set(["working", "trash", "stash", "remote"]);
let v2 = null; // { targets:[{tgt, actions, el, rect, pill}], hover }

function v2Begin() {
  const src = drag.src;
  const layer = $("v2-layer");
  layer.innerHTML = "";
  const targets = [];
  const seen = new Set();
  for (const tgt of candidateTargets(src)) {
    if (tgt.kind === "label" && src.kind === "label" && tgt.branch === src.branch) continue;
    const actions = actionsFor(src, tgt);
    if (!actions.length) continue;
    const el = document.querySelector(targetSelector(tgt));
    if (!el || el === drag.srcEl || (tgt.kind !== "canvas" && el.contains(drag.srcEl))) continue;
    // 다른 브랜치 끝 커밋과 그 이름표는 같은 조작이라 이름표 하나만 남긴다
    const key = actions.map((a) => a.verb).join("|") + (tgt.kind === "commit" ? branchesAt(tgt.id).join() : tgt.branch || tgt.kind);
    if (tgt.kind === "commit" && src.kind === "commit" && seen.has(key)) continue;
    seen.add(key);
    let rect = el.getBoundingClientRect();
    if (tgt.kind === "canvas") rect = { left: rect.left + 16, top: rect.bottom - 56, width: 10, height: 10 };
    const pill = document.createElement("div");
    pill.className = `v2-pill k-${tgt.kind}`;
    pill.innerHTML = `<span class="v">${esc(tgt.kind === "canvas" ? "빈 곳에 놓기: " + actions[0].verb : actions[0].verb)}</span>${actions.length > 1 ? `<span class="more">외 ${actions.length - 1}</span>` : ""}`;
    layer.appendChild(pill);
    const pw = pill.offsetWidth, ph = pill.offsetHeight;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const x = tgt.kind === "canvas" ? rect.left : cx - pw / 2;
    const y = PANEL.has(tgt.kind) ? cy - ph / 2 : tgt.kind === "commit" ? rect.top - ph - 4 : cy - ph / 2;
    pill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const hit = PANEL.has(tgt.kind) ? rect : { left: x, top: y, width: pw, height: ph };
    targets.push({ tgt, actions, el, hit, pill });
  }
  v2 = { targets, hover: null };
  document.body.classList.add("v2-dragging");
  if (!targets.length) toast("이 항목을 놓을 수 있는 곳이 없습니다.");
}

function distToRect(x, y, r) {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

function v2Move(e) {
  if (!v2) v2Begin();
  // 자석: 28px 안에서 가장 가까운 라벨에 붙는다
  let best = null, bestD = 28;
  for (const t of v2.targets) {
    const d = distToRect(e.clientX, e.clientY, t.hit);
    if (d < bestD || (d === 0 && best && !PANEL.has(t.tgt.kind))) { best = t; bestD = d; }
  }
  if (best !== v2.hover) {
    v2.hover?.pill.classList.remove("on");
    v2.hover?.el.classList.remove("drop-hover");
    v2.hover = best;
    if (best) {
      best.pill.classList.add("on");
      best.el.classList.add("drop-hover");
      showInCanvas(best.actions[0].res);
    } else hideInCanvas();
  }
  const tip = $("tip");
  if (best) {
    tip.innerHTML = tipHtml(best.actions[0].res, best.actions.length);
    tip.style.left = e.clientX + "px";
    tip.style.top = e.clientY + "px";
    tip.classList.remove("hidden");
  } else tip.classList.add("hidden");
}

function tipHtml(res, n = 1) {
  const locked = touchesPushed(state, res);
  return `<div class="sum">${esc(res.summary)}</div><code>${esc(res.cmd)}</code>
    ${res.state.op ? `<div class="warn">충돌: ${res.state.op.conflicts.map(esc).join(", ")} — 놓으면 멈추고 해결 모드로 들어갑니다</div>`
      : res.conflicts.length ? `<div class="warn">충돌 예상: ${res.conflicts.map(esc).join(", ")}</div>` : ""}
    ${locked ? `<div class="lock">push 된 히스토리를 다시 씁니다 — 실행 전에 확인합니다</div>` : ""}
    ${n > 1 ? `<div class="hint">놓으면 ${n}가지 중에서 고릅니다</div>` : ""}`;
}

// 결과를 본 캔버스 위에 겹쳐 보여 준다 (지금 그래프는 흐리게)
function showInCanvas(res) {
  const oldIds = new Set(Object.keys(state.commits));
  const newIds = new Set(Object.keys(res.state.commits).filter((c) => !oldIds.has(c)));
  const r = renderGraph(res.state, { newIds, minWidth: $("canvas-wrap").clientWidth });
  const svg = $("ghost-graph");
  svg.setAttribute("width", r.width);
  svg.setAttribute("height", r.height);
  svg.innerHTML = r.svg;
  $("canvas-wrap").classList.add("previewing");
}
function hideInCanvas() {
  $("canvas-wrap").classList.remove("previewing");
  $("ghost-graph").innerHTML = "";
}

function v2Cleanup() {
  $("v2-layer").innerHTML = "";
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  document.body.classList.remove("v2-dragging", "dragging", "drag-commit");
  $("ghost").classList.add("hidden");
  $("tip").classList.add("hidden");
  v2 = null;
}

function v2Drop(e) {
  const src = drag.src;
  const hit = v2?.hover;
  drag = null;
  v2Cleanup();
  if (!hit) { hideInCanvas(); return; }
  if (hit.actions.length === 1) { hideInCanvas(); return runAction(src, hit.tgt, hit.actions[0]); }
  openMenu(e.clientX, e.clientY, `${srcLabel(src)} → ${hit.tgt.name || hit.tgt.branch || ""}`,
    hit.actions.map((a) => ({ ...a, src, tgt: hit.tgt })));
}

function runAction(src, tgt, a) {
  if (touchesPushed(state, a.res) && !confirm(`${a.res.summary}\n\npush 된 히스토리를 다시 씁니다. 이후 force push 가 필요합니다. 계속할까요?`)) return;
  finishDrop(src, tgt, a.res, a.make);
}

// ---------- 메뉴 (드롭 메뉴 · 오른쪽 클릭 메뉴 공용) ----------
function openMenu(x, y, title, items) {
  closeMenu();
  const m = $("v2-menu");
  m.innerHTML = `<div class="m-title">${esc(title)}</div>` + items.map((a, i) => {
    const locked = touchesPushed(state, a.res);
    const warn = a.res.state.op ? "충돌로 멈춤" : a.res.conflicts.length ? "충돌 예상" : "";
    return `<button type="button" role="menuitem" data-i="${i}">
      <span class="m-verb">${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}${esc(a.label || a.verb)}</span>
      <span class="m-cmd">${esc(a.res.cmd.split("\n")[0])}</span>
      ${warn || locked ? `<span class="m-warn">${[warn, locked ? "공유된 히스토리 재작성" : ""].filter(Boolean).join(" · ")}</span>` : ""}
    </button>`;
  }).join("") + `<button type="button" role="menuitem" class="m-cancel" data-i="-1">취소 <kbd>Esc</kbd></button>`;
  m.classList.remove("hidden");
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.transform = `translate(${Math.round(Math.min(x, innerWidth - w - 8))}px, ${Math.round(Math.min(y, innerHeight - h - 8))}px)`;
  m._items = items;
  const btns = [...m.querySelectorAll("button")];
  btns.forEach((b) => {
    b.onmouseenter = b.onfocus = () => { const it = items[+b.dataset.i]; it ? showInCanvas(it.res) : hideInCanvas(); };
    b.onclick = () => pickMenu(+b.dataset.i);
  });
  btns[0].focus();
}
function pickMenu(i) {
  const items = $("v2-menu")._items;
  closeMenu();
  if (i < 0 || !items || !items[i]) return;
  const a = items[i];
  if (a.custom) return a.custom(); // 실행이 git 조작이 아닌 항목 (예: GitHub PR 만들기)
  runAction(a.src, a.tgt, a);
}
function closeMenu() {
  const m = $("v2-menu");
  if (!m || m.classList.contains("hidden")) return;
  m.classList.add("hidden");
  m._items = null;
  hideInCanvas();
}
const menuOpen = () => !$("v2-menu").classList.contains("hidden");

// app.js 의 keydown/keyup 에서 먼저 불린다. 처리했으면 true.
function v2Key(e, type) {
  if (menuOpen()) {
    if (type !== "keydown") return true;
    const btns = [...$("v2-menu").querySelectorAll("button")];
    const cur = btns.indexOf(document.activeElement);
    if (e.key === "Escape") closeMenu();
    else if (e.key === "ArrowDown") btns[(cur + 1) % btns.length].focus();
    else if (e.key === "ArrowUp") btns[(cur - 1 + btns.length) % btns.length].focus();
    else if (/^[1-9]$/.test(e.key)) pickMenu(+e.key - 1);
    else return false; // Enter 는 버튼 기본 동작
    e.preventDefault();
    return true;
  }
  if (drag && drag.active) {
    if (e.key === "Escape") { drag = null; v2Cleanup(); hideInCanvas(); }
    return true; // v2 에서는 수정키가 의미를 바꾸지 않는다
  }
  return false;
}

// ---------- 오른쪽 클릭: 드래그 없이 같은 조작 고르기 ----------
function srcFromEl(el) {
  const d = el.dataset;
  return { kind: d.drag, id: d.id, branch: d.branch, file: d.file, stash: d.stash, remote: d.remote };
}
function contextItems(src) {
  const items = [];
  for (const tgt of candidateTargets(src)) {
    if (tgt.kind === "label" && src.kind === "label" && tgt.branch === src.branch) continue;
    if (tgt.kind === "canvas") continue;
    for (const a of actionsFor(src, tgt)) {
      const named = a.verb.includes(tgt.name || "\u0000") || ["working", "trash", "stash", "remote"].includes(tgt.kind);
      const label = named ? a.verb : `${a.verb} — ${tgt.name}`;
      if (!items.some((x) => x.res.cmd === a.res.cmd && x.label === label)) items.push({ ...a, label, src, tgt });
    }
  }
  if (src.kind === "commit") {
    items.push({ label: "여기서 새 브랜치…", verb: "여기서 새 브랜치", src, tgt: { kind: "canvas" },
      res: Ops.createBranch(state, "new-branch", src.id), make: (i) => Ops.createBranch(state, i.name || "new-branch", src.id) });
  }
  return items.filter((a) => a.res && !a.res.error);
}
document.addEventListener("contextmenu", (e) => {
  if (uiMode !== "v2") return;
  const el = e.target.closest("[data-drag]");
  if (!el || el.dataset.drag === "stem") return;
  e.preventDefault();
  if (blocked()) return;
  const src = srcFromEl(el);
  if (src.kind === "working" && !state.working.staged.length && !state.working.unstaged.length) return toast("변경이 없습니다.");
  const items = contextItems(src);
  if (!items.length) return toast("이 항목으로 할 수 있는 조작이 없습니다.");
  openMenu(e.clientX, e.clientY, srcLabel(src), items);
});
document.addEventListener("pointerdown", (e) => {
  if (menuOpen() && !e.target.closest("#v2-menu")) closeMenu();
}, true);
