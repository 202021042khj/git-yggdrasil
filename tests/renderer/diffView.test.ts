// 좌우 비교 행 만들기 (순수 함수)
import { test } from "vitest";
import assert from "node:assert/strict";
import { splitRows } from "@renderer/model/diffView";

test("지운 줄과 추가 줄을 나란히, 줄 번호는 양쪽 따로", () => {
  const rows = splitRows(["diff --git a/x b/x", "@@ -3,4 +3,3 @@", " c", "-d", "-e", "+D", " f"].join("\n"));
  assert.equal(rows[0].kind, "hunk");
  const lines = rows.slice(1).map((r) => (r.kind === "line" ? [r.left && `${r.left.no}${r.left.kind[0]}${r.left.text}`, r.right && `${r.right.no}${r.right.kind[0]}${r.right.text}`] : null));
  assert.deepEqual(lines, [["3cc", "3cc"], ["4dd", "4aD"], ["5de", null], ["6cf", "5cf"]]);
});
