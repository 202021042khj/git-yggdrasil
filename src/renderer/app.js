// app.js — 화면 갱신, 드래그앤드롭 문법, 미리보기, undo
let state = initialState();
let past = [], future = [];
let log = [];
let selected = null;
const $ = (id) => document.getElementById(id);

// ---------- 상태 변경 ----------
function apply(next, entry) {
  past.push({ state, log: log.slice() });
  future = [];
  state = next;
  if (entry) log.push(entry);
  render();
}
function undo() {
  if (!past.length) return toast("되돌릴 작업이 없습니다.");
  future.push({ state, log: log.slice() });
  ({ state, log } = past.pop());
  render();
  toast("↶ 되돌렸습니다");
}
function redo() {
  if (!future.length) return;
  past.push({ state, log: log.slice() });
  ({ state, log } = future.pop());
  render();
}

// ---------- 렌더링 ----------
function render() {
  const wrap = $("canvas-wrap");
  const r = renderGraph(state, { interactive: true, selected, minWidth: wrap.clientWidth });
  const svg = $("graph");
  svg.setAttribute("width", r.width);
  svg.setAttribute("height", Math.max(r.height, wrap.clientHeight - 4));
  svg.innerHTML = r.svg;
  if (selected && !state.commits[selected]) selected = null;
  renderBanner();
  renderTree();
  renderWorking();
  renderDetail();
  renderLog();
}

// 브랜치와 그 upstream(origin/<브랜치>) 사이의 앞섬/뒤처짐
function syncInfo(s, b) {
  const rem = s.remotes["origin/" + b];
  if (!rem) return { remote: null, ahead: 0, behind: 0 };
  const a = ancestors(s, s.branches[b]), r = ancestors(s, rem);
  return { remote: rem, ahead: [...a].filter((c) => !r.has(c)).length, behind: [...r].filter((c) => !a.has(c)).length };
}

// 상단 Pull / Push: 현재 브랜치 기준. 받을 것·보낼 것이 있을 때만 강조
function renderSync() {
  const b = state.head, { remote, ahead, behind } = syncInfo(state, b);
  const pull = $("tb-pull"), push = $("tb-push");
  const mode = $("pull-mode").value;
  pull.innerHTML = `<span class="n">↓${behind}</span>Pull`;
  pull.disabled = !remote || !behind || !!state.op;
  pull.classList.toggle("hot", !!behind);
  pull.title = !remote ? `${b} 는 아직 원격에 없습니다` : behind ? `origin/${b} 의 커밋 ${behind}개를 받습니다 (${mode})` : "받을 커밋이 없습니다";
  const publish = !remote;
  push.innerHTML = publish ? "Publish" : `<span class="n">↑${ahead}</span>Push`;
  push.disabled = (!publish && !ahead) || !!state.op;
  push.classList.toggle("hot", publish || (!!ahead && !behind));
  push.title = publish ? `${b} 를 원격에 처음 올립니다` : ahead && behind ? "원격과 갈라졌습니다. 먼저 Pull 하거나, push 하면 덮어씁니다(확인 후)" : ahead ? `커밋 ${ahead}개를 보냅니다` : "보낼 커밋이 없습니다";
}

function renderTree() {
  renderSync();
  const L = layout(state);
  const colorOf = (b) => L.lanes.find((l) => l.name === b)?.color || "var(--lane-remote)";
  const rows = branchOrder(state).map((b) => {
    const rem = state.remotes["origin/" + b];
    let badge = rem ? "" : "로컬";
    if (rem) {
      const a = ancestors(state, state.branches[b]), r = ancestors(state, rem);
      const ahead = [...a].filter((c) => !r.has(c)).length, behind = [...r].filter((c) => !a.has(c)).length;
      badge = ahead && behind ? `⚠ ↑${ahead} ↓${behind}` : ahead ? `↑${ahead}` : behind ? `↓${behind}` : "✓";
      if (behind) badge = `<span class="badge pull" data-pull="${esc(b)}" title="클릭: pull (${$("pull-mode").value})">${badge} pull</span>`;
      else badge = `<span class="badge">${badge}</span>`;
    } else badge = `<span class="badge">${badge}</span>`;
    return `<div class="br ${b === state.head ? "head" : ""}" data-checkout="${esc(b)}" title="더블클릭: checkout">
      <span class="dot" style="background:${colorOf(b)}"></span>${b === state.head ? "◉ " : ""}${esc(b)}${badge}</div>`;
  });
  $("repo-tree").innerHTML = `<div class="tree"><div class="repo"><svg class="i" aria-hidden="true"><use href="#i-folder"/></svg>${esc(state.repoName || "demo-app")}</div>${rows.join("")}</div>`;
}

