// model.js — 메모리 위에서 동작하는 가짜 git 저장소
// 모든 조작은 순수 함수: 상태를 복제해서 바꾼 뒤 { state, summary, cmd, conflicts, rewrites } 를 돌려준다.

const clone = (s) => structuredClone(s);
const newId = () => Math.random().toString(16).slice(2, 9);

function initialState() {
  const C = (id, msg, parents, files) => ({ id, msg, parents, files });
  const commits = {};
  [
    C("a1c0e11", "init", [], ["README.md", "package.json", "src/app.js"]),
    C("b2d4f20", "add readme", ["a1c0e11"], ["README.md"]),
    C("c3e6a31", "setup ci", ["b2d4f20"], [".github/workflows/ci.yml"]),
    C("d4f8b42", "fix typo", ["c3e6a31"], ["README.md"]),
    C("e5a1c53", "login form", ["b2d4f20"], ["src/login/LoginForm.tsx"]),
    C("f6b3d64", "auth api", ["e5a1c53"], ["src/api/auth.js", "src/app.js"]),
    C("a7c5e75", "login tests", ["f6b3d64"], ["src/login/LoginForm.test.tsx"]),
    C("b8d7f86", "fix null crash", ["c3e6a31"], ["src/app.js"]),
  ].forEach((c) => (commits[c.id] = c));
  // 작업 폴더에 있는 전체 파일 (트리 표시용)
  const files = [
    ".github/workflows/ci.yml", ".gitignore", "README.md", "package.json",
    "src/app.js", "src/api/auth.js", "src/api/client.js",
    "src/components/Button.tsx", "src/components/Header.tsx",
    "src/login/LoginForm.tsx", "src/login/LoginForm.test.tsx", "src/login/useLogin.ts",
    "src/styles/global.css", "src/styles/theme.css", "src/utils/format.js",
  ];
  return {
    commits,
    branches: { main: "d4f8b42", "feat/login": "a7c5e75", "fix/bug": "b8d7f86" },
    remotes: { "origin/main": "c3e6a31", "origin/feat/login": "f6b3d64" },
    head: "feat/login",
    files,
    stash: [],
    working: {
      unstaged: ["src/login/LoginForm.tsx", "src/login/useLogin.ts", "src/styles/theme.css", "src/styles/global.css", "README.md"],
      staged: [],
      conflicted: [],
    },
    op: null,
  };
}

// ---------- 그래프 조회 ----------
function ancestors(s, id) {
  const seen = new Set();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...s.commits[c].parents);
  }
  return seen;
}
const isAncestor = (s, a, b) => ancestors(s, b).has(a);

function generations(s) {
  const g = {};
  const calc = (id) => {
    if (g[id] !== undefined) return g[id];
    const ps = s.commits[id].parents;
    return (g[id] = ps.length ? 1 + Math.max(...ps.map(calc)) : 0);
  };
  Object.keys(s.commits).forEach(calc);
  return g;
}

function mergeBase(s, a, b) {
  const A = ancestors(s, a);
  const g = generations(s);
  let best = null;
  for (const c of ancestors(s, b)) if (A.has(c) && (best === null || g[c] > g[best])) best = c;
  return best;
}

function pushedSet(s) {
  const set = new Set();
  Object.values(s.remotes).forEach((id) => ancestors(s, id).forEach((c) => set.add(c)));
  return set;
}

function branchOrder(s) {
  const names = Object.keys(s.branches).filter((b) => b !== "main").sort();
  return s.branches.main ? ["main", ...names] : names;
}

// 각 브랜치의 "줄기" = 다른 줄기가 아직 차지하지 않은 first-parent 체인
// 같은 커밋을 가리키는 브랜치가 여럿이면, 줄기(레인)의 이름이 될 대표를 고른다.
// 우선순위: main > 현재 HEAD > 원격에 올라간 브랜치 > 먼저 있던 브랜치 > 이름순.
// 레인 위치는 대표의 원래 자리를 따른다 (새 브랜치를 만들어도 레인 순서가 뒤섞이지 않게).
function laneOrder(s) {
  const order = branchOrder(s);
  const born = (b) => (s.born && s.born[b]) || 0;
  const rank = (b) => (b === "main" ? 0 : b === s.head ? 1 : s.remotes["origin/" + b] ? 2 : 3);
  const byTip = {};
  order.forEach((b) => (byTip[s.branches[b]] ||= []).push(b));
  const repOf = {}, slotOf = {};
  for (const [tip, group] of Object.entries(byTip)) {
    repOf[tip] = [...group].sort((x, y) => rank(x) - rank(y) || born(x) - born(y) || order.indexOf(x) - order.indexOf(y))[0];
    // 레인 자리는 묶음에서 가장 오래된 브랜치의 자리 (HEAD 를 바꿔도 레인이 움직이지 않게)
    slotOf[tip] = [...group].sort((x, y) => born(x) - born(y) || order.indexOf(x) - order.indexOf(y))[0];
  }
  const out = [];
  for (const b of order) {
    const tip = s.branches[b];
    if (slotOf[tip] !== b) continue;
    const rep = repOf[tip];
    out.push(rep, ...byTip[tip].filter((x) => x !== rep));
  }
  return out;
}

