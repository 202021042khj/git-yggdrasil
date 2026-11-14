// 화면의 충돌 구간 나누기·합치기 (순수 함수)
import { test } from "vitest";
import assert from "node:assert/strict";
import { composeResolved, conflictCount, parseConflict } from "@/model/conflict";

const TEXT = ["head", "<<<<<<< HEAD", "a1", "a2", "=======", "b1", ">>>>>>> topic", "mid", "<<<<<<< HEAD", "x", "||||||| base", "o", "=======", ">>>>>>> topic", "tail"].join("\n");

test("구간 나누기: 일반·diff3·한쪽이 빈 충돌", () => {
  const c = parseConflict(TEXT);
  assert.equal(conflictCount(c), 2);
  const [, first, , second] = c;
  assert.ok(first.kind === "conflict" && second.kind === "conflict");
  assert.deepEqual([first.ours, first.theirs, first.oursLabel, first.theirsLabel], [["a1", "a2"], ["b1"], "HEAD", "topic"]);
  assert.deepEqual([second.ours, second.base, second.theirs], [["x"], ["o"], []]);
});

test("합치기: 고른 대로, 안 고른 구간은 표시 유지", () => {
  const c = parseConflict(TEXT);
  assert.equal(composeResolved(c, ["theirs-ours", "theirs"]), "head\nb1\na1\na2\nmid\ntail");
  const partial = composeResolved(c, ["ours", null]);
  assert.match(partial, /^head\na1\na2\nmid\n<<<<<<< HEAD\nx\n\|\|\|\|\|\|\| base\no\n=======\n>>>>>>> topic\ntail$/);
  assert.equal(composeResolved(parseConflict(partial), ["ours"]), "head\na1\na2\nmid\nx\ntail");
});

test("짝이 안 맞는 표시는 그냥 글자", () => {
  const c = parseConflict("<<<<<<< 혼자\nx\n");
  assert.equal(conflictCount(c), 0);
});
