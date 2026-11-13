// bridge.js — 목업 화면을 실제 저장소에 연결한다 (1단계: 읽기 전용)
//  - 저장소 열기 / 최근 저장소 / 파일 변경 시 자동 새로고침
//  - 실제 diff 표시
//  - 조작(커밋·rebase 등)은 아직 실행하지 않는다: 드래그 미리보기까지만 되고, 놓으면 안내만 한다
(() => {
  const api = window.gitApi;
  if (!api) return; // 브라우저에서 목업으로 열었을 때는 아무것도 하지 않는다
  document.body.classList.add("real");
  const RECENT_KEY = "gc-recent";
  let shownRoot = null;

  // 1단계: 상태를 바꾸는 모든 조작을 막는다 (미리보기는 그대로 보인다)
  apply = function () {
    toast("1단계(읽기 전용)라 실제로 실행하지 않았습니다. 미리보기만 확인할 수 있습니다.");
    render();
  };
  undo = redo = () => toast("1단계(읽기 전용)에서는 되돌릴 작업이 없습니다.");
  $("undo").onclick = () => undo();
  $("redo").onclick = () => redo();

  // 실제 diff: 렌더링 후 비동기로 채운다
  diffHtml = function (file, seed, title) {
    const commit = seed && state.commits[seed] ? seed : "";
    const key = `${commit}:${file}`;
    queueMicrotask(async () => {
      const box = document.querySelector(`.diff[data-key="${CSS.escape(key)}"] pre`);
      if (!box) return;
      const text = await api.diff(file, commit || null);
      const lines = (text || "(변경 내용 없음)").split("\n").map((l) => {
        const cls = /^(\+\+\+|---|diff |index )/.test(l) ? "ctx" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx";
        return `<span class="${cls}">${esc(l)}</span>`;
      });
      box.innerHTML = lines.join("");
    });
    return `<div class="diff" data-key="${esc(key)}"><div class="dh">${esc(title)}</div><pre><span class="ctx">불러오는 중…</span></pre></div>`;
  };

  // 실제 저장소 상태를 화면이 쓰는 모양으로 맞춘다
  function adapt(repo) {
    const s = repo;
    if (!s.head && s.detached && s.commits[s.detached]) {
      s.branches = { ...s.branches, HEAD: s.detached };
      s.head = "HEAD";
    }
    s.stash = s.stash || [];
    s.working.conflicted = s.working.conflicted || [];
    return s;
  }

  function show(repo) {
    if (drag) return; // 드래그 중에는 화면을 바꾸지 않는다 (끝나면 다음 변경 때 반영)
    const empty = !repo || !Object.keys(repo.commits).length || !repo.branches[repo.head];
    if (!repo) return;
    if (selected && !repo.commits[selected]) selected = null;
    state = adapt(repo);
    past = []; future = []; log = [];
    $("repo-path").textContent = repo.root;
    $("repo-path").title = repo.root;
    document.body.classList.toggle("empty-repo", empty);
    $("welcome").classList.add("hidden");
    const firstOpen = shownRoot !== repo.root;
    shownRoot = repo.root;
    render();
    // 처음 열 때는 최근 작업(HEAD)이 보이게 스크롤한다. 자동 새로고침 때는 보던 자리를 유지한다.
    if (firstOpen) {
      const wrap = $("canvas-wrap");
      const tip = document.querySelector(`#graph .node[data-id="${CSS.escape(state.branches[state.head] || "")}"]`);
      if (tip) {
        const r = tip.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        wrap.scrollLeft += r.left - w.left - w.width * 0.7;
        wrap.scrollTop += r.top - w.top - w.height * 0.3;
      } else wrap.scrollLeft = wrap.scrollWidth;
    }
    if (repo.gitOp) toast(`이 저장소는 ${repo.gitOp} 이 진행 중인 상태입니다 (1단계에서는 표시만 합니다).`);
    if (repo.truncated) $("repo-path").textContent = `${repo.root} · 최근 커밋 ${Object.keys(repo.commits).length}개만 표시`;
  }

  function remember(root) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((r) => r !== root);
      localStorage.setItem(RECENT_KEY, JSON.stringify([root, ...list].slice(0, 8)));
    } catch {}
  }
  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  }

  async function open(promise) {
    try {
      const repo = await promise;
      if (!repo) return;
      remember(repo.root);
      show(repo);
    } catch (err) {
      toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      renderWelcome();
    }
  }

  function renderWelcome() {
    const list = recent();
    $("recent-list").innerHTML = list.length
      ? list.map((r) => `<button type="button" class="recent" data-path="${esc(r)}"><span class="r-name">${esc(r.split("/").pop())}</span><span class="r-path">${esc(r)}</span></button>`).join("")
      : `<p class="muted">최근에 연 저장소가 없습니다.</p>`;
    $("recent-list").querySelectorAll("[data-path]").forEach((b) => (b.onclick = () => open(api.open(b.dataset.path))));
  }

  $("open-repo").onclick = () => open(api.pick());
  $("welcome-open").onclick = () => open(api.pick());
  api.onMenuOpen(() => open(api.pick()));
  api.onChanged(async () => {
    try { show(await api.read()); } catch {}
  });

  renderWelcome();
  $("welcome").classList.remove("hidden");
  // 마지막으로 연 저장소를 자동으로 다시 연다
  if (recent()[0]) open(api.open(recent()[0]));
})();
