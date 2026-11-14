// 앱 안 충돌 편집기: 충돌 구간마다 A / B / 둘 다 를 고르고, 결과를 확인·수정한 뒤 저장하면 해결로 표시한다
import { run } from "@/app/actions";
import { esc } from "@/lib/html";
import { composeResolved, conflictCount, parseConflict, type Choice, type Chunk } from "@/model/conflict";

interface EditorState { file: string; chunks: Chunk[]; choices: Choice[]; edited: boolean; /** 직접 고친 결과 (다시 그려도 유지) */ text: string | null }
let state: EditorState | null = null;

const CHOICES: Array<[Exclude<Choice, null>, string]> = [["ours", "A"], ["theirs", "B"], ["ours-theirs", "A 다음 B"], ["theirs-ours", "B 다음 A"]];
const pre = (lines: string[]) => `<pre>${lines.length ? lines.map((l) => esc(l)).join("\n") : '<span class="muted">(비어 있음 — 이쪽에서는 지운 구간)</span>'}</pre>`;

function chunksHtml(s: EditorState): string {
  let k = 0;
  return s.chunks.map((c) => {
    if (c.kind === "text") {
      const n = c.lines.length;
      return n > 6 ? `<pre class="ce-ctx">${esc(c.lines.slice(0, 2).join("\n"))}\n<span class="muted">… ${n - 4}줄 같음 …</span>\n${esc(c.lines.slice(-2).join("\n"))}</pre>` : `<pre class="ce-ctx">${esc(c.lines.join("\n"))}</pre>`;
    }
    const i = k++, ch = s.choices[i];
    return `<div class="ce-conflict ${ch ? "picked" : ""}" data-ce-i="${i}">
      <div class="ce-head"><b>충돌 ${i + 1}</b>${CHOICES.map(([v, label]) => `<button type="button" class="small ${ch === v ? "on" : ""}" aria-pressed="${ch === v}" data-ce-pick="${v}">${label}</button>`).join("")}</div>
      <div class="ce-sides"><div class="ce-side a"><div class="ce-label">A · ${esc(c.oursLabel)}</div>${pre(c.ours)}</div>
      <div class="ce-side b"><div class="ce-label">B · ${esc(c.theirsLabel)}</div>${pre(c.theirs)}</div></div>
      ${c.base ? `<details><summary>공통 조상 (원래 내용)</summary>${pre(c.base)}</details>` : ""}</div>`;
  }).join("");
}

function draw(root: HTMLElement): void {
  const s = state!;
  const total = conflictCount(s.chunks), done = s.choices.filter(Boolean).length;
  root.innerHTML = `<div class="ce">
    <div class="ce-status">${done} / ${total} 구간 고름${s.edited ? ` · <span class="muted">결과를 직접 고쳤습니다 (구간을 다시 고르면 덮어씁니다)</span>` : ""}</div>
    ${chunksHtml(s)}
    <label class="ce-result-label" for="ce-result">결과 (직접 고칠 수 있음)</label>
    <textarea id="ce-result" class="ce-result" spellcheck="false" rows="12">${esc(s.text ?? composeResolved(s.chunks, s.choices))}</textarea>
    <div class="ce-actions"><button type="button" class="primary" data-ce-save>이 내용으로 해결</button></div></div>`;
}

/** 편집기 영역 HTML. 파일 내용을 읽어 그 자리에 채운다 */
export async function loadConflictEditor(file: string): Promise<string> {
  const text = await window.gitApi.conflictText(file);
  if (text === null) return `<p class="muted">바이너리이거나 너무 큰 파일이라 앱에서 편집할 수 없습니다. A / B 중 하나를 고르세요.</p>`;
  const chunks = parseConflict(text);
  const total = conflictCount(chunks);
  if (!total) return `<p class="muted">충돌 표시가 없습니다. 이미 고쳤다면 "직접 편집" 을 눌러 해결로 표시하세요.</p>`;
  if (state?.file !== file || state.chunks.length !== chunks.length) state = { file, chunks, choices: Array(total).fill(null), edited: false, text: null };
  const holder = document.createElement("div");
  draw(holder);
  return holder.innerHTML;
}

/** 상세 패널의 클릭 위임에서 부른다. 처리했으면 true */
export function handleConflictEditorClick(target: Element): boolean {
  if (!state) return false;
  const root = target.closest<HTMLElement>("[data-slot=\"conflict-editor\"]");
  if (!root) return false;
  const pick = target.closest<HTMLElement>("[data-ce-pick]");
  if (pick) {
    const i = Number(pick.closest<HTMLElement>("[data-ce-i]")!.dataset.ceI);
    const v = pick.dataset.cePick as Choice;
    state.choices[i] = state.choices[i] === v ? null : v;
    state.edited = false;
    state.text = null;
    draw(root);
    return true;
  }
  if (target.closest("[data-ce-save]")) {
    const text = (root.querySelector("#ce-result") as HTMLTextAreaElement).value;
    const file = state.file;
    void run({ op: "resolveContent", args: [file, text], summary: `${file}: 충돌 편집기에서 해결` }).then((ok) => { if (ok) state = null; });
    return true;
  }
  return false;
}

export function mountConflictEditor(container: HTMLElement): void {
  container.addEventListener("input", (e) => {
    if ((e.target as Element).id !== "ce-result" || !state) return;
    state.text = (e.target as HTMLTextAreaElement).value;
    if (!state.edited) {
      state.edited = true;
      const status = container.querySelector(".ce-status");
      if (status) status.insertAdjacentHTML("beforeend", ` · <span class="muted">결과를 직접 고쳤습니다 (구간을 다시 고르면 덮어씁니다)</span>`);
    }
  });
}
