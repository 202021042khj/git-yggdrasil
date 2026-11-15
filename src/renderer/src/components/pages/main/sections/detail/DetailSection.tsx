import "./DetailSection.css";

import { useEffect, useState, type KeyboardEvent } from "react";

import useAsync from "@/hooks/useAsync";
import useSmallStore from "@/hooks/useSmallStore";
import { short } from "@/lib/html";
import { fullTime, relTime } from "@/lib/time";
import { run } from "@/app/actions";
import { store, type DetailTab } from "@/app/store";
import { splitRows, type SideCell } from "@/model/diffView";
import { ownerBranch, pushedSet, stems } from "@/model/graph";
import { oldestFirst } from "@/model/selection";
import ConflictEditor from "@/components/pages/main/sections/detail/ConflictEditor";
import { diffPrefsStore, reword, setDiffPrefs } from "@/components/pages/main/sections/detail/detailUtils";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";
import type { FileDiff, Hunk } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

interface DetailSectionProps extends UseMainLogicResult {
  onGoto: (id: string) => void;
}

const lineClass = (l: string) => (/^(\+\+\+|---|diff |index )/.test(l) ? "ctx" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx");

const Loading = () => <p className="muted">불러오는 중…</p>;

// ---------- diff ----------
const SplitTable = ({ text }: { text: string }) => {
  const cell = (c: SideCell | null, k: string) => c
    ? [<td key={`${k}n`} className="no">{c.no}</td>, <td key={`${k}t`} className={c.kind}>{c.text || " "}</td>]
    : [<td key={`${k}n`} className="no" />, <td key={`${k}t`} className="empty" />];
  return (
    <table className="split">
      <colgroup><col className="nc" /><col /><col className="nc" /><col /></colgroup>
      <tbody>
        {splitRows(text).map((r, i) => r.kind === "hunk"
          ? <tr key={i} className="sh"><td colSpan={4}>{r.header}</td></tr>
          : <tr key={i}>{cell(r.left, "l")}{cell(r.right, "r")}</tr>)}
      </tbody>
    </table>
  );
};

const DiffBody = ({ d, onFull }: { d: FileDiff; onFull: () => void }) => {
  const prefs = useSmallStore(diffPrefsStore);
  const img = d.image && (
    <div className="img-diff">
      {d.image.before && <figure><figcaption>전</figcaption><img src={d.image.before} alt="바뀌기 전 이미지" /></figure>}
      {d.image.after
        ? <figure><figcaption>{d.image.before ? "후" : "새 파일"}</figcaption><img src={d.image.after} alt="바뀐 뒤 이미지" /></figure>
        : <p className="muted">이 파일은 지워졌습니다.</p>}
    </div>
  );
  if (d.binary) return img || <p className="muted">바이너리 파일이라 내용을 비교해 보여 줄 수 없습니다.</p>;
  return (
    <>
      {img}
      {/git-lfs\.github\.com\/spec/.test(d.text) && <p className="muted ex-note">Git LFS 포인터 파일입니다. 실제 내용은 LFS 서버에 있고, 여기에는 크기와 해시만 바뀐 것으로 보입니다.</p>}
      {!d.text
        ? <p className="muted">{prefs.ignoreWhitespace ? "공백 말고는 바뀐 내용이 없습니다." : "변경 내용 없음"}</p>
        : prefs.split ? <SplitTable text={d.text} />
        : <pre>{d.text.split("\n").map((l, i) => <span key={i} className={lineClass(l)}>{l}</span>)}</pre>}
      {!!d.omitted && <button type="button" className="small more-diff" onClick={onFull}>{d.omitted.toLocaleString()}줄 더 보기 (전체)</button>}
    </>
  );
};

const DiffBox = ({ file, commit, repo }: { file: string; commit: string | null; repo: RepoState }) => {
  const prefs = useSmallStore(diffPrefsStore);
  // 다른 파일·커밋이면 부모가 key 를 바꿔 새로 만든다 ("전체 보기" 도 처음으로)
  const [full, setFull] = useState(false);
  const { data, error, loading } = useAsync(() => window.gitApi.diff(file, commit, { ignoreWhitespace: prefs.ignoreWhitespace, full }), [file, commit, prefs.ignoreWhitespace, full, repo]);

  return (
    <div className="diff">
      <div className="dh">
        <span className="dt">{file}</span>
        <span className="diff-tools">
          <span className="seg" role="group" aria-label="diff 보기 방식">
            <button type="button" className="small" aria-pressed={!prefs.split} onClick={() => setDiffPrefs({ split: false })}>통합</button>
            <button type="button" className="small" aria-pressed={prefs.split} onClick={() => setDiffPrefs({ split: true })}>좌우</button>
          </span>
          <label className="muted"><input type="checkbox" checked={prefs.ignoreWhitespace} onChange={(e) => setDiffPrefs({ ignoreWhitespace: e.target.checked })} /> 공백 무시</label>
        </span>
      </div>
      {loading ? <Loading /> : error ? <p className="muted">{error}</p> : data && <DiffBody d={data} onFull={() => setFull(true)} />}
    </div>
  );
};

// ---------- 변경 덩어리 · 줄 단위 stage ----------
const HunkBlock = ({ h, file, staged }: { h: Hunk; file: string; staged: boolean }) => {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const verb = staged ? "unstage" : "stage";

  return (
    <div className="hunk">
      <div className="hunk-head">
        <code>{h.header}</code>
        {!!picked.size && (
          <button type="button" className="small" onClick={() => void run({ op: "stageHunk", args: [file, h.index, staged, [...picked]], summary: `${file} 의 고른 ${picked.size}줄 ${verb}` })}>
            고른 {picked.size}줄만 {verb}
          </button>
        )}
        <button type="button" className="small" onClick={() => void run({ op: "stageHunk", args: [file, h.index, staged], summary: `${file} 의 변경 덩어리 ${verb}` })}>
          {staged ? "이 덩어리 unstage" : "이 덩어리만 stage"}
        </button>
      </div>
      <pre>
        {h.lines.map((l, i) => /^[+-]/.test(l)
          ? (
            <span
              key={i}
              className={`${lineClass(l)} pick`}
              role="checkbox"
              aria-checked={picked.has(i)}
              tabIndex={0}
              title="클릭해서 이 줄 고르기"
              onClick={() => toggle(i)}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(i); } }}
            >
              {l}
            </span>
          )
          : <span key={i} className={lineClass(l)}>{l}</span>)}
      </pre>
    </div>
  );
};

