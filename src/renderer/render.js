// render.js — 상태를 레인(줄기) 기반 그래프 SVG 로 그린다
const DX = 130, DY = 120, TOP = 120, PADX = 90;
const LANE_COLORS = ["var(--lane-1)", "var(--lane-2)", "var(--lane-3)", "var(--lane-4)", "var(--lane-5)", "var(--lane-6)"];

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

function layout(s) {
  const { stems: st, owner } = stems(s);
  const g = generations(s);
  const lanes = [];
  let colorIdx = 0;
  for (const [name, info] of Object.entries(st)) {
    if (!info.ids.length) continue;
    const color = info.kind === "local" ? LANE_COLORS[colorIdx++ % LANE_COLORS.length] : info.kind === "op" ? "var(--warn)" : info.kind === "anon" ? "var(--lane-anon)" : "var(--lane-remote)";
    lanes.push({ name, ...info, color });
  }
  // 같은 세대(generation)는 같은 x 열, 빈 열은 압축
  const gens = [...new Set([...owner.keys()].map((c) => g[c]))].sort((a, b) => a - b);
  const col = Object.fromEntries(gens.map((v, i) => [v, i]));
  // 레인 높이는 그 레인에서 이름표가 가장 많이 달린 커밋에 맞춘다.
  // 이름표는 노드 아래로 쌓이므로(30px 아래부터 24px 간격), 다음 레인의 커밋 메시지(노드 위 ~34px)와 겹치지 않게 벌린다.
  const refCount = {};
  const bump = (id) => (refCount[id] = (refCount[id] || 0) + 1);
  Object.values(s.branches).forEach(bump);
  Object.values(s.remotes).forEach(bump);
  if (s.op && s.op.tip) bump(s.op.tip);
  // 레인 → 줄(row) 배치.
  // 이름 있는 레인(로컬·원격 브랜치, 진행 중)은 각자 한 줄을 갖고, 이름 없는 레인(merge 후 지워진 브랜치의 커밋)은
  // 가로 구간이 겹치지 않으면 같은 줄을 나눠 쓴다 (git log --graph 가 끝난 줄을 재사용하는 것과 같은 생각).
  const xOf = (c) => col[g[c]];
  const laneOf = new Map();
  lanes.forEach((ln) => ln.ids.forEach((c) => laneOf.set(c, ln)));
  lanes.forEach((ln) => {
    const xs = ln.ids.map(xOf);
    ln.lo = Math.min(...xs);
    ln.hi = Math.max(...xs);
    if (ln.base && xOf(ln.base) !== undefined) ln.lo = Math.min(ln.lo, xOf(ln.base)); // 갈라져 나온 곡선
  });
  for (const [c, cm] of Object.entries(s.commits)) { // 다른 레인으로 이어지는 간선(merge 등)도 구간에 넣는다
    const lc = laneOf.get(c);
    if (!lc) continue;
    for (const p of cm.parents) {
      const lp = laneOf.get(p);
      if (lp && lp !== lc) lp.hi = Math.max(lp.hi, xOf(c));
    }
  }
  const rows = [];
  lanes.forEach((ln) => {
    let row = null;
    if (ln.kind === "anon") {
      row = rows.find((r) => r.packable && r.spans.every(([a, b]) => ln.hi < a - 1 || ln.lo > b + 1));
    }
    if (!row) { row = { lanes: [], spans: [], packable: ln.kind === "anon" }; rows.push(row); }
    row.lanes.push(ln);
    row.spans.push([ln.lo, ln.hi]);
  });
  const pos = {};
  let y = TOP;
  rows.forEach((row) => {
    let most = 0;
    row.lanes.forEach((ln) => {
      ln.y = y;
      ln.ids.forEach((c) => {
        pos[c] = { x: PADX + xOf(c) * DX, y, lane: ln };
        most = Math.max(most, refCount[c] || 0);
      });
    });
    y += Math.max(DY, 30 + most * LABEL_STEP + 40);
  });
  return { lanes, rows: rows.length, pos, owner, width: PADX * 2 + gens.length * DX + 120, height: y + 20 };
}
const LABEL_STEP = 24;