// ---------- 진행 중 작업 (충돌) ----------
function renderBanner() {
  const o = state.op, b = $("op-banner");
  if (!o) { b.classList.add("hidden"); return; }
  const seq = o.kind === "rebase" || o.kind === "cherry-pick";
  const done = o.conflicts.filter((f) => o.resolved[f]).length;
  const all = done === o.conflicts.length;
  b.classList.remove("hidden");
  b.innerHTML = `
    <span class="ob-title">⏸ ${esc(o.title)} — 충돌로 멈춤</span>
    ${seq ? `<span class="ob-step">커밋 ${o.step + 1}/${o.total} "${esc(o.current.msg)}" 적용 중</span>` : ""}
    <span>충돌 파일 ${done}/${o.conflicts.length} 해결</span>
    <span class="spacer"></span>
    <button class="primary" data-op="continue" ${all ? "" : "disabled"} title="${OP_CMD[o.kind]} --continue">▶ 계속</button>
    ${seq ? `<button data-op="skip" title="${OP_CMD[o.kind]} --skip">이 커밋 건너뛰기</button>` : ""}
    <button class="danger" data-op="abort" title="${OP_CMD[o.kind]} --abort">✕ 중단 (시작 전으로)</button>`;
}

function conflictMarkers(path) {
  const o = state.op;
  const pick = (seed) => fakeDiff(path, seed).filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  const ours = pick("ours" + o.oursName), theirs = pick("theirs" + o.theirsName);
  const ctx = fakeDiff(path, "ctx").filter((l) => l.startsWith(" ")).slice(0, 1).map((l) => l.slice(1));
  const line = (cls, t) => `<span class="${cls}">${esc(t)}</span>`;
  return `<div class="diff markers"><div class="dh">${esc(path)} — 충돌 표시</div><pre>${[
    ...ctx.map((t) => line("ctx", t)),
    line("mk", `<<<<<<< ${o.oursName}`), ...ours.map((t) => line("ours", t)),
    line("mk", "======="), ...theirs.map((t) => line("theirs", t)),
    line("mk", `>>>>>>> ${o.theirsName}`),
  ].join("")}</pre></div>`;
}

function conflictBoxHtml() {
  const o = state.op;
  const focus = selectedFile && o.conflicts.includes(selectedFile.path) ? selectedFile.path : o.conflicts.find((f) => !o.resolved[f]) || o.conflicts[0];
  const btn = (f, choice, text) => `<button data-resolve="${esc(f)}" data-choice="${choice}" class="${o.resolved[f] === choice ? "on" : ""}">${text}</button>`;
  const rebaseNote = o.kind === "rebase"
    ? `<div class="cf-side">※ rebase 중에는 git 의 <code>--ours</code> 가 <b>대상(받는 쪽)</b>, <code>--theirs</code> 가 <b>내 커밋</b>입니다. 버튼은 의미대로 표시했습니다.</div>` : "";
  return `<div class="conflict-box"><h4>⚠ 충돌 해결 — 파일마다 어느 쪽을 쓸지 고르세요</h4>
    <div class="cf-side">A = ${esc(o.oursName)}<br>B = ${esc(o.theirsName)}</div>${rebaseNote}
    ${o.conflicts.map((f) => `<div class="cf-file">
      <span class="cf-name ${o.resolved[f] ? "done" : ""}" data-cf="${esc(f)}">${o.resolved[f] ? "✓" : "⚠"} ${esc(f)}</span>
      <div class="cf-actions">${btn(f, "ours", "A 쪽 사용")}${btn(f, "theirs", "B 쪽 사용")}${btn(f, "both", "둘 다 (직접 편집)")}</div></div>`).join("")}
    ${conflictMarkers(focus)}</div>`;
}

function renderStash() {
  $("stash-list").innerHTML = state.stash.map((st, i) =>
    `<div class="stash-card" data-drag="stash" data-stash="${i}" title="작업 영역으로 끌면 pop · ⌥ apply · 🗑 삭제\n${esc([...st.staged, ...st.unstaged].join("\n"))}">
      stash@{${i}} · ${esc(st.msg)} · ${st.staged.length + st.unstaged.length}개</div>`).join("")
    || `<span class="muted">비어 있음 — 변경 묶음을 여기로 끌면 stash</span>`;
}