const HunkList = ({ file, repo }: { file: string; repo: RepoState }) => {
  const { data } = useAsync(() => Promise.all([window.gitApi.hunks(file, false), window.gitApi.hunks(file, true)]), [file, repo]);
  if (!data) return null;
  const [unstaged, staged] = data;
  if (!unstaged.length && !staged.length) return null;
  return (
    <>
      {!!unstaged.length && <><h4>아직 stage 안 한 변경 ({unstaged.length}덩어리)</h4>{unstaged.map((h) => <HunkBlock key={`u${h.index}${h.header}`} h={h} file={file} staged={false} />)}</>}
      <p className="muted hint">+/- 줄을 클릭(또는 Space)해서 고르면 그 줄만 stage 할 수 있습니다.</p>
      {!!staged.length && <><h4>stage 한 변경 ({staged.length}덩어리)</h4>{staged.map((h) => <HunkBlock key={`s${h.index}${h.header}`} h={h} file={file} staged />)}</>}
    </>
  );
};

// ---------- 파일 히스토리 · blame ----------
const HistoryList = ({ file, onGoto }: { file: string; onGoto: (id: string) => void }) => {
  const { data, error, loading } = useAsync(() => window.gitApi.fileHistory(file), [file]);
  if (loading) return <Loading />;
  if (error) return <p className="muted">{error}</p>;
  if (!data?.length) return <p className="muted">이 파일을 바꾼 커밋이 없습니다.</p>;
  return (
    <ol className="hist">
      {data.map((h) => (
        <li key={h.id}>
          <button type="button" className="link" onClick={() => onGoto(h.id)}>{h.msg}</button>
          <span className="muted">{short(h.id)} · {h.author || ""} · {relTime(h.date)}{h.path !== file && ` · 당시 이름 ${h.path}`}</span>
        </li>
      ))}
    </ol>
  );
};

const BlameView = ({ file, commit, onGoto }: { file: string; commit: string | null; onGoto: (id: string) => void }) => {
  const { data, error, loading } = useAsync(() => window.gitApi.blame(file, commit), [file, commit]);
  if (loading) return <Loading />;
  if (error) return <p className="muted">{error}</p>;
  return (
    <div className="blame">
      {data?.map((l, i) => {
        const first = i === 0 || data[i - 1].commit !== l.commit;
        return (
          <div key={i} className={`bl${first ? " first" : ""}`}>
            <span className="bl-meta">
              {first && <><button type="button" className="link" title={l.summary} onClick={() => onGoto(l.commit)}>{short(l.commit)}</button> {l.author} · {relTime(l.date)}</>}
            </span>
            <span className="bl-no">{l.line}</span>
            <code className="bl-text">{l.text}</code>
          </div>
        );
      })}
    </div>
  );
};

