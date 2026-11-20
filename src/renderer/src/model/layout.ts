// 커밋 그래프 배치와 SVG 그리기
import { CHAR_W, DX, DY, LABEL_STEP, LANE_COLORS, opRef, PADX, TOP } from "@/constants/layout";
import { esc, short, trunc, truncMiddle } from "@/lib/html";
import { relTime } from "@/lib/time";
import { ancestors, generations, pushedSet, stems, type Stem } from "@/model/graph";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

export interface Lane extends Stem {
  name: string;
  color: string;
  y: number;
  lo: number;
  hi: number;
}

export interface Layout {
  lanes: Lane[];
  rows: number;
  pos: Record<string, { x: number; y: number; lane: Lane }>;
  owner: Map<string, string>;
  width: number;
  height: number;
}

type RefKind = "local" | "remote" | "op" | "tag" | "detached";
interface RefLabel { name: string; kind: RefKind }

/** 커밋마다 달리는 이름표 */
function refsAt(s: RepoState): Record<string, RefLabel[]> {
  const at: Record<string, RefLabel[]> = {};
  const add = (id: string, r: RefLabel) => (at[id] ||= []).push(r);
  for (const [b, id] of Object.entries(s.branches)) add(id, { name: b, kind: "local" });
  if (s.detached && !s.head) add(s.detached, { name: "HEAD", kind: "detached" });
  for (const [r, id] of Object.entries(s.remotes)) add(id, { name: r, kind: "remote" });
  for (const t of Object.values(s.tags || {})) add(t.target, { name: t.name, kind: "tag" });
  if (s.op?.tip) (at[s.op.tip] ||= []).unshift({ name: opRef(), kind: "op" });
  const order: RefKind[] = ["detached", "op", "local", "tag", "remote"];
  Object.values(at).forEach((list) => list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)));
  return at;
}

export function layout(s: RepoState): Layout {
  const { stems: st, owner } = stems(s);
  const g = generations(s);
  let colorIdx = 0;
  const lanes: Lane[] = [];
  for (const [name, info] of Object.entries(st)) {
    if (!info.ids.length) continue;
    const color = info.kind === "local" ? LANE_COLORS[colorIdx++ % LANE_COLORS.length]
      : info.kind === "op" ? "var(--warn)" : info.kind === "anon" ? "var(--lane-anon)" : "var(--lane-remote)";
    lanes.push({ name, ...info, color, y: 0, lo: 0, hi: 0 });
  }
  // 같은 세대(generation)는 같은 x 열, 빈 열은 압축
  const gens = [...new Set([...owner.keys()].map((c) => g[c]))].sort((a, b) => a - b);
  const col: Record<number, number> = Object.fromEntries(gens.map((v, i) => [v, i]));
  const xOf = (c: string) => col[g[c]];

  // 줄 높이: 이름표가 가장 많이 달린 커밋에 맞춘다 (노드 아래 30px 부터 쌓이고, 다음 줄의 커밋 메시지와 겹치지 않게)
  const refs = refsAt(s);

  // 레인 → 줄(row): 이름 있는 레인은 각자 한 줄, 이름 없는 레인은 가로 구간이 겹치지 않으면 같은 줄을 나눠 쓴다
  const laneOf = new Map<string, Lane>();
  lanes.forEach((ln) => ln.ids.forEach((c) => laneOf.set(c, ln)));
  lanes.forEach((ln) => {
    const xs = ln.ids.map(xOf);
    ln.lo = Math.min(...xs);
    ln.hi = Math.max(...xs);
    if (ln.base && xOf(ln.base) !== undefined) ln.lo = Math.min(ln.lo, xOf(ln.base));
  });
  for (const [c, cm] of Object.entries(s.commits)) { // 다른 레인으로 이어지는 간선(merge 등)도 구간에 넣는다
    const lc = laneOf.get(c);
    if (!lc) continue;
    for (const p of cm.parents) {
      const lp = laneOf.get(p);
      if (lp && lp !== lc) lp.hi = Math.max(lp.hi, xOf(c));
    }
  }
  const rows: Array<{ lanes: Lane[]; spans: Array<[number, number]>; packable: boolean }> = [];
  for (const ln of lanes) {
    let row = ln.kind === "anon" ? rows.find((r) => r.packable && r.spans.every(([a, b]) => ln.hi < a - 1 || ln.lo > b + 1)) : undefined;
    if (!row) { row = { lanes: [], spans: [], packable: ln.kind === "anon" }; rows.push(row); }
    row.lanes.push(ln);
    row.spans.push([ln.lo, ln.hi]);
  }
  const pos: Layout["pos"] = {};
  let y = TOP;
  for (const row of rows) {
    let most = 0;
    for (const ln of row.lanes) {
      ln.y = y;
      for (const c of ln.ids) {
        pos[c] = { x: PADX + xOf(c) * DX, y, lane: ln };
        most = Math.max(most, refs[c]?.length || 0);
      }
    }
    y += Math.max(DY, 30 + most * LABEL_STEP + 40);
  }
  return { lanes, rows: rows.length, pos, owner, width: PADX * 2 + gens.length * DX + 120, height: y + 20 };
}