// 목업용 가짜 diff: 경로와 seed 로 매번 같은 내용을 만든다
function fakeDiff(path, seed = "") {
  let h = 0;
  for (const ch of path + seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const name = path.split("/").pop().replace(/\..*$/, "");
  const ext = path.split(".").pop();
  const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
  const ln = 10 + (h % 60);
  if (ext === "md") return [`@@ -${ln},4 +${ln},5 @@`, " ## 사용법", "-npm run start 로 실행합니다.", `+npm run dev 로 실행합니다.`, `+${pick(["자세한 내용은 docs/ 를 참고하세요.", "Node 20 이상이 필요합니다."])}`, " "];
  if (ext === "css") return [`@@ -${ln},5 +${ln},5 @@`, ` .${name} {`, `-  color: ${pick(["#333", "#222", "black"])};`, `+  color: var(--text);`, `-  padding: ${pick(["4px", "6px"])};`, `+  padding: ${pick(["8px", "10px"])} 12px;`, " }"];
  if (ext === "yml") return [`@@ -${ln},3 +${ln},4 @@`, "   steps:", "-    - run: npm test", "+    - run: npm ci", "+    - run: npm test -- --coverage"];
  if (ext === "json") return [`@@ -${ln},3 +${ln},3 @@`, '   "dependencies": {', `-    "${pick(["react", "axios", "zod"])}": "^1.${h % 9}.0",`, `+    "${pick(["react", "axios", "zod"])}": "^1.${(h % 9) + 1}.0",`, "   }"];
  return [`@@ -${ln},6 +${ln},8 @@`, ` export function ${name}(${pick(["props", "options", "input"])}) {`,
    `-  const value = ${pick(["getValue()", "props.value", "null"])};`, `+  const value = ${pick(["useValue()", "props.value ?? ''", "parse(input)"])};`,
    `+  if (!value) return ${pick(["null", "undefined", "[]"])};`, `   return ${pick(["render(value)", "value", "format(value)"])};`, " }"];
}

function diffHtml(path, seed, title) {
  const lines = fakeDiff(path, seed).map((l) => {
    const cls = l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx";
    return `<span class="${cls}">${esc(l)}</span>`;
  });
  return `<div class="diff"><div class="dh">${esc(title)}</div><pre>${lines.join("")}</pre></div><div class="muted" style="font-size:11px">※ 목업용 가짜 diff</div>`;
}

// ---------- 작업 영역: VS Code 탐색기 같은 폴더 트리 ----------
const collapsed = new Set();
let onlyChanged = false;

function buildTree(paths) {
  const root = { name: state.repoName || "demo-app", path: "", kids: new Map(), file: false };
  for (const p of paths) {
    let node = root;
    p.split("/").forEach((part, i, arr) => {
      const path = arr.slice(0, i + 1).join("/");
      if (!node.kids.has(part)) node.kids.set(part, { name: part, path, kids: new Map(), file: i === arr.length - 1 });
      node = node.kids.get(part);
    });
  }
  return root;
}
const leafFiles = (n) => (n.file ? [n.path] : [...n.kids.values()].flatMap(leafFiles));

function renderWorking() {
  const w = state.working;
  const staged = new Set(w.staged), changed = new Set([...w.staged, ...w.unstaged]);
  const conflicted = new Set(w.conflicted || []);
  const resolved = state.op ? state.op.resolved : {};
  const committed = new Set(Object.values(state.commits).flatMap((c) => c.files));
  const root = buildTree([...new Set([...state.files, ...changed, ...conflicted])].sort());
  const rows = [];
  const walk = (n, depth) => {
    const files = leafFiles(n);
    const ch = files.filter((f) => changed.has(f)), st = files.filter((f) => staged.has(f));
    const cf = files.filter((f) => conflicted.has(f));
    if (onlyChanged && !ch.length && !cf.length && n.path !== "") return;
    const open = !collapsed.has(n.path);
    const chk = !ch.length ? "disabled" : st.length === ch.length ? "checked" : st.length ? "data-ind" : "";
    const isCf = n.file && conflicted.has(n.path);
    const badge = isCf
      ? `<span class="st ${resolved[n.path] ? "S" : "C"}">${resolved[n.path] ? "✓" : "C"}</span>`
      : n.file
      ? ch.length ? `<span class="st ${committed.has(n.path) ? "M" : "U"}">${committed.has(n.path) ? "M" : "U"}</span>` : ""
      : ch.length || cf.length ? `<span class="st">${cf.length ? `<span class="st C">⚠${cf.length}</span> ` : ""}${ch.length ? `${st.length ? `${st.length}/` : ""}${ch.length}` : ""}</span>` : "";
    const icon = `<svg class="i" aria-hidden="true"><use href="#i-${n.path === "" ? "box" : n.file ? "file" : "folder"}"/></svg>`;
    const active = selectedFile && !selectedFile.commit && selectedFile.path === n.path ? "active" : "";
    const cfCls = isCf ? (resolved[n.path] ? "conflict resolved" : "conflict") : "";
    rows.push(`<div class="ft-row ${n.file ? "file" : "folder"} ${ch.length || cf.length ? "" : "clean"} ${cfCls} ${active}" ${ch.length ? `data-drag="file" data-file="${esc(n.path)}"` : ""}
      data-path="${esc(n.path)}" data-isfile="${n.file ? 1 : ""}" style="padding-left:${depth * 12 + 4}px" title="${esc(n.path || "저장소 루트")}">
      <span class="chev" ${n.file ? "" : `data-toggle="${esc(n.path)}"`}>${n.file ? "" : open ? "▾" : "▸"}</span>
      <input type="checkbox" data-stage="${esc(n.path)}" ${chk} />
      <span class="name">${icon}${esc(n.name)}</span>${badge}
      ${ch.length ? `<button class="discard" data-discard="${esc(n.path)}" title="변경 버리기 (git restore)">↶</button>` : ""}</div>`);
    if (!n.file && open) {
      const kids = [...n.kids.values()].sort((a, b) => a.file - b.file || a.name.localeCompare(b.name));
      kids.forEach((k) => walk(k, depth + 1));
    }
  };
  walk(root, 0);
  $("file-tree").innerHTML = rows.join("");
  $("file-tree").querySelectorAll("input[data-ind]").forEach((i) => (i.indeterminate = true));
  $("work-summary").textContent = `변경 ${changed.size} · staged ${staged.size}`;
  const h = document.querySelector(".working-handle");
  h.classList.toggle("empty", !w.staged.length && !w.unstaged.length);
  h.textContent = w.staged.length ? `Staged ${w.staged.length}개 끌기`
    : w.unstaged.length ? `변경 ${w.unstaged.length}개 모두 끌기` : "변경 없음";
  const btn = $("commit-btn");
  btn.disabled = !changed.size;
  btn.textContent = !changed.size ? "커밋할 변경 없음"
    : `${state.head} 에 커밋 (${w.staged.length ? `staged ${w.staged.length}개` : `변경 전체 ${changed.size}개`})`;
  renderStash();
}

let selectedFile = null; // { path, commit: id | null }

function renderDetail() {
  renderDetailInner();
  if (!state.op) return;
  $("detail-body").insertAdjacentHTML("afterbegin", conflictBoxHtml());
  $("detail-body").querySelectorAll("[data-resolve]").forEach((el) => (el.onclick = () => {
    selectedFile = { path: el.dataset.resolve, commit: null };
    runOp(Ops.resolveFile(state, el.dataset.resolve, el.dataset.choice), null, true);
  }));
  $("detail-body").querySelectorAll("[data-cf]").forEach((el) => (el.onclick = () => {
    selectedFile = { path: el.dataset.cf, commit: null };
    renderDetail();
  }));
}

function renderDetailInner() {
  const c = selected && state.commits[selected];
  if (!c) {
    if (state.op) { $("detail-body").innerHTML = ""; return; }
    const f = selectedFile && !selectedFile.commit ? selectedFile.path : null;
    const w = state.working;
    $("detail-body").innerHTML = f && [...w.staged, ...w.unstaged].includes(f)
      ? `<div class="kv"><b>작업 영역 변경</b> · ${w.staged.includes(f) ? "Staged" : "Unstaged"}</div>${diffHtml(f, "wt" + state.head, f)}`
      : `<span class="muted">커밋이나 변경된 파일을 클릭하면 상세 정보와 diff 가 보입니다.</span>`;
    return;
  }
  const p = pushedSet(state).has(c.id);
  const br = stems(state).owner.get(c.id) || "(브랜치 없음)";
  $("detail-body").innerHTML = `
    <div class="reword">
      <input id="msg-input" value="${esc(c.msg)}" ${br === "(브랜치 없음)" || !state.branches[br] ? "disabled" : ""} />
      <button id="msg-save" class="small" title="Enter">메시지 수정</button>
    </div>
    ${p ? `<div class="kv lock-note">push 된 커밋 — 수정하면 force push 가 필요합니다</div>` : ""}
    <div class="kv"><code>${c.id}</code></div>
    <div class="kv">줄기: ${esc(br)}</div>
    <div class="kv">부모: ${c.parents.map((x) => `<code>${short(x)}</code>`).join(", ") || "없음 (root)"}</div>
    <div class="kv">${p ? "push 됨: 다시 쓰면 force push 필요" : "로컬 전용: 자유롭게 편집 가능"}</div>
    <div class="kv">파일 (클릭하면 diff):<br>${c.files.map((f) => `<span class="file-link" data-diff="${esc(f)}">${esc(f)}</span>`).join("<br>") || "- (merge 커밋)"}</div>
    ${selectedFile && selectedFile.commit === c.id ? diffHtml(selectedFile.path, c.id, selectedFile.path) : ""}`;
  $("detail-body").querySelectorAll("[data-diff]").forEach((el) => (el.onclick = () => {
    selectedFile = { path: el.dataset.diff, commit: c.id };
    renderDetail();
  }));
  const input = $("msg-input");
  const save = () => doReword(c.id, input.value);
  $("msg-save").onclick = save;
  input.onkeydown = (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") { input.value = c.msg; input.blur(); }
  };
}

function doReword(id, msg) {
  if (blocked()) return;
  const r = Ops.reword(state, id, msg);
  if (r.error) return toast(r.error);
  if (touchesPushed(state, r) && !confirm("push 된 커밋의 메시지를 바꿉니다.\n원격과 히스토리가 달라져서 이후 force push 가 필요합니다. 계속할까요?")) return;
  // 다시 쓰인 커밋을 계속 선택 상태로 유지
  const br = ownerBranch(state, id);
  const idx = stems(state).stems[br].ids.indexOf(id);
  selected = stems(r.state).stems[br].ids[idx];
  apply(r.state, { summary: r.summary, cmd: r.cmd });
  toast(r.summary);
}

function editMessage(id) {
  selected = id;
  render();
  const input = $("msg-input");
  if (input && !input.disabled) { input.focus(); input.select(); }
}

function renderLog() {
  $("log").innerHTML = log.map((e) => `<li>${esc(e.summary)}<code>${esc(e.cmd)}</code></li>`).reverse().join("")
    || `<li class="muted" style="list-style:none;margin-left:-18px">아직 실행한 조작이 없습니다.</li>`;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- 드래그 문법: (끄는 것, 놓는 곳, 수정키) → 조작 ----------
function resolve(src, tgt, m, input = {}) {
  const s = state;
  if (!tgt) return null;
  if (s.op) return fail(OP_BLOCK_MSG);
  const resetMode = (m) => (m.alt ? "hard" : m.shift ? "soft" : "mixed");

  if (src.kind === "commit") {
    const id = src.id;
    if (tgt.kind === "working") {
      // 커밋을 작업 영역으로 = 그 커밋부터 취소하고 변경은 되살림
      if (!isAncestor(s, id, s.branches[s.head])) return fail(`현재 브랜치(${s.head})의 커밋만 작업 영역으로 되돌릴 수 있습니다.`);
      const parent = s.commits[id].parents[0];
      if (!parent) return fail("첫 커밋은 취소할 수 없습니다.");
      return Ops.resetHead(s, parent, m.shift ? "soft" : "mixed");
    }
    if (tgt.kind === "commit") {
      if (tgt.id === id) return null;
      if (ownerBranch(s, tgt.id) && ownerBranch(s, tgt.id) === ownerBranch(s, id)) return Ops.squash(s, id, tgt.id);
      const b = Object.keys(s.branches).find((x) => s.branches[x] === tgt.id);
      if (b) return m.alt ? Ops.cherryPick(s, [id], b) : Ops.moveCommit(s, id, b);
      return fail("다른 줄기의 커밋 위에는 합칠 수 없습니다. 브랜치 이름표(또는 끝 커밋)에 놓으세요.");
    }
    if (tgt.kind === "label") return m.alt ? Ops.cherryPick(s, [id], tgt.branch) : Ops.moveCommit(s, id, tgt.branch);
    if (tgt.kind === "gap") return Ops.reorder(s, id, tgt.branch, +tgt.index);
    if (tgt.kind === "trash") return pushedSet(s).has(id) ? Ops.revertCommit(s, id) : Ops.dropCommit(s, id);
    if (tgt.kind === "canvas") return Ops.createBranch(s, input.name || "new-branch", id);
    return fail("여기에는 놓을 수 없습니다.");
  }

  if (src.kind === "stem") {
    if (tgt.kind === "commit") return Ops.rebaseStem(s, src.branch, tgt.id);
    if (tgt.kind === "label") {
      if (tgt.branch === src.branch) return null;
      return Ops.rebaseStem(s, src.branch, s.branches[tgt.branch]);
    }
    return fail("줄기는 커밋이나 브랜치 이름표 위에 놓아야 rebase 됩니다.");
  }

  if (src.kind === "label") {
    const b = src.branch;
    if (tgt.kind === "label") {
      if (tgt.branch === b) return null;
      return m.shift ? Ops.merge(s, b, tgt.branch) : Ops.moveBranch(s, b, s.branches[tgt.branch]);
    }
    if (tgt.kind === "commit") {
      if (b === s.head && isAncestor(s, tgt.id, s.branches[b])) return Ops.resetHead(s, tgt.id, resetMode(m));
      return m.shift ? fail("merge 는 이름표 위에 놓으세요.") : Ops.moveBranch(s, b, tgt.id);
    }
    if (tgt.kind === "remote") return Ops.push(s, b);
    if (tgt.kind === "trash") return Ops.deleteBranch(s, b);
    return fail("여기에는 놓을 수 없습니다.");
  }

  if (src.kind === "file") {
    const paths = [src.file], msg = input.msg || "새 커밋";
    if (tgt.kind === "label") return Ops.commitTo(s, tgt.branch, msg, paths);
    if (tgt.kind === "commit") {
      if (ownerBranch(s, tgt.id) === s.head) return Ops.amendInto(s, tgt.id, msg, paths);
      const b = Object.keys(s.branches).find((x) => s.branches[x] === tgt.id);
      if (b) return Ops.commitTo(s, b, msg, paths);
      return fail("현재 브랜치의 커밋(amend/fixup)이나 브랜치 끝에 놓으세요.");
    }
    if (tgt.kind === "trash") return Ops.discard(s, paths);
    if (tgt.kind === "working") return null;
    return fail("브랜치 이름표에 놓으면 이 경로의 변경만 커밋됩니다.");
  }

  if (src.kind === "stash") {
    const i = +src.stash;
    if (tgt.kind === "working") return Ops.stashPop(s, i, m.alt);
    if (tgt.kind === "trash") return Ops.stashDrop(s, i);
    if (tgt.kind === "stash") return null;
    return fail("작업 영역에 놓으면 stash 를 꺼냅니다.");
  }

  if (src.kind === "remote") {
    const r = src.remote;
    if (tgt.kind === "label") {
      const mode = $("pull-mode").value;
      if (r === "origin/" + tgt.branch) return Ops.pull(s, tgt.branch, mode);
      return Ops.pull(s, tgt.branch, mode, r); // 다른 원격 브랜치를 가져와 합치기
    }
    return fail("로컬 브랜치 이름표에 놓으면 pull 됩니다.");
  }

  if (src.kind === "working") {
    const msg = input.msg || "새 커밋";
    if (tgt.kind === "label") return Ops.commitTo(s, tgt.branch, msg);
    if (tgt.kind === "commit") {
      if (ownerBranch(s, tgt.id) === s.head) return Ops.amendInto(s, tgt.id, msg);
      const b = Object.keys(s.branches).find((x) => s.branches[x] === tgt.id);
      if (b) return Ops.commitTo(s, b, msg);
      return fail("현재 브랜치의 커밋(amend/fixup)이나 브랜치 끝에 놓으세요.");
    }
    if (tgt.kind === "trash") return Ops.discard(s, [""]);
    if (tgt.kind === "stash") return Ops.stashPush(s, input.msg);
    if (tgt.kind === "working") return null;
    return fail("브랜치 이름표에 놓으면 커밋됩니다.");
  }
  return null;
}

// ---------- 드래그 처리 ----------
let drag = null; // { src, startX, startY, active, tgtEl, mods, x, y }
let lastClick = { id: null, t: 0 };

function readTarget(el) {
  if (!el) return null;
  const d = el.closest("[data-drop]");
  if (!d) return null;
  const k = d.dataset.drop;
  return { el: d, kind: k, id: d.dataset.id, branch: d.dataset.branch, index: d.dataset.index };
}

function srcLabel(src) {
  if (src.kind === "commit") return state.commits[src.id].msg;
  if (src.kind === "stem") return src.branch + " 줄기 전체";
  if (src.kind === "label") return src.branch;
  if (src.kind === "file") {
    const w = state.working;
    const n = [...w.staged, ...w.unstaged].filter((f) => under(f, src.file)).length;
    const isFile = state.files.includes(src.file) || [...w.staged, ...w.unstaged].includes(src.file);
    return `${pathspec(state, [src.file])}${isFile ? "" : ` (변경 ${n}개)`}`;
  }
  if (src.kind === "working") {
    const w = state.working;
    return w.staged.length ? `Staged ${w.staged.length}개` : `변경 ${w.unstaged.length}개 전체`;
  }
  if (src.kind === "stash") return `stash@{${src.stash}}`;
  if (src.kind === "remote") return src.remote;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest("input, textarea, select, button, .chev")) return; // 입력 요소는 드래그로 취급하지 않음
  const el = e.target.closest("[data-drag]");
  if (!el) return;
  const kind = el.dataset.drag;
  if (kind === "working" && !state.working.staged.length && !state.working.unstaged.length) return toast("커밋할 변경이 없습니다.");
  const d = el.dataset;
  drag = { src: { kind, id: d.id, branch: d.branch, file: d.file, stash: d.stash, remote: d.remote }, startX: e.clientX, startY: e.clientY, active: false, srcEl: el };
  e.preventDefault();
});

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.mods = { alt: e.altKey, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey };
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    drag.active = true;
    document.body.classList.add("dragging");
    if (drag.src.kind === "commit") document.body.classList.add("drag-commit");
    $("ghost").textContent = srcLabel(drag.src);
    $("ghost").classList.remove("hidden");
  }
  $("ghost").style.left = e.clientX + "px";
  $("ghost").style.top = e.clientY + "px";
  if (uiMode === "v2") return v2Move(e);
  updateHover(document.elementFromPoint(e.clientX, e.clientY));
});