const TABS: Array<[DetailTab, string]> = [["diff", "변경"], ["history", "히스토리"], ["blame", "blame"]];

const FileView = ({ path, commit, tab, repo, onGoto }: { path: string; commit: string | null; tab: DetailTab; repo: RepoState; onGoto: (id: string) => void }) => {
  const isWorking = !commit;
  const inStaged = repo.working.staged.includes(path), inUnstaged = repo.working.unstaged.includes(path);
  const changed = isWorking && (inStaged || inUnstaged);
  const where = changed ? (inStaged ? (inUnstaged ? " · 일부 stage" : " · Staged") : " · Unstaged") : "";

  return (
    <div className="file-view">
      <div className="kv">
        <b>{path}</b> {isWorking ? <span className="muted">· 작업 영역{where}</span> : <span className="muted">· {short(commit!)} 에서</span>}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={k === tab} onClick={() => store.update({ detailTab: k })}>{label}</button>
        ))}
      </div>
      {tab === "history" ? <HistoryList file={path} onGoto={onGoto} />
        : tab === "blame" ? <BlameView file={path} commit={commit} onGoto={onGoto} />
        : isWorking
          ? changed ? <><DiffBox key={`work:${path}`} file={path} commit={null} repo={repo} /><HunkList file={path} repo={repo} /></> : <p className="muted">작업 영역에서 바뀌지 않은 파일입니다. 히스토리나 blame 을 보세요.</p>
          : <DiffBox key={`${commit}:${path}`} file={path} commit={commit} repo={repo} />}
    </div>
  );
};

// ---------- 충돌 ----------
const ConflictPanel = ({ repo, selectedPath }: { repo: RepoState; selectedPath: string | null }) => {
  const o = repo.op;
  if (!o || o.kind === "split" || !o.conflicts.length) return null;
  const focus = selectedPath && o.conflicts.includes(selectedPath) ? selectedPath : o.conflicts.find((f) => !o.resolved[f]) || o.conflicts[0];
  const how = { ours: "A 쪽", theirs: "B 쪽", both: "외부 에디터" } as const;

  const resolve = (f: string, choice: keyof typeof how) => {
    store.update({ selectedFile: { path: f, commit: null } });
    void run({ op: "resolveFile", args: [f, choice], summary: `${f}: ${how[choice]}` });
  };
  const choiceBtn = (f: string, choice: keyof typeof how, text: string) => (
    <button type="button" className={o.resolved[f] === choice ? "on" : undefined} onClick={() => resolve(f, choice)}>{text}</button>
  );

  return (
    <div className="conflict-box">
      <h4>⚠ 충돌 해결 — 파일마다 어느 쪽을 쓸지 고르세요</h4>
      <div className="cf-side">A = {o.oursName}<br />B = {o.theirsName}</div>
      {o.kind === "rebase" && (
        <div className="cf-side">※ rebase 중에는 git 의 <code>--ours</code> 가 <b>대상(받는 쪽)</b>, <code>--theirs</code> 가 <b>내 커밋</b>입니다. 버튼은 의미대로 표시했습니다.</div>
      )}
      {o.conflicts.map((f) => (
        <div key={f} className="cf-file">
          <button type="button" className={`cf-name link${o.resolved[f] ? " done" : ""}`} data-cf={f} onClick={() => store.update({ selectedFile: { path: f, commit: null } })}>
            {o.resolved[f] ? "✓" : "⚠"} {f}
          </button>
          <div className="cf-actions">{choiceBtn(f, "ours", "A 쪽 사용")}{choiceBtn(f, "theirs", "B 쪽 사용")}{choiceBtn(f, "both", "외부 에디터로")}</div>
        </div>
      ))}
      {focus && !o.resolved[focus] && <><h4>{focus} — 구간별로 고르기</h4><ConflictEditor key={focus} file={focus} repo={repo} /></>}
    </div>
  );
};

