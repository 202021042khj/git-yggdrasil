import "./FilterSection.css";

import { useEffect, useRef, useState } from "react";

import Dropdown from "@/components/ui/Dropdown";
import { store } from "@/app/store";
import { dimmedCommits, isFiltering, NO_FILTER, visibleRepo, type GraphFilter } from "@/model/filter";
import { t } from "@shared/i18n/i18n";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

const DAY = 24 * 60 * 60 * 1000;
const sinceOptions = () => [
  { value: "", label: t("filter.since.all") },
  { value: "7", label: t("filter.since.7") },
  { value: "30", label: t("filter.since.30") },
  { value: "90", label: t("filter.since.90") },
  { value: "365", label: t("filter.since.365") },
];

const setFilter = (patch: Partial<GraphFilter>) => store.update({ filter: { ...store.ui.filter, ...patch } });

/** 그래프 필터 막대: 브랜치 고르기(나머지 숨김) · 작성자 · 기간(맞지 않는 커밋 흐리게) */
const FilterSection = ({ ui, repo }: UseMainLogicResult) => {
  const f = ui.filter;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [author, setAuthor] = useState(f.author);
  // 기간은 "며칠" 로 기억한다 (filter.since 는 계산한 시각이라 되돌려 읽을 수 없다)
  const [sinceDays, setSinceDays] = useState("");

  // 필터를 밖에서 풀면(해제 버튼 · 저장소 바꾸기) 입력칸도 비운다
  useEffect(() => { setAuthor(f.author); }, [f.author]);
  useEffect(() => { if (f.since === null) setSinceDays(""); }, [f.since]);

  // 작성자는 입력이 잠깐 멈추면 적용
  useEffect(() => {
    if (author === store.ui.filter.author) return;
    const t = setTimeout(() => setFilter({ author }), 200);
    return () => clearTimeout(t);
  }, [author]);

  // 바깥을 누르면 브랜치 목록을 닫는다
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const d = detailsRef.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const all = Object.keys(repo.branches).sort();
  const chosen = f.branches ? new Set(f.branches) : null;
  const shownBranches = chosen ? all.filter((b) => chosen.has(b) || b === repo.head).length : all.length;

  const toggleBranch = (b: string, on: boolean) => {
    const cur = new Set(f.branches ?? all);
    if (on) cur.add(b); else cur.delete(b);
    setFilter({ branches: all.every((x) => cur.has(x) || x === repo.head) ? null : [...cur] });
  };

  const handleSince = (days: string) => {
    setSinceDays(days);
    setFilter({ since: days ? Date.now() - Number(days) * DAY : null });
  };

  const filtering = isFiltering(f);
  let summary = "";
  if (filtering) {
    const vis = visibleRepo(repo, f);
    const total = Object.keys(vis.commits).length;
    const dim = dimmedCommits(vis, f).size;
    const hidden = Object.keys(repo.commits).length - total;
    summary = [hidden && t("filter.hidden", { n: hidden }), (f.author.trim() || f.since !== null) && t("filter.matching", { n: total - dim })].filter(Boolean).join(" · ");
  }

  return (
    <div className="filter-bar" role="search" aria-label={t("filter.aria")}>
      <details id="filter-branches" ref={detailsRef} className={`filter-branches${chosen ? " on" : ""}`}>
        <summary id="filter-branches-label">{chosen ? t("filter.branches", { shown: shownBranches, total: all.length }) : t("filter.branchesAll")}</summary>
        <div className="fb-pop">
          <div className="fb-actions">
            <button type="button" className="small" onClick={() => setFilter({ branches: null })}>{t("filter.showAll")}</button>
            <button type="button" className="small" onClick={() => setFilter({ branches: [] })}>{t("filter.onlyHead")}</button>
          </div>
          <div id="filter-branch-list" className="fb-list">
            {all.map((b) => {
              const isHead = b === repo.head;
              return (
                <label key={b} className="fb-row">
                  <input type="checkbox" checked={!chosen || chosen.has(b) || isHead} disabled={isHead} title={isHead ? t("filter.headAlways") : undefined} onChange={(e) => toggleBranch(b, e.target.checked)} /> {b}
                  {isHead && <> <span className="muted">{t("filter.current")}</span></>}
                </label>
              );
            })}
          </div>
        </div>
      </details>
      <input id="filter-author" type="search" placeholder={t("filter.author")} aria-label={t("filter.authorAria")} autoComplete="off" spellCheck={false} value={author} onChange={(e) => setAuthor(e.target.value)} />
      <Dropdown id="filter-since" label={t("filter.since")} value={sinceDays} options={sinceOptions()} onChange={handleSince} />
      <span id="filter-summary" className="muted filter-summary" aria-live="polite">{summary}</span>
      <button type="button" id="filter-clear" className="small" hidden={!filtering} onClick={() => store.update({ filter: NO_FILTER })}>{t("filter.clear")}</button>
    </div>
  );
};

export default FilterSection;