export interface RenderOptions {
  /** 드래그·클릭 대상 속성을 넣는다 (본 캔버스) */
  interactive?: boolean;
  selected?: string | null;
  /** 미리보기에서 새로 생기는 커밋 */
  newIds?: Set<string>;
  /** 미리보기에서 사라지는 커밋 */
  goingIds?: Set<string>;
  minWidth?: number;
  /** 필터에 맞지 않아 흐리게 그릴 커밋 */
  dim?: Set<string>;
  /** 키보드 초점을 둘 커밋 (없으면 선택한 커밋 → HEAD) */
  focusId?: string | null;
  /** 함께 고른 커밋 (여러 개 선택) */
  multi?: Set<string>;
}

export function renderGraph(s: RepoState, opts: RenderOptions = {}) {
  const L = layout(s);
  const { pos } = L;
  const pushed = pushedSet(s);
  const newIds = opts.newIds || new Set<string>();
  const goingIds = opts.goingIds || new Set<string>();
  const out: string[] = [];
  const W = Math.max(L.width, opts.minWidth || 0);

  out.push(`<rect class="bg" data-drop="canvas" x="0" y="0" width="${W}" height="${L.height}"/>`);
  if (opts.interactive) {
    out.push(`<g class="remote-band" data-drop="remote"><rect x="0" y="0" width="${W}" height="44"/>
      <text id="remote-band-label" x="16" y="27">${esc(t("graph.remoteBand"))}</text></g>`);
  }

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

  // 순서 변경 드롭 위치 (커밋 사이 틈). 보이지 않고, 드래그 라벨의 위치를 잡는 데만 쓴다
  if (opts.interactive) {
    for (const ln of L.lanes) {
      if (ln.kind !== "local") continue;
      const xs = ln.ids.map((c) => pos[c].x);
      for (let i = 0; i <= xs.length; i++) {
        const x = i === 0 ? xs[0] - DX / 2 : i === xs.length ? xs[i - 1] + DX / 2 : (xs[i - 1] + xs[i]) / 2;
        out.push(`<rect class="gap" data-drop="gap" data-branch="${esc(ln.name)}" data-index="${i}" x="${x - 12}" y="${ln.y - 22}" width="24" height="44" rx="6"/>`);
      }
    }
  }

  // 커밋 노드와 이름표
  const labels = refsAt(s);
  const headTip = s.head ? s.branches[s.head] : s.detached;
  const laneColor = (name: string) => L.lanes.find((l) => l.name === name)?.color;
  for (const [c, p] of Object.entries(pos)) {
    const cm = s.commits[c];
    const isPushed = pushed.has(c);
    const cls = ["node", isPushed ? "pushed" : "local", newIds.has(c) && "new", goingIds.has(c) && "going", opts.selected === c && "selected", opts.dim?.has(c) && "dim", opts.multi?.has(c) && "multi"].filter(Boolean).join(" ");
    const fill = isPushed ? p.lane.color : "var(--bg)";
    const shape = cm.parents.length > 1
      ? `<rect x="-10" y="-10" width="20" height="20" transform="rotate(45)" style="stroke:${p.lane.color};fill:${fill}"/>`
      : `<circle r="11" style="stroke:${p.lane.color};fill:${fill}"/>`;
    const tip = `${short(c)} ${cm.msg}${cm.author ? `\n${cm.author} · ${relTime(cm.date)}` : ""}\n${t("graph.tipFiles", { files: cm.files.join(", ") || "-" })}\n${isPushed ? t("graph.tipPushed") : t("graph.tipLocal")}`;
    // 화면 낭독기용 이름: 메시지 · 해시 · 줄기 · 공유 여부 · HEAD (그래프 안에서는 화살표로 이동, 하나만 Tab 으로 닿는다)
    const where = labels[c]?.filter((r) => r.kind === "local").map((r) => r.name).join(", ");
    const spoken = t("graph.commitLabel", { msg: cm.msg, id: short(c), lane: p.lane.name.startsWith("·") ? null : p.lane.name, tipOf: where || null, head: c === headTip, pushed: isPushed, merge: cm.parents.length > 1 });
    const focusable = opts.interactive && c === (opts.focusId ?? opts.selected ?? headTip);
    out.push(`<g class="${cls}" ${opts.interactive ? `data-drag="commit" data-drop="commit" data-id="${c}" role="button" aria-label="${esc(spoken)}" aria-pressed="${opts.selected === c || !!opts.multi?.has(c)}" tabindex="${focusable ? 0 : -1}"` : ""} transform="translate(${p.x},${p.y})">
      ${c === headTip ? `<circle class="halo" r="17"/>` : ""}${shape}
      <text class="msg" y="-22" aria-hidden="true">${esc(trunc(cm.msg, 15))}</text><title>${esc(tip)}</title></g>`);

    (labels[c] || []).forEach((r, i) => {
      out.push(refLabel(s, r, p.x, p.y + 30 + i * LABEL_STEP, laneColor(r.name) || p.lane.color, !!opts.interactive));
    });
  }

  // 레인 이름 (왼쪽). 가로 스크롤해도 왼쪽에 붙도록 맨 마지막에 그리고, 화면이 스크롤 위치만큼 옮긴다
  const laneNames = L.lanes.filter((ln) => ln.kind !== "anon").map((ln) =>
    `<g class="lane-tag" transform="translate(0,${ln.y})"><rect x="4" y="-11" width="86" height="20" rx="4"/>
      <text class="lane-name ${ln.kind}" x="10" y="4" style="fill:${ln.color}">${esc(trunc(ln.name, 11))}</text><title>${esc(ln.name)}</title></g>`).join("");
  out.push(`<g id="${opts.interactive ? "lane-names" : "lane-names-preview"}" class="lane-names" aria-hidden="true">${laneNames}</g>`);
  return { svg: out.join(""), width: W, height: L.height, layout: L };
}