function stems(s) {
  const owner = new Map();
  const res = {};
  const refs = [
    ...laneOrder(s).map((b) => [b, s.branches[b], "local"]),
    ...Object.keys(s.remotes).sort().map((r) => [r, s.remotes[r], "remote"]),
    ...(s.op && s.op.tip ? [[OP_REF, s.op.tip, "op"]] : []),
  ];
  for (const [name, tip, kind] of refs) {
    const ids = [];
    let c = tip;
    while (c && !owner.has(c)) {
      ids.push(c);
      owner.set(c, name);
      c = s.commits[c].parents[0];
    }
    res[name] = { ids: ids.reverse(), base: c || null, kind, tip };
  }
  // 어느 ref 의 줄기에도 속하지 않지만 ref 에서 닿는 커밋 (예: merge 후 브랜치가 지워진 작업 커밋)
  // → 이름 없는 줄기로 그린다. 최신 커밋부터 시작해야 줄기가 끝에서부터 이어진다.
  const reach = new Set();
  refs.forEach(([, tip]) => ancestors(s, tip).forEach((c) => reach.add(c)));
  const g = generations(s);
  const rest = [...reach].filter((c) => !owner.has(c)).sort((a, b) => g[b] - g[a]);
  for (const tip of rest) {
    if (owner.has(tip)) continue;
    const name = "· " + tip.slice(0, 7);
    const ids = [];
    let c = tip;
    while (c && !owner.has(c)) {
      ids.push(c);
      owner.set(c, name);
      c = s.commits[c].parents[0];
    }
    res[name] = { ids: ids.reverse(), base: c || null, kind: "anon", tip };
  }
  return { stems: res, owner };
}

// 대상 쪽에만 있는 커밋이 건드린 파일과 겹치면 충돌로 본다 (목업용 단순 규칙)
function touchedFiles(s, origBase, onto) {
  const baseAnc = ancestors(s, origBase);
  const touched = new Set();
  for (const c of ancestors(s, onto)) if (!baseAnc.has(c)) s.commits[c].files.forEach((f) => touched.add(f));
  return [...touched];
}
function predictConflicts(s, files, origBase, onto) {
  const touched = new Set(touchedFiles(s, origBase, onto));
  return [...new Set(files)].filter((f) => touched.has(f));
}

// ---------- 진행 중 작업 (충돌로 멈추는 rebase / cherry-pick / merge / stash) ----------
// s.op = {
//   kind: "rebase" | "cherry-pick" | "merge" | "stash",
//   title, branch, tip, queue:[spec], touched:[files], step, total,
//   current:{msg, files}, conflicts:[files], resolved:{file: "ours"|"theirs"|"both"},
//   oursName, theirsName, after, snapshot(시작 전 상태 = 중단 시 복원)
// }
const OP_REF = "⏸ 진행 중";
const OP_CMD = { rebase: "git rebase", "cherry-pick": "git cherry-pick", merge: "git merge", stash: "git stash" };

function startSequence(s0, s, op) {
  op.snapshot = clone(s0);
  op.step = 0;
  op.total = op.queue.length;
  op.resolved = {};
  runSequence(s, op);
}

// 큐의 커밋을 하나씩 적용하다가 충돌이 나면 멈춘다
function runSequence(s, op) {
  while (op.queue.length) {
    const sp = op.queue[0];
    const src = sp.keep ? s.commits[sp.keep] : sp;
    const conf = src.files.filter((f) => op.touched.includes(f));
    if (conf.length) {
      op.current = { msg: src.msg, files: [...src.files] };
      op.conflicts = conf;
      op.resolved = {};
      op.theirsName = `적용 중인 커밋 "${src.msg}"`;
      s.op = op;
      s.working.conflicted = conf;
      return;
    }
    op.queue.shift();
    op.tip = replay(s, [sp], op.tip);
    op.step++;
  }
  finishOp(s, op);
}

function finishOp(s, op) {
  if (op.kind === "merge") {
    const id = newId();
    s.commits[id] = { id, msg: op.msg, parents: op.parents, files: op.conflicts };
    s.branches[op.branch] = id;
  } else if (op.kind === "stash") {
    if (!op.keep) s.stash.splice(op.idx, 1);
    s.working.unstaged = [...new Set([...s.working.unstaged, ...op.conflicts])];
  } else {
    s.branches[op.branch] = op.tip;
    if (op.after && op.after.drop) {
      const specs = stems(s).stems[op.after.from].ids.filter((c) => c !== op.after.drop).map((c) => ({ keep: c }));
      rewriteStem(s, op.after.from, specs);
    }
  }
  s.op = null;
  s.working.conflicted = [];
}

