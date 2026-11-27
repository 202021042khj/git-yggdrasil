// 미리보기 엔진: 놓기 전에 보여 주는 결과가 실제 조작과 같은 모양인지
import { test } from "vitest";
import assert from "node:assert/strict";
import { stems } from "@/model/graph";
import { isError, preview, touchesPushed, type PreviewOut } from "@/model/preview";
import { BASE, repo } from "./fixture";

const ok = (r: PreviewOut) => { assert.ok(!isError(r), isError(r) ? r.error : ""); return r as Exclude<PreviewOut, { error: string }>; };
const msgs = (r: PreviewOut, b: string) => { const p = ok(r); return stems(p.state).stems[b].ids.map((id) => p.state.commits[id].msg); };

test("커밋: staged 가 없으면 변경 전체", () => {
  const s = BASE();
  s.working.unstaged = ["new.txt"];
  const r = ok(preview("commitTo", s, ["main", "새 기능"]));
  assert.equal(r.state.commits[r.state.branches.main].msg, "새 기능");
  assert.deepEqual(r.state.working.unstaged, []);
  assert.match(r.cmd, /git add \. && git commit/);
});

test("cherry-pick 은 복사, 옮기기는 원래 줄기에서 빠지고 충돌을 예상한다", () => {
  assert.deepEqual(msgs(preview("cherryPick", BASE(), [["x"], "main"]), "main"), ["msg a", "msg b", "msg c", "msg x"]);
  const mv = ok(preview("moveCommit", BASE(), ["y", "main"]));
  assert.deepEqual(stems(mv.state).stems.feat.ids.map((id) => mv.state.commits[id].msg), ["msg x"]);
  assert.deepEqual(mv.conflicts, ["shared.txt"], "main 의 c 도 shared.txt 를 고쳤다");
});

test("이미 포함된 커밋 복사 · 같은 브랜치 옮기기 · 병합 안 된 브랜치 삭제는 거부", () => {
  assert.ok(isError(preview("cherryPick", BASE(), [["a"], "feat"])));
  assert.ok(isError(preview("moveCommit", BASE(), ["x", "feat"])));
  assert.ok(isError(preview("deleteBranch", BASE(), ["feat"])));
});

test("push 된 커밋을 다시 쓰면 알린다", () => {
  const drop = ok(preview("dropCommit", BASE(), ["b"]));
  assert.ok(touchesPushed(BASE(), drop));
  assert.ok(!touchesPushed(BASE(), ok(preview("dropCommit", BASE(), ["c"]))));
});

test("squash 와 순서 바꾸기", () => {
  assert.deepEqual(msgs(preview("squash", BASE(), ["y", "x"]), "feat"), ["msg x"]);
  assert.deepEqual(msgs(preview("reorder", BASE(), ["y", "feat", 0]), "feat"), ["msg y", "msg x"]);
});

test("체크아웃 안 한 브랜치에도 pull 미리보기 (앞으로 감기 · merge)", () => {
  const s = BASE();
  s.remotes["origin/old"] = "c"; // old(o) 와 갈라짐
  s.remotes["origin/feat"] = "y";
  s.branches.feat = "x"; // feat 는 origin/feat 로 앞으로 감기
  const ff = ok(preview("pull", s, ["feat", "merge"]));
  assert.equal(ff.state.branches.feat, "y");
  assert.match(ff.cmd, /git branch -f feat origin\/feat/);
  const mg = ok(preview("pull", s, ["old", "merge"]));
  assert.deepEqual(mg.state.commits[mg.state.branches.old].parents, ["o", "c"]);
  assert.equal(mg.state.head, "main");
});

/**   main: a ─ b ─ M(+s) ─ c        side: a ─ s   (첫 커밋부터인 줄기, merge 커밋 포함) */
const MERGED = () => repo(
  [["a", []], ["b", ["a"]], ["s", ["a"]], ["M", ["b", "s"], []], ["c", ["M"]]],
  { branches: { main: "c", side: "s" }, head: "main" },
);

test("merge 커밋이 있는 · 첫 커밋부터인 줄기 정리: merge 는 merge 로, 너머로 옮기기 · merge squash 는 거절", () => {
  const plan = (steps: Array<[string, string]>) => preview("rebasePlan", MERGED(), ["main", steps.map(([id, action]) => ({ id, action, ...(action === "reword" ? { msg: "새" } : {}) }))]);
  const r = ok(plan([["b", "pick"], ["a", "reword"], ["M", "pick"], ["c", "pick"]]));
  assert.match(r.cmd, /git rebase -i --rebase-merges --root/);
  const ids = stems(r.state).stems.main.ids;
  assert.deepEqual(ids.map((id) => r.state.commits[id].msg), ["msg b", "새", "msg M", "msg c"]);
  assert.equal(r.state.commits[ids[0]].parents.length, 0, "첫 커밋이 바뀐다");
  assert.deepEqual(r.state.commits[ids[2]].parents, [ids[1], "s"], "merge 는 곁가지 부모 그대로");
  assert.ok(isError(plan([["a", "pick"], ["M", "pick"], ["b", "pick"], ["c", "pick"]])));
  assert.ok(isError(plan([["a", "pick"], ["b", "pick"], ["M", "fixup"], ["c", "pick"]])));
  assert.ok(!isError(plan([["a", "pick"], ["b", "pick"], ["M", "pick"], ["c", "fixup"]])));
  const rb = ok(preview("rebaseStem", MERGED(), ["main", "s"]));
  assert.match(rb.cmd, /--root main/);
});
