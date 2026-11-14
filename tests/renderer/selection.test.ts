// 여러 커밋 선택 (순수 함수)
import { test } from "vitest";
import assert from "node:assert/strict";
import { oldestFirst, rangeOnStem, toggleIn } from "@/model/selection";
import type { RepoState } from "@shared/types/repo";

const c = (id: string, parents: string[]) => ({ id, parents, msg: id, files: [] });
// main: a ─ b ─ c ─ d      feat: b ─ x ─ y
const S = {
  commits: { a: c("a", []), b: c("b", ["a"]), c: c("c", ["b"]), d: c("d", ["c"]), x: c("x", ["b"]), y: c("y", ["x"]) },
  branches: { main: "d", feat: "y" }, remotes: {}, head: "main", files: [],
  working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
} as unknown as RepoState;

test("오래된 것부터, 중복 제거", () => {
  assert.deepEqual(oldestFirst(S, ["y", "c", "x", "c"]), ["c", "x", "y"], "같은 깊이면 이름순");
  assert.deepEqual(oldestFirst(S, ["d", "a", "c"]), ["a", "c", "d"]);
});

test("같은 줄기 안에서만 범위, 순서와 상관없이 양 끝 포함", () => {
  assert.deepEqual(rangeOnStem(S, "y", "x"), ["x", "y"]);
  assert.equal(rangeOnStem(S, "x", "d"), null, "다른 브랜치면 범위 없음");
});

test("⌘ 클릭 토글", () => {
  assert.deepEqual(toggleIn(["a", "b"], "b"), ["a"]);
  assert.deepEqual(toggleIn(["a"], "c"), ["a", "c"]);
});