// merge: 충돌이 있으면 merge 커밋을 만들기 전에 멈춘다
function startMerge(s0, s, m) {
  const op = { kind: "merge", title: m.msg, ...m, resolved: {}, snapshot: clone(s0) };
  if (m.conflicts.length) {
    s.op = op;
    s.working.conflicted = m.conflicts;
  } else finishOp(s, op);
}

// 결과 요약에 "멈춤" 표시 붙이기
function opResult(s, summary, cmd, extra) {
  if (s.op) {
    const o = s.op;
    summary += ` — ⏸ 충돌로 멈춤 (${o.conflicts.join(", ")})`;
    cmd += `\n# CONFLICT → 해결 후 ${OP_CMD[o.kind]} --continue`;
  }
  return ok(s, summary, cmd, extra);
}

// specs 를 onto 위에 차례로 새 커밋으로 만든다. spec: {keep:id} 또는 {msg, files}
function replay(s, specs, onto) {
  let tip = onto;
  for (const sp of specs) {
    const src = sp.keep ? s.commits[sp.keep] : sp;
    const id = newId();
    s.commits[id] = { id, msg: src.msg, parents: tip ? [tip] : [], files: [...src.files] };
    tip = id;
  }
  return tip;
}

// ---------- 결과 헬퍼 ----------
const ok = (state, summary, cmd, extra = {}) => ({ state, summary, cmd, conflicts: [], rewrites: [], ...extra });
const fail = (error) => ({ error });
const short = (id) => id.slice(0, 7);
const label = (s, id) => `${short(id)} "${s.commits[id].msg}"`;

// 로컬 브랜치 줄기를 새 spec 목록으로 다시 쓴다 (앞부분이 같으면 그대로 둔다)
function rewriteStem(s, branch, newSpecs) {
  const st = stems(s).stems[branch];
  let k = 0;
  while (k < st.ids.length && k < newSpecs.length && newSpecs[k].keep === st.ids[k]) k++;
  const base = k === 0 ? st.base : st.ids[k - 1];
  s.branches[branch] = replay(s, newSpecs.slice(k), base) || base;
  return st.ids.slice(k); // 다시 쓰인 원본 커밋들
}

// ---------- 경로 (폴더 단위 지원) ----------
// 경로 p 는 파일 또는 폴더. "" 는 저장소 루트.
const under = (f, p) => p === "" || f === p || f.startsWith(p + "/");
const underAny = (f, paths) => paths.some((p) => under(f, p));
// git 명령에 쓸 pathspec 표기: 루트는 ".", 폴더는 "dir/"
const isFilePath = (s, p) => s.files.includes(p) || [...s.working.staged, ...s.working.unstaged, ...(s.working.conflicted || [])].includes(p);
const pathspec = (s, paths) => paths.map((p) => (p === "" ? "." : isFilePath(s, p) ? p : p + "/")).join(" ");

// 커밋할 파일을 꺼낸다. s 를 직접 바꾼다.
// - paths 지정: 그 경로 아래의 변경만 (staged 여부 무관) → git commit -- <paths>
// - 미지정: staged 가 있으면 그것만, 없으면 변경 전체 → git add . && git commit
function takeChanges(s, paths) {
  const w = s.working;
  if (paths) {
    const files = [...w.staged, ...w.unstaged].filter((f) => underAny(f, paths));
    if (!files.length) return null;
    w.staged = w.staged.filter((f) => !files.includes(f));
    w.unstaged = w.unstaged.filter((f) => !files.includes(f));
    return { files, all: false, addCmd: "", suffix: ` -- ${pathspec(s, paths)}` };
  }
  if (w.staged.length) { const files = w.staged; w.staged = []; return { files, all: false, addCmd: "", suffix: "" }; }
  if (w.unstaged.length) { const files = w.unstaged; w.unstaged = []; return { files, all: true, addCmd: "git add . && ", suffix: "" }; }
  return null;
}

function ownerBranch(s, id) {
  const o = stems(s).owner.get(id);
  return o && s.branches[o] !== undefined ? o : null;
}