// ---------- 커밋 ----------
const CommitView = ({ id, repo, ui, onGoto }: { id: string; repo: RepoState; ui: UseMainLogicResult["ui"]; onGoto: (id: string) => void }) => {
  const c = repo.commits[id];
  const [msg, setMsg] = useState(c.msg);
  useEffect(() => { setMsg(c.msg); }, [c.msg]);
  const st = stems(repo);
  const editable = !!ownerBranch(repo, id, st);
  const tags = Object.values(repo.tags || {}).filter((t) => t.target === id);
  const sel = ui.selectedFile;

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void reword(id, msg);
    if (e.key === "Escape") { setMsg(c.msg); e.currentTarget.blur(); }
  };

  return (
    <>
      <div className="reword">
        <input id="msg-input" value={msg} disabled={!editable} aria-label="커밋 메시지" onChange={(e) => setMsg(e.target.value)} onKeyDown={handleKey} />
        <button type="button" id="msg-save" className="small" title="Enter" disabled={!editable} onClick={() => void reword(id, msg)}>메시지 수정</button>
      </div>
      {pushedSet(repo).has(id) && <div className="kv lock-note">push 된 커밋 — 수정하면 force push 가 필요합니다</div>}
      <div className="kv"><code>{c.id}</code></div>
      {c.author && <div className="kv">작성자: {c.author}</div>}
      {c.date && <div className="kv" title={fullTime(c.date)}>날짜: {relTime(c.date)} · {fullTime(c.date)}</div>}
      <div className="kv">줄기: {st.owner.get(id) || "(브랜치 없음)"}</div>
      {!!tags.length && (
        <div className="kv">태그: {tags.map((t, i) => <span key={t.name}>{i > 0 && ", "}<code>{t.name}</code>{t.message && ` ${t.message}`}</span>)}</div>
      )}
      <div className="kv">
        부모: {c.parents.length
          ? c.parents.map((x, i) => <span key={x}>{i > 0 && ", "}<button type="button" className="link" onClick={() => onGoto(x)}><code>{short(x)}</code></button></span>)
          : "없음 (첫 커밋)"}
      </div>
      <div className="kv">
        파일 (클릭하면 diff):<br />
        {c.files.length
          ? c.files.map((f, i) => <span key={f}>{i > 0 && <br />}<button type="button" className="file-link link" onClick={() => store.update({ selectedFile: { path: f, commit: id }, detailTab: "diff" })}>{f}</button></span>)
          : "- (merge 커밋)"}
      </div>
      {sel && sel.commit === id && <FileView path={sel.path} commit={id} tab={ui.detailTab} repo={repo} onGoto={onGoto} />}
    </>
  );
};

/** 여러 커밋을 골랐을 때: 목록과 할 수 있는 일 안내 */
const MultiView = ({ ids, repo, onGoto }: { ids: string[]; repo: RepoState; onGoto: (id: string) => void }) => {
  const sorted = oldestFirst(repo, ids);
  return (
    <div className="multi-view">
      <h4>커밋 {sorted.length}개 선택됨</h4>
      <ol className="hist">
        {sorted.map((id) => (
          <li key={id}>
            <button type="button" className="link" onClick={() => onGoto(id)}>{repo.commits[id].msg}</button>
            <span className="muted">{short(id)}{repo.commits[id].author && ` · ${repo.commits[id].author}`}</span>
          </li>
        ))}
      </ol>
      <p className="muted hint">고른 커밋 중 하나를 다른 브랜치 이름표에 끌어 놓거나 오른쪽 클릭하면, 오래된 것부터 한꺼번에 복사(cherry-pick)합니다. ⌘ 클릭으로 더하거나 빼고, Shift 클릭은 같은 브랜치에서 범위를 고릅니다. Esc 로 선택을 풉니다.</p>
      <button type="button" className="small" onClick={() => store.update({ multi: [] })}>선택 풀기</button>
    </div>
  );
};

/** 상세 패널: 커밋 정보 · 메시지 수정 · 파일 diff · 파일 히스토리 · blame · 변경 덩어리 stage · 충돌 해결 */
const DetailSection = ({ ui, repo, onGoto }: DetailSectionProps) => {
  const c = ui.selected ? repo.commits[ui.selected] : null;
  const conflict = <ConflictPanel repo={repo} selectedPath={ui.selectedFile?.path ?? null} />;

  return (
    <div id="detail-body">
      {conflict}
      {ui.multi.length > 1 ? <MultiView ids={ui.multi} repo={repo} onGoto={onGoto} />
        : c ? <CommitView key={c.id} id={c.id} repo={repo} ui={ui} onGoto={onGoto} />
        : ui.selectedFile && !ui.selectedFile.commit ? <FileView path={ui.selectedFile.path} commit={null} tab={ui.detailTab} repo={repo} onGoto={onGoto} />
        : !repo.op && <span className="muted">커밋이나 파일을 클릭하면 상세 정보와 diff 가 보입니다. ⌘K 로 커밋·파일을 찾을 수 있습니다.</span>}
    </div>
  );
};

export default DetailSection;