function refLabel(s: RepoState, r: RefLabel, x: number, y: number, laneColor: string, interactive: boolean): string {
  const isHead = r.kind === "local" && r.name === s.head;
  // 원격이 로컬보다 앞서 있으면 받을 커밋 수를 붙이고 강조 (끌어서 pull 할 수 있다는 신호)
  let incoming = 0;
  if (r.kind === "remote") {
    const local = s.branches[r.name.replace(/^[^/]+\//, "")];
    if (local) {
      const la = ancestors(s, local);
      incoming = [...ancestors(s, s.remotes[r.name])].filter((c) => !la.has(c)).length;
    }
  }
  const prefix = isHead ? "◉ " : r.kind === "tag" ? "⚑ " : r.kind === "detached" ? "◉ " : "";
  let full = prefix + (r.kind === "detached" ? t("graph.detached") : r.name) + (incoming ? ` ↓${incoming}` : "");
  // 원격 이름표가 넘치면 "origin/" 대신 "원격" 으로 줄여 브랜치 이름을 살린다
  if (r.kind === "remote" && full.length > Math.floor((DX - 30) / CHAR_W)) full = t("graph.remoteShort", { name: r.name.replace(/^[^/]+\//, "") }) + (incoming ? ` ↓${incoming}` : "");
  const text = truncMiddle(full, Math.floor((DX - 30) / CHAR_W));
  const w = text.length * CHAR_W + 18;
  const color = r.kind === "local" ? laneColor : r.kind === "op" || r.kind === "detached" ? "var(--warn)" : r.kind === "tag" ? "var(--tag)" : "var(--lane-remote)";
  const attrs = !interactive ? ""
    : r.kind === "local" ? `data-drag="label" data-drop="label" data-branch="${esc(r.name)}"`
    : r.kind === "remote" ? `data-drag="remote" data-remote="${esc(r.name)}"`
    : r.kind === "tag" ? `data-drag="tag" data-tag="${esc(r.name)}"` : "";
  const title = r.kind === "tag" ? `${t("src.tag", { name: r.name })}${s.tags?.[r.name]?.message ? `\n${s.tags[r.name].message}` : ""}`
    : `${r.name}${incoming ? `\n${t("graph.incomingTip", { n: incoming })}` : ""}`;
  const spoken = r.kind === "tag" ? t("src.tag", { name: r.name }) : r.kind === "remote" ? t("graph.remoteLabel", { name: r.name, n: incoming })
    : r.kind === "detached" ? t("graph.detachedLabel") : r.kind === "op" ? t("graph.opLabel") : t("graph.branchLabel", { name: r.name, head: isHead });
  const a11y = interactive ? ` role="button" aria-label="${esc(spoken)}" tabindex="-1"` : "";
  return `<g class="ref ${r.kind} ${isHead ? "head" : ""} ${incoming ? "incoming" : ""}" ${attrs}${a11y} transform="translate(${x - w / 2},${y})">
    <rect width="${w}" height="20" rx="10" style="stroke:${color};fill:${r.kind === "remote" || r.kind === "tag" ? "var(--bg)" : color}"/>
    <text x="${w / 2}" y="14" aria-hidden="true">${esc(text)}</text><title>${esc(title)}</title></g>`;
}
