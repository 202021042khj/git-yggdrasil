import "./IgnoreSection.css";

import { useEffect, useState } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import Dropdown from "@/components/ui/Dropdown";
import RichText from "@/components/common/RichText";
import { errorText } from "@/lib/html";
import { addIgnore, appendCmd, ignoreStore, reloadIgnore, removeIgnore, targetName } from "@/components/pages/main/sections/dialogs/ignoreUtils";
import { t } from "@shared/i18n/i18n";
import type { IgnoreReason, IgnoreTarget } from "@shared/types/ipc";

const TARGETS: IgnoreTarget[] = ["gitignore", "exclude"];
const SHOW = 8;

/** 무시 파일 편집: 패턴 목록 · 추가(걸리는 파일 미리 보기) · 삭제 · 왜 무시되는지 (git check-ignore -v) */
const IgnoreSection = () => {
  const { open, loading, error, files, target, why: whyInit } = useSmallStore(ignoreStore);
  const ref = useModal(open, () => ignoreStore.set((s) => ({ ...s, open: false })));
  const [draft, setDraft] = useState("");
  const [matches, setMatches] = useState<{ untracked: string[]; tracked: string[] } | null>(null);
  const [why, setWhy] = useState("");
  const [reason, setReason] = useState<IgnoreReason | null | undefined>(undefined);
  const [whyError, setWhyError] = useState("");
  const list = files[target];

  useEffect(() => { if (open) { setWhy(whyInit); setReason(undefined); setWhyError(""); } }, [open, whyInit]);

  // 입력한 패턴이 걸리는 파일 (잠깐 멈춘 뒤 한 번만 묻는다)
  useEffect(() => {
    const p = draft.trim() ? draft : "";
    if (!p) { setMatches(null); return; }
    let alive = true;
    const timer = setTimeout(() => {
      window.gitApi.ignoreMatches(p).then((m) => { if (alive) setMatches(m); }, () => { if (alive) setMatches(null); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [draft]);

  const add = async () => {
    if (!draft.trim()) return;
    if (await addIgnore(draft, target)) { setDraft(""); await reloadIgnore(); }
  };
  const remove = async (p: string) => { if (await removeIgnore(p, target)) await reloadIgnore(); };
  const check = async () => {
    if (!why.trim()) return;
    setWhyError("");
    try { setReason(await window.gitApi.ignoreWhy(why.trim())); } catch (err) { setReason(undefined); setWhyError(errorText(err)); }
  };

  return (
    <dialog id="ignore" ref={ref} className="ask ignore" aria-labelledby="ignore-title">
      <div className="pr-head">
        <h2 id="ignore-title">{t("ig.title")}</h2>
        <Dropdown id="ignore-target" label={t("ig.target")} value={target} options={TARGETS.map((v) => ({ value: v, label: targetName(v) }))}
          onChange={(v) => ignoreStore.set((s) => ({ ...s, target: v }))} />
      </div>
      <p className="muted"><RichText text={t("ig.help")} /></p>
      <ul id="ignore-list" className="ig-list" aria-label={targetName(target)}>
        {loading && !list.length ? <li className="muted">{t("common.loading")}</li>
          : error ? <li className="muted">{error}</li>
          : list.length ? list.map((p, i) => (
            <li key={`${p}-${i}`} className="ig-row">
              <code>{p}</code>
              <button type="button" className="small" aria-label={`${t("ig.remove")} ${p}`} onClick={() => void remove(p)}>{t("ig.remove")}</button>
            </li>
          )) : <li className="muted">{t("ig.empty")}</li>}
      </ul>
      <form className="ig-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label htmlFor="ignore-new">{t("ig.addLabel")}</label>
        <div className="ig-line">
          <input id="ignore-new" value={draft} spellCheck={false} placeholder="*.log" onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="primary" disabled={!draft.trim()}>{t("ig.add")}</button>
        </div>
        {draft.trim() && <code className="ig-cmd muted">{appendCmd(draft, target)}</code>}
        {matches && (
          <div className="ig-matches muted" aria-live="polite">
            {!matches.untracked.length && !matches.tracked.length ? <p>{t("ig.noMatch")}</p> : null}
            {matches.untracked.length > 0 && <p>{t("ig.matches", { n: matches.untracked.length })}: {matches.untracked.slice(0, SHOW).join(", ")}{matches.untracked.length > SHOW ? " …" : ""}</p>}
            {matches.tracked.length > 0 && <p>{t("ig.matchTracked", { n: matches.tracked.length })}: {matches.tracked.slice(0, SHOW).join(", ")}{matches.tracked.length > SHOW ? " …" : ""}</p>}
          </div>
        )}
      </form>
      <form className="ig-add" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <label htmlFor="ignore-why">{t("ig.whyLabel")}</label>
        <div className="ig-line">
          <input id="ignore-why" value={why} spellCheck={false} placeholder="build/out.log" onChange={(e) => { setWhy(e.target.value); setReason(undefined); }} />
          <button type="submit" disabled={!why.trim()}>{t("ig.whyCheck")}</button>
        </div>
        {why.trim() && <code className="ig-cmd muted">git check-ignore -v --no-index -- {why.trim()}</code>}
        <p className="muted" aria-live="polite">
          {whyError || (reason === undefined ? "" : reason === null ? t("ig.whyNot")
            : t(reason.negated ? "ig.whyNegated" : "ig.whyHit", { source: reason.source, line: reason.line, pattern: reason.pattern }))}
        </p>
      </form>
      <div className="ask-actions"><button type="button" id="ignore-close" onClick={() => ref.current?.close()}>{t("common.close")}</button></div>
    </dialog>
  );
};

export default IgnoreSection;
