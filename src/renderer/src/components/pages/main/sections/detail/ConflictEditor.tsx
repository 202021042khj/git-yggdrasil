import "./ConflictEditor.css";

import { useState } from "react";

import useAsync from "@/hooks/useAsync";
import { run } from "@/app/actions";
import { composeResolved, conflictCount, parseConflict, type Choice, type Chunk } from "@/model/conflict";
import { t, type MessageKey } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

const CHOICES: Array<[Exclude<Choice, null>, MessageKey]> = [["ours", "ce.ours"], ["theirs", "ce.theirs"], ["ours-theirs", "ce.oursTheirs"], ["theirs-ours", "ce.theirsOurs"]];

const Lines = ({ lines }: { lines: string[] }) => (
  <pre>{lines.length ? lines.join("\n") : <span className="muted">{t("ce.emptySide")}</span>}</pre>
);

const Context = ({ lines }: { lines: string[] }) => {
  const n = lines.length;
  if (n <= 6) return <pre className="ce-ctx">{lines.join("\n")}</pre>;
  return <pre className="ce-ctx">{lines.slice(0, 2).join("\n")}{"\n"}<span className="muted">{t("ce.same", { n: n - 4 })}</span>{"\n"}{lines.slice(-2).join("\n")}</pre>;
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

  const save = () => void run({ op: "resolveContent", args: [file, text ?? composeResolved(chunks, choices)], summary: t("ce.summary", { file }) });

  let k = 0;
  return (
    <div className="ce">
      <div className="ce-status">
        {t("ce.progress", { done, total })}{text !== null && <> · <span className="muted">{t("ce.edited")}</span></>}
      </div>
      {chunks.map((c, ci) => {
        if (c.kind === "text") return <Context key={ci} lines={c.lines} />;
        const i = k++;
        const ch = choices[i];
        return (
          <div key={ci} className={`ce-conflict${ch ? " picked" : ""}`}>
            <div className="ce-head">
              <b>{t("ce.conflict", { n: i + 1 })}</b>
              {CHOICES.map(([v, label]) => (
                <button key={v} type="button" className={`small${ch === v ? " on" : ""}`} aria-pressed={ch === v} onClick={() => pick(i, v)}>{t(label)}</button>
              ))}
            </div>
            <div className="ce-sides">
              <div className="ce-side a"><div className="ce-label">A · {c.oursLabel}</div><Lines lines={c.ours} /></div>
              <div className="ce-side b"><div className="ce-label">B · {c.theirsLabel}</div><Lines lines={c.theirs} /></div>
            </div>
            {c.base && <details><summary>{t("ce.base")}</summary><Lines lines={c.base} /></details>}
          </div>
        );
      })}
      <label className="ce-result-label" htmlFor="ce-result">{t("ce.result")}</label>
      <textarea id="ce-result" className="ce-result" spellCheck={false} rows={12} value={text ?? composeResolved(chunks, choices)} onChange={(e) => setText(e.target.value)} />
      <div className="ce-actions"><button type="button" className="primary" data-ce-save onClick={save}>{t("ce.save")}</button></div>
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
  if (loading) return <p className="muted">{t("common.loading")}</p>;
  if (error) return <p className="muted">{error}</p>;
  if (data === null || data === undefined) return <p className="muted">{t("ce.binary")}</p>;
  const chunks = parseConflict(data);
  if (!conflictCount(chunks)) return <p className="muted">{t("ce.noMarkers")}</p>;
  return <Editor file={file} chunks={chunks} />;
};

export default ConflictEditor;
