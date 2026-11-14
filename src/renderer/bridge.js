// bridge.js — 목업 화면을 실제 저장소에 연결한다
//  - 저장소 열기 / 최근 저장소 / 파일 변경 시 자동 새로고침 / 실제 diff
//  - 2단계: 화면은 목업 모델(Ops)로 미리보기를 계산하고, 실행 순간에는 { op, args } 만 메인 프로세스로 보내
//    실제 git 명령을 실행한 뒤 저장소를 다시 읽는다
(() => {
  const api = window.gitApi;
  if (!api) return; // 브라우저에서 목업으로 열었을 때는 아무것도 하지 않는다
  document.body.classList.add("real");
  const RECENT_KEY = "ygg-recent";
  let shownRoot = null;
  let running = false;

  // Ops 결과에 "실제로는 어떤 조작인지"를 붙인다 (첫 인자인 상태는 빼고 나머지 인자를 그대로 보낸다)
  // 충돌 해결 조작은 실제 저장소 상태에서 목업 모델로 계산할 수 없으므로 그대로 실행기로 보낸다
  const REAL_ONLY = { resolveFile: "충돌 파일 해결", continueOp: "계속", skipOp: "이 커밋 건너뛰기", abortOp: "중단 (시작 전으로)" };
  for (const name of Object.keys(Ops)) {
    const fake = Ops[name];
    Ops[name] = (...a) => {
      const r = REAL_ONLY[name] && a[0] && a[0].op && a[0].op.real
        ? { state: { ...a[0] }, summary: name === "resolveFile" ? `${a[1]}: ${{ ours: "A 쪽", theirs: "B 쪽", both: "직접 편집" }[a[2]]}` : `${a[0].op.title} — ${REAL_ONLY[name]}`,
            cmd: "", conflicts: [], rewrites: [] }
        : fake(...a);
      if (r && !r.error && r.state) {
        Object.defineProperty(r.state, "__real", {
          value: { op: name, args: a.slice(1), extra: { force: !!r.force, ...realExtra(name, a) } }, configurable: true,
        });
      }
      return r;
    };
  }

  // 히스토리 조작에 필요한 줄기 정보 (어느 브랜치의 커밋인지, 줄기가 어디서 시작하는지)를 실행기에 함께 보낸다
  function realExtra(name, a) {
    const s = a[0];
    try {
      if (name === "moveCommit" || name === "dropCommit" || name === "squash") return { from: ownerBranch(s, a[1]) };
      if (name === "rebaseStem") return { base: stems(s).stems[a[1]].base };
      if (name === "reorder") { const st = stems(s).stems[a[2]]; return { stem: st.ids, base: st.base }; }
    } catch {}
    return {};
  }

  // 화면이 상태를 바꾸려 할 때 → 실제 git 실행
  apply = function (next, entry) {
    const real = next && next.__real;
    if (!real) { // 가짜 상태 편집 (예: 목업 전용 버튼) 은 실제 앱에서 하지 않는다
      toast("이 조작은 실제 저장소에서는 지원하지 않습니다.");
      return render();
    }
    if (real.op === "resetHead" && real.args[1] === "hard"
      && !confirm("작업 영역의 변경까지 모두 버리고 되돌립니다 (git reset --hard).\n버린 변경은 되돌리기(⌘Z)로도 복구되지 않습니다. 계속할까요?")) return render();
    if (real.op === "discard" && !confirm("변경을 버립니다. 버린 변경은 되돌리기(⌘Z)로 복구되지 않습니다. 계속할까요?")) return render();
    runReal(real, entry || { summary: real.op });
  };

  async function runReal({ op, args, extra }, entry, retried = false) {
    if (running) return toast("이전 작업이 아직 실행 중입니다.");
    running = true;
    document.body.classList.add("busy");
    toast(`실행 중… ${entry.summary}`);
    try {
      const r = await api.run(op, args, extra);
      if (r.ok) {
        log.push({ summary: entry.summary, cmd: r.cmds.join("\n") });
        toast(r.warnings && r.warnings.length ? `${entry.summary} — ${r.warnings.join(" ")}` : entry.summary);
      } else {
        const label = r.unsupported ? "아직 지원 안 함" : r.code === "NEEDS_CHECKOUT" ? "충돌 — 체크아웃 필요" : "실패";
        log.push({ summary: `${label}: ${entry.summary.replace(/ — ⏸ 충돌로 멈춤.*$/, "")}`, cmd: [...r.cmds, r.error].join("\n") });
        toast(r.error);
      }
      if (r.repo) show(r.repo);
      else render();
      // 체크아웃하지 않은 브랜치에서 충돌: 체크아웃한 뒤 같은 조작을 다시 해서 충돌 해결 모드로 들어간다
      if (r.code === "NEEDS_CHECKOUT" && !retried) {
        running = false;
        if (confirm(`${r.error}\n\n${r.branch} 로 체크아웃하고 다시 진행할까요? 충돌 지점에서 멈추면 오른쪽 패널에서 해결할 수 있습니다.`)) {
          await runReal({ op: "checkout", args: [r.branch] }, { summary: `${r.branch} 로 전환` }, true);
          if (state.head === r.branch) await runReal({ op, args, extra }, entry, true);
        }
      }
      // 원격이 없어서 push 가 실패했으면: 주소를 받아 origin 으로 추가하고 다시 시도
      if (r.code === "NO_REMOTE" && !retried) {
        running = false;
        const url = await askText("원격 저장소 주소", "", "예: https://github.com/아이디/저장소.git 또는 git@github.com:아이디/저장소.git — origin 으로 추가한 뒤 다시 push 합니다.");
        if (url) {
          await runReal({ op: "remoteAdd", args: ["origin", url] }, { summary: `원격 origin 추가 (${url})` }, true);
          await runReal({ op, args, extra }, entry, true);
        }
      }
    } catch (err) {
      toast(String(err.message || err));
      render();
    } finally {
      running = false;
      document.body.classList.remove("busy");
    }
  }

  // ---------- 원격 목록 ----------
  function renderRemotes() {
    const list = state.remoteList || [];
    $("remote-list").innerHTML = list.length
      ? list.map((r) => `<div class="remote-row" title="${esc(r.url)}">
          <span class="rn">${esc(r.name)}</span><span class="ru">${esc(r.url)}</span>
          <button type="button" data-remote-edit="${esc(r.name)}">주소</button>
          <button type="button" data-remote-del="${esc(r.name)}" aria-label="${esc(r.name)} 삭제">삭제</button></div>`).join("")
      : `<p class="muted remote-empty">연결된 원격이 없습니다.</p>`;
    // 로컬에 없는 원격 브랜치: 가져오기 버튼
    const onlyRemote = Object.keys(state.remotes || {}).filter((r) => !state.branches[r.split("/").slice(1).join("/")]);
    if (onlyRemote.length) {
      $("remote-list").insertAdjacentHTML("beforeend", `<div class="remote-only"><p class="muted">원격에만 있는 브랜치</p>${onlyRemote.map((r) =>
        `<div class="remote-row"><span class="ru">${esc(r)}</span><button type="button" data-remote-co="${esc(r)}">가져오기</button></div>`).join("")}</div>`);
    }
    $("remote-list").querySelectorAll("[data-remote-edit]").forEach((b) => (b.onclick = async () => {
      const name = b.dataset.remoteEdit;
      const cur = list.find((r) => r.name === name)?.url || "";
      const url = await askText(`${name} 주소 바꾸기`, cur);
      if (url && url !== cur) runReal({ op: "remoteSetUrl", args: [name, url] }, { summary: `원격 ${name} 주소 변경` });
    }));
    $("remote-list").querySelectorAll("[data-remote-co]").forEach((b) => (b.onclick = () => checkoutRemoteFlow(b.dataset.remoteCo)));
    $("remote-list").querySelectorAll("[data-remote-del]").forEach((b) => (b.onclick = () => {
      const name = b.dataset.remoteDel;
      if (confirm(`원격 ${name} 연결을 지울까요?\n원격 저장소 자체는 지워지지 않고, 이 폴더와의 연결과 원격 브랜치 정보만 사라집니다.`)) {
        runReal({ op: "remoteRemove", args: [name] }, { summary: `원격 ${name} 연결 삭제` });
      }
    }));
  }
  $("remote-add").onclick = async () => {
    const url = await askText("원격 저장소 주소", "", "예: https://github.com/아이디/저장소.git");
    if (!url) return;
    const name = await askText("원격 이름", (state.remoteList || []).some((r) => r.name === "origin") ? "upstream" : "origin");
    if (name) runReal({ op: "remoteAdd", args: [name, url] }, { summary: `원격 ${name} 추가` });
  };
  const baseRenderTree = renderTree;
  renderTree = function () { baseRenderTree(); renderRemotes(); };

  // ---------- 오른쪽 클릭 메뉴에 붙는 실제 앱 전용 항목 ----------
  // custom 항목: git 미리보기 없이 바로 실행 (메뉴에는 대응 명령만 보여 준다)
  const customItem = (label, cmd, run, src) => ({
    label, verb: label, src, tgt: { kind: "custom" },
    res: { cmd, conflicts: [], rewrites: [], state: { op: null } },
    custom: run,
  });

  async function renameFlow(from) {
    const to = await askText("새 브랜치 이름", from, `${from} 의 이름을 바꿉니다.`);
    if (!to || to === from) return;
    if (state.branches[to]) return toast(`${to} 브랜치가 이미 있습니다.`);
    const up = state.upstream && state.upstream[from];
    const withRemote = !!up && confirm(`${from} 은(는) 원격 ${up} 와 연결되어 있습니다.\n원격에도 ${to} 로 올리고 옛 이름(${up})을 원격에서 지울까요?\n\n확인 = 원격까지 변경, 취소 = 로컬 이름만 변경`);
    runReal({ op: "renameBranch", args: [from, to, withRemote] }, { summary: `${from} → ${to} 이름 변경${withRemote ? " (원격 포함)" : ""}` });
  }
  const checkoutRemoteFlow = (rb) =>
    runReal({ op: "checkoutRemote", args: [rb] }, { summary: `${rb} 를 로컬 브랜치로 가져오기` });

  const baseContextItems = contextItems;
  contextItems = function (src) {
    const items = baseContextItems(src);
    if (src.kind === "label" && state.branches[src.branch] && src.branch !== "HEAD") {
      items.push(customItem("이름 바꾸기…", `git branch -m ${src.branch} <새 이름>`, () => renameFlow(src.branch), src));
    }
    if (src.kind === "remote") {
      const local = src.remote.split("/").slice(1).join("/");
      if (!state.branches[local]) items.unshift(customItem(`로컬 브랜치 ${local} 로 가져오기`, `git switch --track ${src.remote}`, () => checkoutRemoteFlow(src.remote), src));
    }
    return items;
  };

  // 사이드바 브랜치 목록에서도 오른쪽 클릭 메뉴
  $("repo-tree").addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-checkout]");
    if (!row) return;
    e.preventDefault();
    if (blocked()) return;
    const src = { kind: "label", branch: row.dataset.checkout };
    const items = contextItems(src);
    if (items.length) openMenu(e.clientX, e.clientY, src.branch, items);
  });

  // 되돌리기: 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 되돌린다 (커밋류는 변경을 Staged 로 남김)
  undo = () => runReal({ op: "undo", args: [] }, { summary: "되돌리기" });
  redo = () => toast("다시 실행은 아직 지원하지 않습니다. 되돌린 위치는 refs/yggdrasil/backup/ 에도 남아 있습니다.");
  $("undo").onclick = () => undo();
  $("redo").onclick = () => redo();
  $("tb-fetch").onclick = () => runReal({ op: "fetch", args: [] }, { summary: "원격 정보 받아오기 (fetch)" });

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

  // 충돌 패널: 가짜 대신 실제 파일의 충돌 표시 (작업 파일 vs HEAD diff)
  conflictMarkers = function (file) {
    return diffHtml(file, "wt", `${file} — 실제 충돌 내용`);
  };

  // 실제 저장소 상태를 화면이 쓰는 모양으로 맞춘다
  function adapt(repo) {
    const s = repo;
    if (!s.head && s.op && s.op.branch && s.branches[s.op.branch]) s.head = s.op.branch; // rebase 도중
    else if (!s.head && s.detached && s.commits[s.detached]) {
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
    past = []; future = [];
    if (shownRoot !== repo.root) log = []; // 실행 기록은 같은 저장소에서는 유지
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
    if (repo.op && firstOpen) toast(`이 저장소는 ${repo.op.title} 도중에 멈춰 있습니다. 오른쪽 패널에서 충돌을 해결하고 위 배너에서 계속하거나 중단하세요.`);
    const shownN = Object.keys(repo.commits).length;
    $("load-more").hidden = !repo.truncated;
    $("load-more").textContent = `이전 커밋 더 불러오기 (${shownN.toLocaleString()} / ${(repo.totalCommits || shownN).toLocaleString()})`;
  }

  function remember(root) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((r) => r !== root);
      localStorage.setItem(RECENT_KEY, JSON.stringify([root, ...list].slice(0, 8)));
    } catch {}
  }
  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || localStorage.getItem("gc-recent") || "[]"); } catch { return []; }
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

  // 오래된 커밋 더 불러오기: 지금 보던 자리(오른쪽 끝 기준)를 유지한다
  $("load-more").onclick = async () => {
    const wrap = $("canvas-wrap");
    const fromRight = wrap.scrollWidth - wrap.scrollLeft;
    $("load-more").disabled = true;
    try {
      const repo = await api.more();
      if (repo) { show(repo); wrap.scrollLeft = wrap.scrollWidth - fromRight; }
    } finally { $("load-more").disabled = false; }
  };
  $("open-repo").onclick = () => open(api.pick());
  $("welcome-open").onclick = () => open(api.pick());
  api.onMenuOpen(() => open(api.pick()));
  async function cloneFlow() {
    const url = await askText("clone 할 저장소 주소", "", "예: https://github.com/아이디/저장소.git — 다음 단계에서 받을 위치(상위 폴더)를 고릅니다.");
    if (!url) return;
    toast(`clone 하는 중… ${url}`);
    document.body.classList.add("busy");
    await open(api.clone(url));
    document.body.classList.remove("busy");
  }
  $("welcome-clone").onclick = cloneFlow;
  api.onMenuClone(cloneFlow);
  api.onChanged(async () => {
    try { show(await api.read()); } catch {}
  });

  window.__ygg = { show, runReal, open }; // gh.js 에서 쓴다
  renderWelcome();
  $("welcome").classList.remove("hidden");
  // 마지막으로 연 저장소를 자동으로 다시 연다
  if (recent()[0]) open(api.open(recent()[0]));
})();