function updateHover(el) {
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  const tgt = readTarget(el);
  drag.tgt = tgt;
  const res = tgt && resolve(drag.src, tgt, drag.mods);
  drag.res = res;
  const tip = $("tip");
  if (!res) { tip.classList.add("hidden"); hidePreview(); return; }
  tip.style.left = drag.x + "px";
  tip.style.top = drag.y + "px";
  tip.classList.remove("hidden");
  if (res.error) {
    tip.innerHTML = `<div class="err">${esc(res.error)}</div>`;
    hidePreview();
    return;
  }
  tgt.el.classList.add("drop-hover");
  const locked = touchesPushed(state, res);
  tip.innerHTML = `<div class="sum">${esc(res.summary)}</div><code>${esc(res.cmd)}</code>
    ${res.state.op ? `<div class="warn">⚠ 충돌: ${res.state.op.conflicts.map(esc).join(", ")} — 놓으면 "${esc(res.state.op.current?.msg || res.state.op.title)}" 에서 멈추고 해결 모드로 들어갑니다</div>`
      : res.conflicts.length ? `<div class="warn">⚠ 충돌 예상: ${res.conflicts.map(esc).join(", ")}</div>` : ""}
    ${locked ? `<div class="lock">push 된 히스토리를 다시 씁니다 ${drag.mods.meta ? "— ⌘ 눌림, 놓으면 실행" : "— ⌘ 를 누른 채 놓아야 실행"}</div>` : ""}`;
  showPreview(res);
  // 본 캔버스에서 사라질 커밋 표시
  const going = new Set(res.rewrites);
  document.querySelectorAll("#graph .node").forEach((n) => n.classList.toggle("going", going.has(n.dataset.id)));
}

