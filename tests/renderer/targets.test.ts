// 드래그 문법: (끄는 것, 놓는 곳) → 메뉴에 뜨는 조작
import { test } from "vitest";
import assert from "node:assert/strict";
import { actionsFor } from "@/interactions/targets";
import { BASE } from "./fixture";

const verbs = (...a: Parameters<typeof actionsFor>) => actionsFor(...a).map((x) => `${x.op}:${x.verb}`);

test("커밋 → 다른 브랜치 이름표: 옮기기 · 복사 · 브랜치 전체 합치기", () => {
  assert.deepEqual(verbs({ kind: "commit", id: "x" }, { kind: "label", branch: "main" }, BASE()), [
    "moveCommit:main 브랜치로 옮기기", "cherryPick:main 브랜치에 복사", "merge:feat 브랜치 전체를 main에 합치기",
  ]);
});

test("커밋 → 휴지통: push 안 됐으면 제거, push 됐으면 되돌림 커밋", () => {
  assert.deepEqual(verbs({ kind: "commit", id: "c" }, { kind: "trash" }, BASE()), ["dropCommit:커밋 제거"]);
  assert.deepEqual(verbs({ kind: "commit", id: "b" }, { kind: "trash" }, BASE()), ["revertCommit:되돌림 커밋 만들기"]);
});

test("HEAD 이름표 → 과거 커밋: reset 세 가지, 다른 이름표 → rebase · merge · 포인터", () => {
  assert.deepEqual(verbs({ kind: "label", branch: "main" }, { kind: "commit", id: "a" }, BASE()).map((v) => v.split(":")[0]), ["resetHead", "resetHead", "resetHead"]);
  assert.deepEqual(verbs({ kind: "label", branch: "feat" }, { kind: "label", branch: "main" }, BASE()).map((v) => v.split(":")[0]), ["rebaseStem", "merge", "moveBranch"]);
});

test("여러 커밋 → 이름표: 한꺼번에 복사, 진행 중 작업이 있으면 아무것도 없음", () => {
  assert.deepEqual(verbs({ kind: "commit", id: "x", ids: ["x", "y"] }, { kind: "label", branch: "old" }, BASE()), ["cherryPick:커밋 2개를 old 브랜치에 복사"]);
  const s = BASE();
  s.op = { kind: "merge", title: "", oursName: "", theirsName: "", conflicts: [], resolved: {} } as never;
  assert.deepEqual(verbs({ kind: "commit", id: "x" }, { kind: "label", branch: "main" }, s), []);
});

test("staged 변경 → 다른 브랜치 이름표: 체크아웃 없이 커밋, → 과거 커밋: 그 커밋에 합치기(fixup)", () => {
  const s = BASE();
  s.working.staged = ["note.txt"];
  const toLabel = actionsFor({ kind: "working" }, { kind: "label", branch: "feat" }, s);
  assert.deepEqual(toLabel.map((a) => a.op), ["commitTo"]);
  assert.equal(toLabel[0].res.state.branches.feat !== "y", true);
  assert.equal(toLabel[0].res.state.branches.main, "c", "현재 브랜치는 그대로");
  assert.match(toLabel[0].res.summary, /체크아웃 없이/);
  const toPast = actionsFor({ kind: "working" }, { kind: "commit", id: "c" }, s);
  assert.deepEqual(toPast.map((a) => a.op), ["amendInto"]);
  const past = actionsFor({ kind: "file", file: "note.txt" }, { kind: "commit", id: "a" }, s);
  assert.deepEqual(past.map((a) => a.op), ["amendInto"]);
  assert.match(past[0].res.cmd, /--fixup/);
});
