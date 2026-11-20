// 설정 값 검사 · 에디터 명령 나누기 (electron 없이 순수 함수만)
import { test, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => undefined }, nativeTheme: {}, shell: {} }));
const { sanitize, splitCommand } = await import("@/settings");

test("잘못되거나 빠진 값은 기본값, 범위 밖은 끝값으로", () => {
  assert.deepEqual(sanitize(null), { theme: "system", zoom: 1, editor: "", autoFetchMinutes: 0, reopenLast: true, pullMode: "merge", language: "system" });
  const s = sanitize({ theme: "purple", zoom: 9, editor: "  code -w ", autoFetchMinutes: -3, reopenLast: "yes", pullMode: "rebase", language: "fr" });
  assert.deepEqual(s, { theme: "system", zoom: 1.5, editor: "code -w", autoFetchMinutes: 0, reopenLast: true, pullMode: "rebase", language: "system" });
  assert.equal(sanitize({ language: "en" }).language, "en");
  assert.equal(sanitize({ zoom: 0.873 }).zoom, 0.87);
});

test("에디터 명령: 셸 없이 프로그램과 인자로, 따옴표 안 공백 유지", () => {
  assert.deepEqual(splitCommand("code -w"), ["code", "-w"]);
  assert.deepEqual(splitCommand('"/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl" --wait'), ["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl", "--wait"]);
  assert.deepEqual(splitCommand("code; rm -rf ~"), ["code;", "rm", "-rf", "~"], "셸을 거치지 않으므로 ; 는 그냥 글자 (code 에 인자로 넘어감)");
  assert.deepEqual(splitCommand(""), []);
});