function showPreview(res) {
  const oldIds = new Set(Object.keys(state.commits));
  const newIds = new Set(Object.keys(res.state.commits).filter((c) => !oldIds.has(c)));
  const r = renderGraph(res.state, { newIds });
  const svg = $("preview-svg");
  svg.setAttribute("viewBox", `0 60 ${r.width} ${Math.max(r.height - 60, 200)}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.innerHTML = r.svg;
  $("preview").classList.remove("hidden");
}
function hidePreview() {
  $("preview").classList.add("hidden");
  document.querySelectorAll("#graph .node.going").forEach((n) => n.classList.remove("going"));
}

function endDrag() {
  document.body.classList.remove("dragging", "drag-commit");
  document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  $("ghost").classList.add("hidden");
  $("tip").classList.add("hidden");
  hidePreview();
  drag = null;
}

document.addEventListener("pointerup", (e) => {
  if (!drag) return;
  if (!drag.active) {
    const d = drag; drag = null;
    if (d.src.kind === "commit") {
      // 첫 클릭에서 다시 그리면 dblclick 이벤트가 사라지므로, 더블클릭은 직접 판정한다
      const now = Date.now();
      const dbl = lastClick.id === d.src.id && now - lastClick.t < 400;
      lastClick = { id: d.src.id, t: now };
      if (dbl) return editMessage(d.src.id);
      selected = d.src.id; render();
    }
    return;
  }
  if (uiMode === "v2") return v2Drop(e);
  const res = drag.res;
  const { src, tgt } = drag;
  const meta = e.metaKey || e.ctrlKey;
  endDrag();
  if (!res) return;
  if (res.error) return toast(res.error);
  if (touchesPushed(state, res) && !meta) return toast("push 된 히스토리를 다시 쓰는 조작입니다. ⌘ 를 누른 채 놓으세요.");
  finishDrop(src, tgt, res, (input) => resolve(src, tgt, {}, input));
});

// 드롭 확정 후 공통 처리 (v1·v2 공용). remake(input) 은 입력값(메시지·이름)을 받아 결과를 다시 계산한다.
function finishDrop(src, tgt, res, remake) {
  // 입력이 필요한 조작: 커밋 메시지 칸에 적어 둔 게 있으면 그걸 쓰고, 없으면 묻는다
  const isCommitDrop = (src.kind === "working" || src.kind === "file") && (tgt.kind === "label" || tgt.kind === "commit")
    && !res.summary.includes("amend") && !res.summary.includes("fixup");
  if (isCommitDrop) {
    const w = state.working;
    const first = src.kind === "file" ? [...w.staged, ...w.unstaged].find((f) => under(f, src.file)) : w.staged[0] || w.unstaged[0];
    const typed = $("commit-msg").value.trim();
    const msg = typed || prompt("커밋 메시지 (메시지 칸에 미리 적어 두면 묻지 않습니다)", "update " + first.split("/").pop());
    if (msg === null) return;
    res = remake({ msg: msg || "새 커밋" });
    if (res.error) return toast(res.error);
    $("commit-msg").value = "";
  } else if (src.kind === "working" && tgt.kind === "stash") {
    res = remake({ msg: $("commit-msg").value.trim() });
  } else if (src.kind === "commit" && tgt.kind === "canvas") {
    const name = prompt("새 브랜치 이름", "feat/new");
    if (!name) return;
    res = remake({ name });
    if (res.error) return toast(res.error);
  }
  selected = null;
  apply(res.state, { summary: res.summary + (res.conflicts.length && !res.state.op ? ` (충돌 예상: ${res.conflicts.join(", ")})` : ""), cmd: res.cmd });
  toast(res.state.op ? "충돌이 났습니다. 오른쪽 패널에서 해결하세요." : res.summary);
}

// 수정키를 드래그 도중에 누르고 뗄 때도 미리보기를 갱신
["keydown", "keyup"].forEach((t) => document.addEventListener(t, (e) => {
  if (uiMode === "v2" && v2Key(e, t)) return;
  if (drag && drag.active) {
    if (e.key === "Escape") return endDrag();
    drag.mods = { alt: e.altKey, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey };
    updateHover(document.elementFromPoint(drag.x, drag.y));
    return;
  }
  if (t !== "keydown") return;
  if (e.target.closest && e.target.closest("input, textarea")) return; // 입력 중에는 텍스트 undo 를 쓴다
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
}));

// ---------- 클릭 / 더블클릭 ----------
document.addEventListener("dblclick", (e) => {
  const el = e.target.closest("[data-branch].ref, [data-checkout]");
  if (!el) return;
  const b = el.dataset.branch || el.dataset.checkout;
  runOp(Ops.checkout(state, b));
});

// 진행 중 배너: 계속 / 건너뛰기 / 중단
$("op-banner").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-op]");
  if (!btn || btn.disabled) return;
  const fn = { continue: Ops.continueOp, skip: Ops.skipOp, abort: Ops.abortOp }[btn.dataset.op];
  if (btn.dataset.op === "skip" && !confirm(`"${state.op.current.msg}" 커밋을 버리고 다음으로 넘어갈까요?`)) return;
  selectedFile = null;
  runOp(fn(state), null, true);
});

// 트리: 체크박스 = stage/unstage (폴더면 하위 전체), ▸ = 접기
$("file-tree").addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-stage]");
  if (!cb) return;
  runOp(Ops.stageFiles(state, [cb.dataset.stage], cb.checked ? "staged" : "unstaged"));
});
$("file-tree").addEventListener("click", (e) => {
  const dis = e.target.closest("[data-discard]");
  if (dis) return runOp(Ops.discard(state, [dis.dataset.discard]), "⌘Z 로 되돌릴 수 있습니다");
  const t = e.target.closest("[data-toggle]");
  if (t) {
    const p = t.dataset.toggle;
    collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
    return renderWorking();
  }
  if (e.target.closest("input")) return;
  const row = e.target.closest(".ft-row[data-isfile='1']");
  if (row) { selected = null; selectedFile = { path: row.dataset.path, commit: null }; render(); }
});

// 사이드바: ↓ pull 배지, 새 브랜치, 팀원 push 시뮬레이션
$("repo-tree").addEventListener("click", (e) => {
  const p = e.target.closest("[data-pull]");
  if (p) runOp(Ops.pull(state, p.dataset.pull, $("pull-mode").value));
});
$("pull-mode").onchange = () => renderTree();
$("tb-pull").onclick = () => runOp(Ops.pull(state, state.head, $("pull-mode").value));
$("tb-push").onclick = () => runOp(Ops.push(state, state.head));
$("new-branch").onclick = () => {
  const name = prompt(`${state.head} 에서 새 브랜치 (git switch -c)`, "feat/");
  if (name) runOp(Ops.switchCreate(state, name.trim()));
};
$("team-push").onclick = () => runOp(Ops.simulateTeamPush(state, "origin/main"), null, true);

// 커밋 메시지 칸
function commitFromBox() {
  if (blocked()) return;
  const msg = $("commit-msg").value.trim();
  if (!msg) { $("commit-msg").focus(); return toast("커밋 메시지를 입력하세요."); }
  const r = Ops.commitTo(state, state.head, msg);
  if (r.error) return toast(r.error);
  $("commit-msg").value = "";
  runOp(r);
}
$("commit-btn").onclick = commitFromBox;
$("commit-msg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitFromBox(); }
});
$("only-changed").onchange = (e) => { onlyChanged = e.target.checked; renderWorking(); };

// 충돌로 멈춘 동안에는 해결·계속·건너뛰기·중단(과 팀원 push 시뮬레이션)만 허용
const OP_BLOCK_MSG = "⏸ 충돌로 멈춘 작업이 있습니다. 위 배너에서 해결 후 계속하거나 중단하세요.";
function blocked() {
  if (!state.op) return false;
  toast(OP_BLOCK_MSG);
  return true;
}

function runOp(r, note, allowDuringOp = false) {
  if (state.op && !allowDuringOp) { toast(OP_BLOCK_MSG); return render(); }
  if (r.error) { toast(r.error); return render(); }
  if (touchesPushed(state, r) && !confirm(`${r.summary}\n\npush 된 히스토리를 다시 씁니다 (이후 force push 필요). 계속할까요?`)) return render();
  const warn = r.conflicts.length ? ` (⚠ 충돌 예상: ${r.conflicts.join(", ")})` : "";
  apply(r.state, { summary: r.summary + warn, cmd: r.cmd });
  toast(r.summary + warn + (note ? ` · ${note}` : ""));
}

$("add-change").onclick = () => {
  const w = state.working;
  const clean = state.files.filter((f) => !w.unstaged.includes(f) && !w.staged.includes(f));
  const f = clean.length ? clean[Math.floor(Math.random() * clean.length)] : `src/new${Date.now() % 1000}.js`;
  const s = clone(state);
  s.working.unstaged.push(f);
  apply(s, { summary: `${f} 수정됨 (에디터에서 변경했다고 가정)`, cmd: "# 파일 편집" });
};
$("undo").onclick = undo;
$("redo").onclick = redo;
$("reset").onclick = () => { state = initialState(); past = []; future = []; log = []; selected = null; render(); };
$("help-toggle").onclick = () => $("help").classList.toggle("hidden");
window.addEventListener("resize", render);
document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

setMode(uiMode); // v1/v2 반영 후 첫 렌더
