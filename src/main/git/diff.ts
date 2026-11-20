// 파일 하나의 diff: 공백 무시 · 길이 제한 · 바이너리 판별 · 이미지 전후 미리보기
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { t } from "@shared/i18n/i18n";
import type { DiffOptions, FileDiff } from "@shared/types/ipc";

export const DIFF_MAX_LINES = 1500;
const IMAGE_MAX_BYTES = 5_000_000;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".svg": "image/svg+xml",
};

/** git 객체를 바이트 그대로 읽는다 (없거나 너무 크면 null) */
function blob(root: string, spec: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile("git", ["cat-file", "blob", spec], { cwd: root, encoding: "buffer", maxBuffer: IMAGE_MAX_BYTES + 1, env: { ...process.env, LC_ALL: "C" } },
      (err, out) => resolve(err ? null : (out as Buffer)));
  });
}

function insideRoot(root: string, file: string): string {
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(t("m.outside", { path: file }));
  return full;
}

const dataUrl = (buf: Buffer | null, mime: string) => (buf && buf.length <= IMAGE_MAX_BYTES ? `data:${mime};base64,${buf.toString("base64")}` : null);

function cut(text: string, full: boolean): { text: string; omitted: number } {
  const lines = text.replace(/\n$/, "").split("\n");
  if (full || lines.length <= DIFF_MAX_LINES) return { text: lines.join("\n"), omitted: 0 };
  return { text: lines.slice(0, DIFF_MAX_LINES).join("\n"), omitted: lines.length - DIFF_MAX_LINES };
}

/** commit 이 있으면 그 커밋이 바꾼 내용, 없으면 HEAD 와 작업 영역의 차이 */
export async function fileDiff(root: string, file: string, commit: string | null, opts: DiffOptions = {}): Promise<FileDiff> {
  const full = insideRoot(root, file);
  const ws = opts.ignoreWhitespace ? ["-w"] : [];
  const args = commit
    ? ["show", "--format=", "--no-color", "--first-parent", ...ws, commit, "--", file]
    : ["diff", "--no-color", ...ws, "HEAD", "--", file];
  let text = (await git(root, args, { allowFail: true })) || "";
  let untracked = false;
  if (!commit && !text && fs.existsSync(full)) {
    const tracked = await git(root, ["ls-files", "--error-unmatch", "--", file], { allowFail: true });
    if (tracked === null) { // 아직 추적하지 않는 새 파일: 내용 전체를 추가로 보여 준다
      untracked = true;
      const buf = fs.readFileSync(full);
      if (!buf.includes(0)) {
        const body = buf.toString("utf8").replace(/\n$/, "").split("\n");
        text = `${t("m.newFile", { path: file })}\n@@ -0,0 +1,${body.length} @@\n` + body.map((l) => "+" + l).join("\n");
      } else text = `Binary files /dev/null and b/${file} differ`;
    }
  }
  const binary = /^Binary files .* differ$/m.test(text) && !/^@@ /m.test(text);
  const mime = IMAGE_TYPES[path.extname(file).toLowerCase()];
  let image: FileDiff["image"];
  if (mime && (binary || mime === "image/svg+xml")) {
    const before = untracked ? null : await blob(root, commit ? `${commit}^:${file}` : `HEAD:${file}`);
    const after = commit ? await blob(root, `${commit}:${file}`) : fs.existsSync(full) ? fs.readFileSync(full) : null;
    image = { before: dataUrl(before, mime), after: dataUrl(after, mime) };
  }
  const { text: shown, omitted } = binary ? { text: "", omitted: 0 } : cut(text, !!opts.full);
  return { text: shown, omitted, binary, image, untracked };
}
