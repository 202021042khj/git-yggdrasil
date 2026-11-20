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
import { t, type MessageKey } from "@shared/i18n/i18n";
import RichText from "@/components/common/RichText";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";
import type { FileDiff, Hunk } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

interface DetailSectionProps extends UseMainLogicResult {
  onGoto: (id: string) => void;
}

const lineClass = (l: string) => (/^(\+\+\+|---|diff |index )/.test(l) ? "ctx" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx");

const Loading = () => <p className="muted">{t("common.loading")}</p>;

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
      {d.image.before && <figure><figcaption>{t("dt.before")}</figcaption><img src={d.image.before} alt={t("dt.beforeAlt")} /></figure>}
      {d.image.after
        ? <figure><figcaption>{d.image.before ? t("dt.after") : t("dt.newFile")}</figcaption><img src={d.image.after} alt={t("dt.afterAlt")} /></figure>
        : <p className="muted">{t("dt.deleted")}</p>}
    </div>
  );
  if (d.binary) return img || <p className="muted">{t("dt.binary")}</p>;
  return (
    <>
      {img}
      {/git-lfs\.github\.com\/spec/.test(d.text) && <p className="muted ex-note">{t("dt.lfsPointer")}</p>}
      {!d.text
        ? <p className="muted">{prefs.ignoreWhitespace ? t("dt.onlyWhitespace") : t("dt.noDiff")}</p>
        : prefs.split ? <SplitTable text={d.text} />
        : <pre>{d.text.split("\n").map((l, i) => <span key={i} className={lineClass(l)}>{l}</span>)}</pre>}
      {!!d.omitted && <button type="button" className="small more-diff" onClick={onFull}>{t("dt.showMore", { n: d.omitted })}</button>}
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
          <span className="seg" role="group" aria-label={t("dt.diffMode")}>
            <button type="button" className="small" aria-pressed={!prefs.split} onClick={() => setDiffPrefs({ split: false })}>{t("dt.unified")}</button>
            <button type="button" className="small" aria-pressed={prefs.split} onClick={() => setDiffPrefs({ split: true })}>{t("dt.split")}</button>
          </span>
          <label className="muted"><input type="checkbox" checked={prefs.ignoreWhitespace} onChange={(e) => setDiffPrefs({ ignoreWhitespace: e.target.checked })} /> {t("dt.ignoreWs")}</label>
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

  return (
    <div className="hunk">
      <div className="hunk-head">
        <code>{h.header}</code>
        {!!picked.size && (
          <button type="button" className="small" onClick={() => void run({ op: "stageHunk", args: [file, h.index, staged, [...picked]], summary: staged ? t("dt.unstageLinesSummary", { file, n: picked.size }) : t("dt.stageLinesSummary", { file, n: picked.size }) })}>
            {staged ? t("dt.unstageLines", { n: picked.size }) : t("dt.stageLines", { n: picked.size })}
          </button>
        )}
        <button type="button" className="small" onClick={() => void run({ op: "stageHunk", args: [file, h.index, staged], summary: staged ? t("dt.unstageHunkSummary", { file }) : t("dt.stageHunkSummary", { file }) })}>
          {staged ? t("dt.unstageHunk") : t("dt.stageHunk")}
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
              title={t("dt.pickLine")}
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
      {!!unstaged.length && <><h4>{t("dt.unstagedHunks", { n: unstaged.length })}</h4>{unstaged.map((h) => <HunkBlock key={`u${h.index}${h.header}`} h={h} file={file} staged={false} />)}</>}
      <p className="muted hint">{t("dt.lineHint")}</p>
      {!!staged.length && <><h4>{t("dt.stagedHunks", { n: staged.length })}</h4>{staged.map((h) => <HunkBlock key={`s${h.index}${h.header}`} h={h} file={file} staged />)}</>}
    </>
  );
};

