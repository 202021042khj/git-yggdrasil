// 그래프 필터 (순수 함수)
import { test } from "vitest";
import assert from "node:assert/strict";
import { dimmedCommits, NO_FILTER, visibleRepo } from "@renderer/model/filter";
import type { RepoState } from "@shared/types/repo";

const c = (id: string, parents: string[], author: string, date: number) => ({ id, parents, msg: id, files: [], author, date });
// a ─ b (main)   a ─ x (feat)   a ─ y (old)
const S: RepoState = {
  commits: { a: c("a", [], "Kim", 1), b: c("b", ["a"], "Kim", 5), x: c("x", ["a"], "Lee", 9), y: c("y", ["a"], "Park", 2) },
  branches: { main: "b", feat: "x", old: "y" },
  remotes: { "origin/feat": "x", "origin/old": "y" },
  tags: { v1: { name: "v1", target: "y" } },
  head: "main", files: [], working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
} as unknown as RepoState;

test("필터가 없으면 원본 그대로", () => {
  assert.equal(visibleRepo(S, NO_FILTER), S);
});

test("고른 브랜치 + 체크아웃한 브랜치에서 닿는 커밋만, 원격·태그도 따라간다", () => {
  const v = visibleRepo(S, { ...NO_FILTER, branches: ["feat"] });
  assert.deepEqual(Object.keys(v.commits).sort(), ["a", "b", "x"]);
  assert.deepEqual(Object.keys(v.branches).sort(), ["feat", "main"]);
  assert.deepEqual(Object.keys(v.remotes), ["origin/feat"]);
  assert.deepEqual(Object.keys(v.tags ?? {}), []);
});

test("작성자·기간에 맞지 않는 커밋은 흐리게", () => {
  assert.deepEqual([...dimmedCommits(S, { ...NO_FILTER, author: "kim" })].sort(), ["x", "y"]);
  assert.deepEqual([...dimmedCommits(S, { ...NO_FILTER, since: 5 })].sort(), ["a", "y"]);
});