// ---------- 조작 ----------
const Ops = {
  commitTo(s0, branch, msg, paths) {
    const s = clone(s0);
    const t = takeChanges(s, paths);
    if (!t) return fail(paths ? "그 경로에는 변경된 파일이 없습니다." : "커밋할 변경이 없습니다.");
    s.branches[branch] = replay(s, [{ msg, files: t.files }], s.branches[branch]);
    const other = branch !== s.head;
    return ok(s, `${other ? `${branch} 에 바로 커밋 (체크아웃 없이)` : `${branch} 에 새 커밋`} · ${t.files.length}개 파일${t.all ? " (변경 전체)" : ""}`,
      t.addCmd + (other ? `git commit (→ ${branch}, worktree 없이)${t.suffix}` : `git commit -m "${msg}"${t.suffix}`));
  },

  amendInto(s0, id, msg, paths) {
    const br = ownerBranch(s0, id);
    if (br !== s0.head) return fail("현재 브랜치(HEAD)의 커밋에만 합칠 수 있습니다.");
    const s = clone(s0);
    const t = takeChanges(s, paths);
    if (!t) return fail("합칠 변경이 없습니다.");
    const st = stems(s).stems[br];
    const isTip = s.branches[br] === id;
    const specs = st.ids.map((c) =>
      c === id ? { msg: s.commits[c].msg, files: [...s.commits[c].files, ...t.files] } : { keep: c });
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, isTip ? `HEAD 커밋 ${label(s0, id)} 에 합치기 (amend)` : `과거 커밋 ${label(s0, id)} 에 흡수 (fixup)`,
      t.addCmd + (isTip ? `git commit --amend${t.suffix}` : `git commit --fixup ${short(id)}${t.suffix} && git rebase -i --autosquash`), { rewrites });
  },

  // paths: 파일 또는 폴더 경로 목록 ("" = 루트 전체)
  stageFiles(s0, paths, to) {
    const from = to === "staged" ? "unstaged" : "staged";
    const moving = s0.working[from].filter((f) => underAny(f, paths));
    if (!moving.length) return fail(to === "staged" ? "stage 할 변경이 없습니다." : "unstage 할 파일이 없습니다.");
    const s = clone(s0);
    s.working[from] = s.working[from].filter((f) => !moving.includes(f));
    s.working[to].push(...moving);
    const spec = pathspec(s0, paths);
    return ok(s, `${spec} ${to === "staged" ? "stage" : "unstage"} · ${moving.length}개 파일`,
      to === "staged" ? `git add ${spec}` : `git restore --staged ${spec}`);
  },

  cherryPick(s0, ids, branch, after = null) {
    const s = clone(s0);
    const tip = s.branches[branch];
    if (ids.some((id) => isAncestor(s, id, tip))) return fail(`이미 ${branch} 에 포함된 커밋입니다.`);
    const files = ids.flatMap((id) => s.commits[id].files);
    const base = s.commits[ids[0]].parents[0];
    const conflicts = predictConflicts(s, files, base, tip);
    startSequence(s0, s, {
      kind: "cherry-pick", title: `${branch} 에 cherry-pick`, branch, tip, after,
      queue: ids.map((id) => ({ keep: id })), touched: touchedFiles(s, base, tip), oursName: `대상 브랜치 ${branch}`,
    });
    return opResult(s, `${ids.map((i) => label(s0, i)).join(", ")} 를 ${branch} 에 복사`,
      `git switch ${branch} && git cherry-pick ${ids.map(short).join(" ")}`, { conflicts });
  },

  moveCommit(s0, id, branch) {
    const src = ownerBranch(s0, id);
    if (!src) return fail("로컬 브랜치의 커밋만 옮길 수 있습니다.");
    if (src === branch) return fail("같은 브랜치입니다. 순서를 바꾸려면 커밋 사이 틈에 놓으세요.");
    // cherry-pick 이 끝나면(충돌을 해결한 뒤라도) 원래 브랜치에서 그 커밋을 뺀다
    const r = Ops.cherryPick(s0, [id], branch, { drop: id, from: src });
    if (r.error) return r;
    const rewrites = stems(s0).stems[src].ids.slice(stems(s0).stems[src].ids.indexOf(id));
    return opResult(r.state, `${label(s0, id)} 를 ${src} → ${branch} 로 이동`,
      `git cherry-pick ${short(id)} (→ ${branch})\ngit rebase -i (${src} 에서 drop ${short(id)})`,
      { conflicts: r.conflicts, rewrites });
  },

  dropCommit(s0, id) {
    const br = ownerBranch(s0, id);
    if (!br) return fail("로컬 브랜치의 커밋만 제거할 수 있습니다.");
    const s = clone(s0);
    const specs = stems(s).stems[br].ids.filter((c) => c !== id).map((c) => ({ keep: c }));
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, `${label(s0, id)} 를 ${br} 에서 제거`, `git rebase -i (drop ${short(id)})`, { rewrites });
  },

  reword(s0, id, msg) {
    const br = ownerBranch(s0, id);
    if (!br) return fail("로컬 브랜치의 커밋만 메시지를 바꿀 수 있습니다.");
    msg = (msg || "").trim();
    if (!msg) return fail("메시지가 비어 있습니다.");
    if (msg === s0.commits[id].msg) return fail("메시지가 같습니다.");
    const s = clone(s0);
    const isTip = s.branches[br] === id;
    const specs = stems(s).stems[br].ids.map((c) => (c === id ? { msg, files: s.commits[c].files } : { keep: c }));
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, `${label(s0, id)} 메시지 → "${msg}"${rewrites.length > 1 ? ` (뒤따르는 커밋 ${rewrites.length - 1}개도 새로 쓰임)` : ""}`,
      isTip ? `git commit --amend -m "${msg}"` : `git rebase -i ${short(id)}~1  # ${short(id)} 을 reword`, { rewrites });
  },

  revertCommit(s0, id) {
    if (!isAncestor(s0, id, s0.branches[s0.head])) return fail(`현재 브랜치(${s0.head})에 있는 커밋만 되돌릴 수 있습니다.`);
    const s = clone(s0);
    const c = s.commits[id];
    s.branches[s.head] = replay(s, [{ msg: `Revert "${c.msg}"`, files: c.files }], s.branches[s.head]);
    return ok(s, `push 된 커밋이라 삭제 대신 되돌림 커밋 생성`, `git revert ${short(id)}`);
  },

  squash(s0, src, dst) {
    const br = ownerBranch(s0, src);
    if (!br || br !== ownerBranch(s0, dst)) return fail("같은 브랜치 줄기 안의 커밋끼리만 합칠 수 있습니다.");
    const s = clone(s0);
    const specs = [];
    for (const c of stems(s).stems[br].ids) {
      if (c === src) continue;
      if (c === dst) specs.push({ msg: s.commits[dst].msg, files: [...s.commits[dst].files, ...s.commits[src].files] });
      else specs.push({ keep: c });
    }
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, `${label(s0, src)} 를 ${label(s0, dst)} 에 합치기`, `git rebase -i (fixup ${short(src)} → ${short(dst)})`, { rewrites });
  },

  reorder(s0, id, branch, index) {
    if (ownerBranch(s0, id) !== branch) return fail("같은 브랜치 안에서만 순서를 바꿀 수 있습니다.");
    const s = clone(s0);
    const ids = stems(s).stems[branch].ids;
    const from = ids.indexOf(id);
    if (index === from || index === from + 1) return fail("제자리입니다.");
    const order = ids.filter((c) => c !== id);
    order.splice(index > from ? index - 1 : index, 0, id);
    const conflicts = [];
    const rewrites = rewriteStem(s, branch, order.map((c) => ({ keep: c })));
    return ok(s, `${label(s0, id)} 의 순서 변경`, `git rebase -i (${short(id)} 이동)`, { rewrites, conflicts });
  },

  rebaseStem(s0, branch, onto) {
    const st = stems(s0).stems[branch];
    if (!st.ids.length) return fail("옮길 커밋이 없습니다.");
    if (!st.base) return fail(`${branch} 는 첫 커밋부터 시작하는 줄기라 다른 커밋 위로 올릴 수 없습니다.`);
    if (st.base === onto) return fail("이미 그 커밋 위에 있습니다.");
    if (st.ids.includes(onto)) return fail("자기 자신 위로는 옮길 수 없습니다.");
    const s = clone(s0);
    const files = st.ids.flatMap((c) => s.commits[c].files);
    const conflicts = predictConflicts(s, files, st.base, onto);
    const ontoName = Object.keys(s.branches).find((b) => s.branches[b] === onto);
    startSequence(s0, s, {
      kind: "rebase", title: `${branch} 를 ${ontoName || short(onto)} 위로 rebase`, branch, tip: onto,
      queue: st.ids.map((c) => ({ keep: c })), touched: touchedFiles(s, st.base, onto),
      oursName: `대상 ${ontoName || label(s0, onto)}`,
    });
    return opResult(s, `${branch} 의 커밋 ${st.ids.length}개를 ${label(s0, onto)} 위로 이동`,
      `git rebase --onto ${short(onto)} ${short(st.base)} ${branch}`, { conflicts, rewrites: st.ids });
  },

  merge(s0, src, dst) {
    if (src === dst) return fail("같은 브랜치입니다.");
    const s = clone(s0);
    const a = s.branches[dst], b = s.branches[src];
    if (isAncestor(s, b, a)) return fail(`${src} 는 이미 ${dst} 에 병합되어 있습니다.`);
    if (isAncestor(s, a, b)) {
      s.branches[dst] = b;
      return ok(s, `${dst} 를 ${src} 까지 fast-forward`, `git switch ${dst} && git merge ${src}  # fast-forward`);
    }
    const base = mergeBase(s, a, b);
    const srcFiles = [...ancestors(s, b)].filter((c) => !ancestors(s, base).has(c)).flatMap((c) => s.commits[c].files);
    const conflicts = predictConflicts(s, srcFiles, base, a);
    startMerge(s0, s, { branch: dst, parents: [a, b], msg: `Merge ${src} into ${dst}`, conflicts, oursName: dst, theirsName: src });
    return opResult(s, `${src} 를 ${dst} 에 병합 (merge 커밋)`, `git switch ${dst} && git merge ${src}`, { conflicts });
  },

  moveBranch(s0, branch, id) {
    const s = clone(s0);
    const old = s.branches[branch];
    if (old === id) return fail("이미 그 위치입니다.");
    const keep = ancestors(s, id);
    const rewrites = [...ancestors(s, old)].filter((c) => !keep.has(c));
    s.branches[branch] = id;
    const isHead = branch === s.head;
    return ok(s, `${branch} 포인터를 ${label(s0, id)} 로 이동${rewrites.length ? ` (커밋 ${rewrites.length}개가 브랜치에서 빠짐)` : ""}`,
      isHead ? `git reset --hard ${short(id)}` : `git branch -f ${branch} ${short(id)}`, { rewrites });
  },

  createBranch(s0, name, id) {
    if (!name) return fail("이름이 없습니다.");
    if (s0.branches[name]) return fail(`${name} 브랜치가 이미 있습니다.`);
    const s = clone(s0);
    s.branches[name] = id;
    s.born = { ...(s.born || {}), [name]: Object.keys(s.born || {}).length + 1 }; // 만든 순서 (레인 대표 고르기용)
    return ok(s, `${label(s0, id)} 에서 새 브랜치 ${name}`, `git branch ${name} ${short(id)}`);
  },

  deleteBranch(s0, name) {
    if (name === s0.head) return fail("현재 체크아웃된 브랜치는 삭제할 수 없습니다.");
    const s = clone(s0);
    const tip = s.branches[name];
    delete s.branches[name];
    const others = [...Object.values(s.branches), ...Object.values(s.remotes)];
    const merged = others.some((t) => isAncestor(s, tip, t));
    return ok(s, `${name} 브랜치 삭제${merged ? "" : " ⚠ 병합되지 않은 커밋이 사라집니다"}`,
      merged ? `git branch -d ${name}` : `git branch -D ${name}`, { rewrites: merged ? [] : [tip] });
  },

  checkout(s0, name) {
    if (s0.head === name) return fail("이미 체크아웃되어 있습니다.");
    const s = clone(s0);
    s.head = name;
    return ok(s, `${name} 로 전환`, `git switch ${name}`);
  },

  push(s0, branch) {
    const s = clone(s0);
    const r = "origin/" + branch;
    const remote = s.remotes[r];
    const local = s.branches[branch];
    if (remote === local) return fail("이미 최신 상태입니다.");
    const force = remote && !isAncestor(s, remote, local);
    s.remotes[r] = local;
    return ok(s, force ? `${branch} 강제 push — 원격 히스토리를 덮어씁니다` : remote ? `${branch} push` : `${branch} 를 원격에 처음 publish`,
      force ? `git push --force-with-lease origin ${branch}` : remote ? `git push` : `git push -u origin ${branch}`,
      { force: !!force });
  },
};

