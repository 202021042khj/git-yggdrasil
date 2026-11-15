import "./ConflictEditor.css";

import { useState } from "react";

import useAsync from "@/hooks/useAsync";
import { run } from "@/app/actions";
import { composeResolved, conflictCount, parseConflict, type Choice, type Chunk } from "@/model/conflict";
import type { RepoState } from "@shared/types/repo";

const CHOICES: Array<[Exclude<Choice, null>, string]> = [["ours", "A"], ["theirs", "B"], ["ours-theirs", "A 다음 B"], ["theirs-ours", "B 다음 A"]];

const Lines = ({ lines }: { lines: string[] }) => (
  <pre>{lines.length ? lines.join("\n") : <span className="muted">(비어 있음 — 이쪽에서는 지운 구간)</span>}</pre>
);

const Context = ({ lines }: { lines: string[] }) => {
  const n = lines.length;
  if (n <= 6) return <pre className="ce-ctx">{lines.join("\n")}</pre>;
  return <pre className="ce-ctx">{lines.slice(0, 2).join("\n")}{"\n"}<span className="muted">… {n - 4}줄 같음 …</span>{"\n"}{lines.slice(-2).join("\n")}</pre>;
};

interface EditorProps {
  file: string;
  chunks: Chunk[];
}

const Editor = ({ file, chunks }: EditorProps) => {
  const total = conflictCount(chunks);
  const [choices, setChoices] = useState<Choice[]>(() => Array(total).fill(null));
  /** 직접 고친 결과 (null 이면 고른 구간으로 만든 결과) */
  const [text, setText] = useState<string | null>(null);
  const done = choices.filter(Boolean).length;

  const pick = (i: number, v: Choice) => {
    setChoices((cur) => cur.map((c, k) => (k === i ? (c === v ? null : v) : c)));
    setText(null);
  };

  const save = () => void run({ op: "resolveContent", args: [file, text ?? composeResolved(chunks, choices)], summary: `${file}: 충돌 편집기에서 해결` });

  let k = 0;
  return (
    <div className="ce">
      <div className="ce-status">
        {done} / {total} 구간 고름{text !== null && <> · <span className="muted">결과를 직접 고쳤습니다 (구간을 다시 고르면 덮어씁니다)</span></>}
      </div>
      {chunks.map((c, ci) => {
        if (c.kind === "text") return <Context key={ci} lines={c.lines} />;
        const i = k++;
        const ch = choices[i];
        return (
          <div key={ci} className={`ce-conflict${ch ? " picked" : ""}`}>
            <div className="ce-head">
              <b>충돌 {i + 1}</b>
              {CHOICES.map(([v, label]) => (
                <button key={v} type="button" className={`small${ch === v ? " on" : ""}`} aria-pressed={ch === v} onClick={() => pick(i, v)}>{label}</button>
              ))}
            </div>
            <div className="ce-sides">
              <div className="ce-side a"><div className="ce-label">A · {c.oursLabel}</div><Lines lines={c.ours} /></div>
              <div className="ce-side b"><div className="ce-label">B · {c.theirsLabel}</div><Lines lines={c.theirs} /></div>
            </div>
            {c.base && <details><summary>공통 조상 (원래 내용)</summary><Lines lines={c.base} /></details>}
          </div>
        );
      })}
      <label className="ce-result-label" htmlFor="ce-result">결과 (직접 고칠 수 있음)</label>
      <textarea id="ce-result" className="ce-result" spellCheck={false} rows={12} value={text ?? composeResolved(chunks, choices)} onChange={(e) => setText(e.target.value)} />
      <div className="ce-actions"><button type="button" className="primary" data-ce-save onClick={save}>이 내용으로 해결</button></div>
    </div>
  );
};

interface ConflictEditorProps {
  file: string;
  repo: RepoState;
}

/** 앱 안 충돌 편집기: 충돌 구간마다 A / B / 둘 다 를 고르고, 결과를 확인·수정한 뒤 저장하면 해결로 표시한다 */
const ConflictEditor = ({ file }: ConflictEditorProps) => {
  // 고르는 동안 다시 읽지 않도록 파일 이름으로만 읽는다 (저장소가 바뀌어도 고른 것을 유지)
  const { data, error, loading } = useAsync(() => window.gitApi.conflictText(file), [file]);
  if (loading) return <p className="muted">불러오는 중…</p>;
  if (error) return <p className="muted">{error}</p>;
  if (data === null || data === undefined) return <p className="muted">바이너리이거나 너무 큰 파일이라 앱에서 편집할 수 없습니다. A / B 중 하나를 고르세요.</p>;
  const chunks = parseConflict(data);
  if (!conflictCount(chunks)) return <p className="muted">충돌 표시가 없습니다. 이미 고쳤다면 "직접 편집" 을 눌러 해결로 표시하세요.</p>;
  return <Editor file={file} chunks={chunks} />;
};

export default ConflictEditor;