function renderGraph(s, opts = {}) {
  const L = layout(s);
  const { pos } = L;
  const pushed = pushedSet(s);
  const newIds = opts.newIds || new Set();
  const goingIds = opts.goingIds || new Set();
  const out = [];
  const W = Math.max(L.width, opts.minWidth || 0);

  out.push(`<rect class="bg" data-drop="canvas" x="0" y="0" width="${W}" height="${L.height}"/>`);
  if (opts.interactive) {
    out.push(`<g class="remote-band" data-drop="remote"><rect x="0" y="0" width="${W}" height="44"/>
      <text x="16" y="27">origin: 브랜치 이름표를 여기로 끌어 놓으면 push</text></g>`);
  }

  // 레인 이름 (왼쪽). 가로로 스크롤해도 왼쪽에 붙어 있도록 맨 마지막에 따로 그린다 (아래 laneNames)
  const laneNames = L.lanes.filter((ln) => ln.kind !== "anon").map((ln) =>
    `<g class="lane-tag" transform="translate(0,${ln.y})"><rect x="4" y="-11" width="86" height="20" rx="4"/>
      <text class="lane-name ${ln.kind}" x="10" y="4" style="fill:${ln.color}">${esc(trunc(ln.name, 11))}</text><title>${esc(ln.name)}</title></g>`).join("");

  // 간선
  for (const [c, p0] of Object.entries(pos)) {
    for (const p of s.commits[c].parents) {
      const p1 = pos[p];
      if (!p1) continue;
      const cls = goingIds.has(c) ? "edge going" : newIds.has(c) ? "edge new" : "edge";
      const d = p1.y === p0.y
        ? `M${p1.x},${p1.y} L${p0.x},${p0.y}`
        : `M${p1.x},${p1.y} C${p1.x + DX * 0.6},${p1.y} ${p0.x - DX * 0.6},${p0.y} ${p0.x},${p0.y}`;
      out.push(`<path class="${cls}" d="${d}" style="stroke:${p0.lane.color}"/>`);
    }
  }

  // 틈(순서 변경 드롭 위치)과 줄기 핸들
  if (opts.interactive) {
    for (const ln of L.lanes) {
      if (ln.kind !== "local") continue;
      const xs = ln.ids.map((c) => pos[c].x);
      const y = pos[ln.ids[0]].y;
      for (let i = 0; i <= xs.length; i++) {
        const x = i === 0 ? xs[0] - DX / 2 : i === xs.length ? xs[i - 1] + DX / 2 : (xs[i - 1] + xs[i]) / 2;
        out.push(`<rect class="gap" data-drop="gap" data-branch="${esc(ln.name)}" data-index="${i}" x="${x - 12}" y="${y - 22}" width="24" height="44" rx="6"/>`);
      }
      if (ln.base) {
        out.push(`<g class="grip" data-drag="stem" data-branch="${esc(ln.name)}" transform="translate(${xs[0] - DX / 2},${y})">
          <circle r="11" style="stroke:${ln.color}"/><text y="4">⠿</text>
          <title>줄기 핸들: 끌어서 다른 커밋 위에 놓으면 rebase</title></g>`);
      }
    }
  }

  // 커밋 노드
  const refsAt = {};
  for (const [b, id] of Object.entries(s.branches)) (refsAt[id] ||= []).push({ name: b, kind: "local" });
  for (const [r, id] of Object.entries(s.remotes)) (refsAt[id] ||= []).push({ name: r, kind: "remote" });
  if (s.op && s.op.tip) (refsAt[s.op.tip] ||= []).unshift({ name: OP_REF, kind: "op" });
  const headTip = s.branches[s.head];

  for (const [c, p] of Object.entries(pos)) {
    const cm = s.commits[c];
    const isPushed = pushed.has(c);
    const cls = ["node", isPushed ? "pushed" : "local",
      newIds.has(c) && "new", goingIds.has(c) && "going", opts.selected === c && "selected"].filter(Boolean).join(" ");
    const shape = cm.parents.length > 1
      ? `<rect x="-10" y="-10" width="20" height="20" transform="rotate(45)" style="stroke:${p.lane.color};fill:${isPushed ? p.lane.color : "var(--bg)"}"/>`
      : `<circle r="11" style="stroke:${p.lane.color};fill:${isPushed ? p.lane.color : "var(--bg)"}"/>`;
    out.push(`<g class="${cls}" ${opts.interactive ? `data-drag="commit" data-drop="commit" data-id="${c}"` : ""} transform="translate(${p.x},${p.y})">
      ${c === headTip ? `<circle class="halo" r="17"/>` : ""}${shape}
      <text class="msg" y="-22">${esc(trunc(cm.msg, 15))}</text>
      <title>${short(c)} ${esc(cm.msg)}${cm.author ? `\n${esc(cm.author)} · ${esc(relTime(cm.date))}` : ""}\n파일: ${esc(cm.files.join(", ") || "-")}\n${isPushed ? "push 됨 (공유된 히스토리)" : "로컬 전용 (자유롭게 편집 가능)"}</title></g>`);

    // 이름표 (노드 아래로 쌓기)
    (refsAt[c] || []).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "local" ? -1 : 1)).forEach((r, i) => {
      const y = p.y + 30 + i * LABEL_STEP;
      const isHead = r.kind === "local" && r.name === s.head;
      // 이름표 폭은 열 간격(DX)을 넘지 않게: 넘치면 가운데를 줄이고 전체 이름은 툴팁으로
      // 원격이 로컬보다 앞서 있으면 받을 커밋 수를 붙이고 강조 (끌어서 pull 할 수 있다는 신호)
      let incoming = 0;
      if (r.kind === "remote") {
        const local = s.branches[r.name.replace(/^origin\//, "")];
        if (local) {
          const la = ancestors(s, local);
          incoming = [...ancestors(s, s.remotes[r.name])].filter((x) => !la.has(x)).length;
        }
      }
      let full = (isHead ? "◉ " : "") + r.name + (incoming ? ` ↓${incoming}` : "");
      // 원격 이름표가 넘치면 "origin/" 대신 "원격" 으로 줄여 브랜치 이름을 살린다
      if (r.kind === "remote" && full.length > Math.floor((DX - 30) / 7.2)) full = "원격 " + r.name.replace(/^origin\//, "") + (incoming ? ` ↓${incoming}` : "");
      const maxChars = Math.floor((DX - 12 - 18) / 7.2);
      const text = full.length > maxChars ? full.slice(0, Math.ceil((maxChars - 1) / 2)) + "…" + full.slice(full.length - Math.floor((maxChars - 1) / 2)) : full;
      const w = text.length * 7.2 + 18;
      const color = r.kind === "local" ? L.lanes.find((l) => l.name === r.name)?.color || p.lane.color : r.kind === "op" ? "var(--warn)" : "var(--lane-remote)";
      const attrs = !opts.interactive || r.kind === "op" ? ""
        : r.kind === "local" ? `data-drag="label" data-drop="label" data-branch="${esc(r.name)}"`
        : `data-drag="remote" data-remote="${esc(r.name)}"`;
      out.push(`<g class="ref ${r.kind} ${isHead ? "head" : ""} ${incoming ? "incoming" : ""}" ${attrs} transform="translate(${p.x - w / 2},${y})">
        <rect width="${w}" height="20" rx="10" style="stroke:${color};fill:${r.kind === "remote" ? "var(--bg)" : color}"/>
        <text x="${w / 2}" y="14">${esc(text)}</text><title>${esc(r.name)}${incoming ? `\n받을 커밋 ${incoming}개 — ${esc(r.name.replace(/^origin\//, ""))} 이름표로 끌어 놓으면 pull` : ""}</title></g>`);
    });
  }

  out.push(`<g id="${opts.interactive ? "lane-names" : "lane-names-preview"}" class="lane-names">${laneNames}</g>`);
  return { svg: out.join(""), width: W, height: L.height, layout: L };
}