// ---------- P1: pull · 버리기 · reset · stash · 새 브랜치 ----------
const TEAM_MSGS = ["update deps", "fix header style", "add i18n strings", "refactor api client", "tweak theme colors", "docs: usage"];

Object.assign(Ops, {
  // 팀원이 원격에 push 한 상황을 만든다 (그리고 우리가 fetch 했다고 가정)
  simulateTeamPush(s0, remote = "origin/main") {
    if (!s0.remotes[remote]) return fail(`${remote} 가 없습니다.`);
    const s = clone(s0);
    // 처음엔 README.md 를 건드려서 로컬 main 의 "fix typo" 와 충돌이 나게 한다 (충돌 체험용)
    const n = Object.values(s.commits).filter((c) => c.msg.endsWith("(팀원)")).length;
    const msg = TEAM_MSGS[n % TEAM_MSGS.length];
    const file = ["README.md", "src/app.js", "src/styles/theme.css", "package.json", "src/api/client.js"][n % 5];
    const id = newId();
    s.commits[id] = { id, msg: `${msg} (팀원)`, parents: [s.remotes[remote]], files: [file] };
    s.remotes[remote] = id;
    return ok(s, `팀원이 ${remote.replace("origin/", "")} 에 "${msg}" push → fetch 로 받아옴`, `git fetch  # ${remote} 가 1커밋 앞섬`);
  },

  // mode: "merge" | "rebase"
  pull(s0, branch, mode = "merge", remote = "origin/" + branch) {
    const r = s0.remotes[remote], l = s0.branches[branch];
    if (!r) return fail(`${branch} 의 upstream(${remote})이 없습니다. 먼저 push 하세요.`);
    if (isAncestor(s0, r, l)) return fail("이미 최신입니다. 받을 커밋이 없습니다.");
    const s = clone(s0);
    const where = branch === s.head ? "" : ` (${branch} 체크아웃 없이)`;
    if (isAncestor(s, l, r)) {
      s.branches[branch] = r;
      return ok(s, `${remote} 를 받아서 ${branch} fast-forward${where}`, `git pull  # fast-forward`);
    }
    const base = mergeBase(s, l, r);
    const baseAnc = ancestors(s, base);
    const g = generations(s);
    const localOnly = [...ancestors(s, l)].filter((c) => !baseAnc.has(c)).sort((a, b) => g[a] - g[b]);
    const files = localOnly.flatMap((c) => s.commits[c].files);
    const conflicts = predictConflicts(s, files, base, r);
    if (mode === "rebase") {
      startSequence(s0, s, {
        kind: "rebase", title: `pull --rebase: ${branch} 를 ${remote} 위로`, branch, tip: r,
        queue: localOnly.map((c) => ({ keep: c })), touched: touchedFiles(s, base, r), oursName: `원격 ${remote} (팀원 변경)`,
      });
      return opResult(s, `${remote} 를 받고 내 커밋 ${localOnly.length}개를 그 위로 올림${where}`, `git pull --rebase`,
        { conflicts, rewrites: localOnly });
    }
    const theirFiles = [...ancestors(s, r)].filter((c) => !baseAnc.has(c)).flatMap((c) => s.commits[c].files);
    const mconf = predictConflicts(s, theirFiles, base, l);
    startMerge(s0, s, { branch, parents: [l, r], msg: `Merge ${remote} into ${branch}`, conflicts: mconf, oursName: `내 ${branch}`, theirsName: `원격 ${remote} (팀원 변경)` });
    return opResult(s, `${remote} 를 받아서 ${branch} 에 병합 (merge 커밋)${where}`, `git pull  # merge`, { conflicts: mconf });
  },

  discard(s0, paths) {
    const w = s0.working;
    const files = [...w.staged, ...w.unstaged].filter((f) => underAny(f, paths));
    if (!files.length) return fail("버릴 변경이 없습니다.");
    const s = clone(s0);
    s.working.staged = w.staged.filter((f) => !files.includes(f));
    s.working.unstaged = w.unstaged.filter((f) => !files.includes(f));
    const committed = new Set(Object.values(s.commits).flatMap((c) => c.files));
    const untracked = files.filter((f) => !committed.has(f));
    s.files = s.files.filter((f) => !untracked.includes(f));
    const spec = pathspec(s0, paths);
    return ok(s, `${spec} 의 변경 ${files.length}개 버리기`,
      `git restore --staged --worktree -- ${spec}${untracked.length ? `\ngit clean -f -- ${untracked.join(" ")}` : ""}`);
  },

  // 현재 브랜치를 과거 커밋 id 로 되돌린다. mode: soft(→staged) | mixed(→변경) | hard(버림)
  resetHead(s0, id, mode = "mixed") {
    const br = s0.head, tip = s0.branches[br];
    if (tip === id) return fail("이미 그 위치입니다.");
    if (!isAncestor(s0, id, tip)) return fail("현재 브랜치의 과거 커밋으로만 reset 할 수 있습니다.");
    const s = clone(s0);
    const keep = ancestors(s, id);
    const removed = [...ancestors(s, tip)].filter((c) => !keep.has(c));
    const files = [...new Set(removed.flatMap((c) => s.commits[c].files))];
    const w = s.working;
    const all = [...new Set([...w.staged, ...w.unstaged, ...files])];
    if (mode === "soft") { w.staged = [...new Set([...w.staged, ...files])]; w.unstaged = w.unstaged.filter((f) => !w.staged.includes(f)); }
    else if (mode === "mixed") { w.unstaged = all; w.staged = []; }
    else { w.unstaged = []; w.staged = []; }
    s.branches[br] = id;
    const what = { soft: "변경은 Staged 로", mixed: "변경은 작업 영역으로", hard: "변경까지 모두 버림" }[mode];
    return ok(s, `커밋 ${removed.length}개 취소 (${what})`, `git reset --${mode} ${short(id)}`, { rewrites: removed });
  },

  switchCreate(s0, name) {
    const r = Ops.createBranch(s0, name, s0.branches[s0.head]);
    if (r.error) return r;
    r.state.head = name;
    return ok(r.state, `${s0.head} 에서 새 브랜치 ${name} 를 만들고 전환`, `git switch -c ${name}`);
  },

  stashPush(s0, msg) {
    const w = s0.working;
    if (!w.staged.length && !w.unstaged.length) return fail("stash 할 변경이 없습니다.");
    const s = clone(s0);
    const n = w.staged.length + w.unstaged.length;
    s.stash.unshift({ id: newId(), msg: msg || `WIP on ${s.head}`, branch: s.head, staged: w.staged, unstaged: w.unstaged });
    s.working = { staged: [], unstaged: [], conflicted: [] };
    return ok(s, `변경 ${n}개를 stash 에 보관`, `git stash push${msg ? ` -m "${msg}"` : ""}`);
  },

  stashPop(s0, idx, keep = false) {
    const st = s0.stash[idx];
    if (!st) return fail("stash 가 없습니다.");
    const s = clone(s0);
    const w = s.working;
    const current = new Set([...w.staged, ...w.unstaged]);
    const conflicts = [...st.staged, ...st.unstaged].filter((f) => current.has(f));
    w.staged = [...new Set([...w.staged, ...st.staged])].filter((f) => !conflicts.includes(f));
    w.unstaged = [...new Set([...w.unstaged, ...st.unstaged])].filter((f) => !w.staged.includes(f) && !conflicts.includes(f));
    const ref = `stash@{${idx}}`;
    const op = { kind: "stash", title: `stash@{${idx}} "${st.msg}" 적용`, idx, keep, conflicts, resolved: {},
      oursName: "현재 작업 영역", theirsName: `stash "${st.msg}"`, snapshot: clone(s0) };
    if (conflicts.length) { s.op = op; w.conflicted = conflicts; }
    else finishOp(s, op);
    return opResult(s, `stash "${st.msg}" ${keep ? "적용 (stash 유지)" : "꺼내기"}${st.branch !== s.head ? ` — ${st.branch} 에서 만든 것을 ${s.head} 에` : ""}`,
      keep ? `git stash apply ${ref}` : `git stash pop ${ref}`, { conflicts });
  },

  // ---------- 충돌 해결 ----------
  resolveFile(s0, file, choice) {
    const o = s0.op;
    if (!o || !o.conflicts.includes(file)) return fail("충돌 중인 파일이 아닙니다.");
    const s = clone(s0);
    s.op.resolved[file] = choice;
    const how = { ours: `${o.oursName} 쪽 사용`, theirs: `${o.theirsName} 쪽 사용`, both: "둘 다 합쳐서 직접 편집" }[choice];
    // rebase 에서는 git 의 ours/theirs 가 직관과 반대라는 점을 명령에 그대로 보여 준다
    const flag = choice === "both" ? null : choice;
    return ok(s, `${file}: ${how}`, flag ? `git checkout --${flag} ${file} && git add ${file}` : `# ${file} 의 충돌 표시(<<<<<<<)를 직접 정리\ngit add ${file}`);
  },

  continueOp(s0) {
    const o = s0.op;
    if (!o) return fail("진행 중인 작업이 없습니다.");
    const left = o.conflicts.filter((f) => !o.resolved[f]);
    if (left.length) return fail(`아직 해결하지 않은 파일이 있습니다: ${left.join(", ")}`);
    const s = clone(s0);
    const op = s.op;
    s.working.conflicted = [];
    if (op.kind === "rebase" || op.kind === "cherry-pick") {
      op.queue.shift();
      op.tip = replay(s, [op.current], op.tip);
      op.step++;
      s.op = null;
      runSequence(s, op);
    } else finishOp(s, op);
    const cmd = { rebase: "git rebase --continue", "cherry-pick": "git cherry-pick --continue", merge: "git commit  # merge 완료", stash: op.keep ? "# 해결 완료 (stash 유지)" : "git stash drop" }[op.kind];
    return opResult(s, s.op ? `"${o.current.msg}" 적용 완료, 다음 커밋으로` : `${o.title} 완료`, cmd);
  },

  skipOp(s0) {
    const o = s0.op;
    if (!o || (o.kind !== "rebase" && o.kind !== "cherry-pick")) return fail("건너뛸 수 있는 작업이 아닙니다.");
    const s = clone(s0);
    const op = s.op;
    op.queue.shift();
    s.op = null;
    s.working.conflicted = [];
    runSequence(s, op);
    return opResult(s, `"${o.current.msg}" 커밋을 건너뜀 (버려짐)`, `${OP_CMD[o.kind]} --skip`);
  },

  abortOp(s0) {
    const o = s0.op;
    if (!o) return fail("진행 중인 작업이 없습니다.");
    const s = clone(o.snapshot);
    const cmd = o.kind === "stash" ? "git checkout -- . && git stash 는 그대로 유지" : `${OP_CMD[o.kind]} --abort`;
    return ok(s, `${o.title} 중단 — 시작 전 상태로 복원`, cmd);
  },

  stashDrop(s0, idx) {
    const st = s0.stash[idx];
    if (!st) return fail("stash 가 없습니다.");
    const s = clone(s0);
    s.stash.splice(idx, 1);
    return ok(s, `stash "${st.msg}" 삭제`, `git stash drop stash@{${idx}}`);
  },
});

// 공유된(push 된) 커밋을 다시 쓰는지
function touchesPushed(s0, result) {
  if (result.force) return true;
  const p = pushedSet(s0);
  return result.rewrites.some((c) => p.has(c));
}
