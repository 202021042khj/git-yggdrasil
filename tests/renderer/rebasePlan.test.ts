// 커밋 정리 미리보기 (순수 함수)
import { test } from "vitest";
import assert from "node:assert/strict";
import { isError, preview } from "@/model/preview";
import { stems } from "@/model/graph";
import type { RepoState } from "@shared/types/repo";

const c = (id: string, parents: string[], files: string[]) => ({ id, parents, msg: `msg ${id}`, files });
// main: a      feat: a ─ x(login) ─ y(api) ─ z(login)
const S = {
  commits: { a: c("a", [], ["r"]), x: c("x", ["a"], ["login"]), y: c("y", ["x"], ["api"]), z: c("z", ["y"], ["login"]) },
  branches: { main: "a", feat: "z" }, remotes: {}, head: "main", files: [],
  working: { staged: [], unstaged: [], conflicted: [] }, stash: [], op: null,
} as unknown as RepoState;

const msgsOf = (s: RepoState, b: string) => stems(s).stems[b].ids.map((id) => s.commits[id].msg);

test("squash 와 reword 와 drop 이 결과 그래프에 반영된다", () => {
  const r = preview("rebasePlan", S, ["feat", [
    { id: "x", action: "reword", msg: "로그인" },
    { id: "y", action: "drop" },
    { id: "z", action: "squash", msg: "로그인 전부" },
  ]]);
  assert.ok(!isError(r));
  assert.deepEqual(msgsOf(r.state, "feat"), ["로그인 전부"]);
  assert.deepEqual(r.rewrites, ["x", "y", "z"]);
});

test("순서를 바꾼 커밋이 같은 파일을 건드리면 충돌 예상", () => {
  const r = preview("rebasePlan", S, ["feat", [{ id: "z", action: "pick" }, { id: "x", action: "pick" }, { id: "y", action: "pick" }]]);
  assert.ok(!isError(r));
  assert.deepEqual(r.conflicts, ["login"]);
  assert.deepEqual(msgsOf(r.state, "feat"), ["msg z", "msg x", "msg y"]);
});

test("잘못된 계획은 거부", () => {
  const e = (steps: unknown[]) => { const r = preview("rebasePlan", S, ["feat", steps]); return isError(r) ? r.error : ""; };
  assert.match(e([{ id: "x", action: "fixup" }, { id: "y", action: "pick" }, { id: "z", action: "pick" }]), /합칠 커밋이 없습니다/);
  assert.match(e([{ id: "x", action: "pick" }, { id: "y", action: "pick" }, { id: "z", action: "pick" }]), /바뀐 것이 없습니다/);
  assert.match(e([{ id: "x", action: "pick" }]), /맞지 않습니다/);
  assert.match(e([{ id: "x", action: "reword", msg: " " }, { id: "y", action: "pick" }, { id: "z", action: "pick" }]), /비어 있는/);
});
