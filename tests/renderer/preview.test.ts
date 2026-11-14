// 미리보기 엔진: 놓기 전에 보여 주는 결과가 실제 조작과 같은 모양인지
import { test } from "vitest";
import assert from "node:assert/strict";
import { stems } from "@/model/graph";
import { isError, preview, touchesPushed, type PreviewOut } from "@/model/preview";
import { BASE } from "./fixture";

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
