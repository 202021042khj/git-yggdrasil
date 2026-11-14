// 그래프 모델: 줄기 · 소유 브랜치 · 원격과 앞섬/뒤처짐 · push 된 커밋 · 배치
import { test } from "vitest";
import assert from "node:assert/strict";
import { mergeBase, ownerBranch, pushedSet, stems, syncInfo } from "@/model/graph";
import { layout, renderGraph } from "@/model/layout";
import { BASE } from "./fixture";

test("줄기: 브랜치마다 자기 커밋만, 시작점은 갈라진 곳", () => {
  const st = stems(BASE());
  assert.deepEqual(st.stems.main.ids, ["a", "b", "c"]);
  assert.deepEqual([st.stems.feat.ids, st.stems.feat.base], [["x", "y"], "b"]);
  assert.deepEqual([st.stems.old.ids, st.stems.old.base], [["o"], "a"]);
  assert.equal(ownerBranch(BASE(), "x"), "feat");
});

test("원격 대비 앞섬 · push 된 커밋 · 공통 조상", () => {
  const s = BASE();
  assert.deepEqual(syncInfo(s, "main"), { remote: "origin/main", ahead: 1, behind: 0 });
  assert.deepEqual(syncInfo(s, "feat"), { remote: null, ahead: 0, behind: 0 });
  assert.deepEqual([...pushedSet(s)].sort(), ["a", "b"]);
  assert.equal(mergeBase(s, "c", "y"), "b");
});

test("배치: 모든 커밋이 자리를 받고 겹치지 않으며, 자식은 부모보다 오른쪽", () => {
  const s = BASE();
  const L = layout(s);
  const spots = Object.values(L.pos).map((p) => `${p.x},${p.y}`);
  assert.equal(spots.length, Object.keys(s.commits).length);
  assert.equal(new Set(spots).size, spots.length, "같은 자리에 두 커밋이 없다");
  for (const c of Object.values(s.commits)) for (const p of c.parents) assert.ok(L.pos[c.id].x > L.pos[p].x, `${c.id} 는 ${p} 보다 오른쪽`);
  const svg = renderGraph(s, { interactive: true, selected: "x" }).svg;
  assert.equal((svg.match(/class="node /g) || []).length, 6);
  const selected = [...svg.matchAll(/<g class="(node[^"]*)"[^>]*data-id="(\w+)"/g)].filter((m) => m[1].includes("selected")).map((m) => m[2]);
  assert.deepEqual(selected, ["x"], "고른 커밋 하나만 selected");
});