// ---------- 파일 히스토리 · blame ----------
const HistoryList = ({ file, onGoto }: { file: string; onGoto: (id: string) => void }) => {
  const { data, error, loading } = useAsync(() => window.gitApi.fileHistory(file), [file]);
  if (loading) return <Loading />;
  if (error) return <p className="muted">{error}</p>;
  if (!data?.length) return <p className="muted">{t("dt.noHistory")}</p>;
  return (
    <ol className="hist">
      {data.map((h) => (
        <li key={h.id}>
          <button type="button" className="link" onClick={() => onGoto(h.id)}>{h.msg}</button>
          <span className="muted">{short(h.id)} · {h.author || ""} · {relTime(h.date)}{h.path !== file && t("dt.renamedFrom", { path: h.path })}</span>
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

const TABS: Array<[DetailTab, MessageKey]> = [["diff", "dt.tab.diff"], ["history", "dt.tab.history"], ["blame", "dt.tab.blame"]];

const FileView = ({ path, commit, tab, repo, onGoto }: { path: string; commit: string | null; tab: DetailTab; repo: RepoState; onGoto: (id: string) => void }) => {
  const isWorking = !commit;
  const inStaged = repo.working.staged.includes(path), inUnstaged = repo.working.unstaged.includes(path);
  const changed = isWorking && (inStaged || inUnstaged);
  const where = changed ? (inStaged ? (inUnstaged ? t("dt.partlyStaged") : " · Staged") : " · Unstaged") : "";

  return (
    <div className="file-view">
      <div className="kv">
        <b>{path}</b> {isWorking ? <span className="muted">· {t("target.working")}{where}</span> : <span className="muted">· {t("dt.inCommit", { id: short(commit!) })}</span>}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={k === tab} onClick={() => store.update({ detailTab: k })}>{t(label)}</button>
        ))}
      </div>
      {tab === "history" ? <HistoryList file={path} onGoto={onGoto} />
        : tab === "blame" ? <BlameView file={path} commit={commit} onGoto={onGoto} />
        : isWorking
          ? changed ? <><DiffBox key={`work:${path}`} file={path} commit={null} repo={repo} /><HunkList file={path} repo={repo} /></> : <p className="muted">{t("dt.unchanged")}</p>
          : <DiffBox key={`${commit}:${path}`} file={path} commit={commit} repo={repo} />}
    </div>
  );
};

// ---------- 충돌 ----------
const ConflictPanel = ({ repo, selectedPath }: { repo: RepoState; selectedPath: string | null }) => {
  const o = repo.op;
  if (!o || o.kind === "split" || !o.conflicts.length) return null;
  const focus = selectedPath && o.conflicts.includes(selectedPath) ? selectedPath : o.conflicts.find((f) => !o.resolved[f]) || o.conflicts[0];
  const how = { ours: t("dt.how.ours"), theirs: t("dt.how.theirs"), both: t("dt.how.both") };

  const resolve = (f: string, choice: keyof typeof how) => {
    store.update({ selectedFile: { path: f, commit: null } });
    void run({ op: "resolveFile", args: [f, choice], summary: `${f}: ${how[choice]}` });
  };
  const choiceBtn = (f: string, choice: keyof typeof how, text: string) => (
    <button type="button" className={o.resolved[f] === choice ? "on" : undefined} onClick={() => resolve(f, choice)}>{text}</button>
  );

  return (
    <div className="conflict-box">
      <h4>{t("dt.conflictTitle")}</h4>
      <div className="cf-side">A = {o.oursName}<br />B = {o.theirsName}</div>
      {o.kind === "rebase" && (
        <div className="cf-side"><RichText text={t("dt.rebaseNote")} /></div>
      )}
      {o.conflicts.map((f) => (
        <div key={f} className="cf-file">
          <button type="button" className={`cf-name link${o.resolved[f] ? " done" : ""}`} data-cf={f} onClick={() => store.update({ selectedFile: { path: f, commit: null } })}>
            {o.resolved[f] ? "✓" : "⚠"} {f}
          </button>
          <div className="cf-actions">{choiceBtn(f, "ours", t("dt.useOurs"))}{choiceBtn(f, "theirs", t("dt.useTheirs"))}{choiceBtn(f, "both", t("dt.useEditor"))}</div>
        </div>
      ))}
      {focus && !o.resolved[focus] && <><h4>{t("dt.byHunk", { file: focus })}</h4><ConflictEditor key={focus} file={focus} repo={repo} /></>}
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
        <input id="msg-input" value={msg} disabled={!editable} aria-label={t("drag.commitMsg")} onChange={(e) => setMsg(e.target.value)} onKeyDown={handleKey} />
        <button type="button" id="msg-save" className="small" title="Enter" disabled={!editable} onClick={() => void reword(id, msg)}>{t("dt.reword")}</button>
      </div>
      {pushedSet(repo).has(id) && <div className="kv lock-note">{t("dt.pushedNote")}</div>}
      <div className="kv"><code>{c.id}</code></div>
      {c.author && <div className="kv">{t("dt.author", { author: c.author })}</div>}
      {c.date && <div className="kv" title={fullTime(c.date)}>{t("dt.date", { rel: relTime(c.date), full: fullTime(c.date) })}</div>}
      <div className="kv">{t("dt.stem", { stem: st.owner.get(id) || t("dt.noBranch") })}</div>
      {!!tags.length && (
        <div className="kv">{t("dt.tags")} {tags.map((tag, i) => <span key={tag.name}>{i > 0 && ", "}<code>{tag.name}</code>{tag.message && ` ${tag.message}`}</span>)}</div>
      )}
      <div className="kv">
        {t("dt.parents")} {c.parents.length
          ? c.parents.map((x, i) => <span key={x}>{i > 0 && ", "}<button type="button" className="link" onClick={() => onGoto(x)}><code>{short(x)}</code></button></span>)
          : t("dt.noParents")}
      </div>
      <div className="kv">
        {t("dt.files")}<br />
        {c.files.length
          ? c.files.map((f, i) => <span key={f}>{i > 0 && <br />}<button type="button" className="file-link link" onClick={() => store.update({ selectedFile: { path: f, commit: id }, detailTab: "diff" })}>{f}</button></span>)
          : t("dt.mergeFiles")}
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
      <h4>{t("dt.multi", { n: sorted.length })}</h4>
      <ol className="hist">
        {sorted.map((id) => (
          <li key={id}>
            <button type="button" className="link" onClick={() => onGoto(id)}>{repo.commits[id].msg}</button>
            <span className="muted">{short(id)}{repo.commits[id].author && ` · ${repo.commits[id].author}`}</span>
          </li>
        ))}
      </ol>
      <p className="muted hint">{t("dt.multiHint")}</p>
      <button type="button" className="small" onClick={() => store.update({ multi: [] })}>{t("ctx.clearSelection")}</button>
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
        : !repo.op && <span className="muted">{t("dt.empty")}</span>}
    </div>
  );
};

export default DetailSection;
