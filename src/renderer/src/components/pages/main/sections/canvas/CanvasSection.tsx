import "./CanvasSection.css";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { loadMore } from "@/app/repoSession";
import { store } from "@/app/store";
import { dimmedCommits, visibleRepo } from "@/model/filter";
import { renderGraph } from "@/model/layout";
import { keyboardFocus, moveFocus, nextNode, pinLaneNames } from "@/components/pages/main/sections/canvas/canvasUtils";
import { t } from "@shared/i18n/i18n";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

/** 캔버스: 커밋 그래프 · 결과 미리보기 겹침 · 레인 이름 고정 · 이전 커밋 더 불러오기 */
const CanvasSection = ({ ui, repo }: UseMainLogicResult) => {
  const wrapRef = useRef<HTMLElement>(null);
  const graphRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loadingMore, setLoadingMore] = useState(false);

  // 창 크기가 바뀌면 그래프 최소 크기도 다시 잰다
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const f = ui.filter;
  const focusId = keyboardFocus.id && repo.commits[keyboardFocus.id] ? keyboardFocus.id : null;
  const g = renderGraph(visibleRepo(repo, f), {
    interactive: true,
    selected: ui.selected,
    minWidth: size.w,
    dim: dimmedCommits(repo, f),
    focusId,
    multi: ui.multi.length > 1 ? new Set(ui.multi) : undefined,
  });
  // 키보드로 고르면 그래프를 다시 그리므로, 그리기 전에 초점이 그래프 안에 있었는지 기억해 둔다
  const hadFocus = typeof document !== "undefined" && !!document.activeElement?.closest("#graph");

  useLayoutEffect(() => {
    if (hadFocus) graphRef.current?.querySelector<SVGGElement>('.node[tabindex="0"]')?.focus({ preventScroll: true });
    pinLaneNames();
  });

  const handleKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const node = (e.target as Element).closest<SVGGElement>(".node[data-id]");
    if (!node || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = node.dataset.id!;
    if (e.key === "Enter") { e.preventDefault(); keyboardFocus.id = null; store.update({ selected: id, multi: [], selectedFile: null }); return; }
    if (e.key === " ") {
      e.preventDefault();
      const base = ui.multi.length ? ui.multi : ui.selected ? [ui.selected] : [];
      const multi = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      store.update({ multi, selected: multi.includes(id) ? id : ui.selected });
      return;
    }
    const to = nextNode(node, e.key);
    if (to) { e.preventDefault(); moveFocus(to); }
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try { await loadMore(); } finally { setLoadingMore(false); }
  };

  const shown = Object.keys(repo.commits).length;

  return (
    <>
      <section className="canvas-wrap" id="canvas-wrap" ref={wrapRef} onScroll={pinLaneNames}>
        <svg
          id="graph"
          ref={graphRef}
          role="group"
          aria-label={t("canvas.graph")}
          aria-describedby="graph-help"
          width={g.width}
          height={Math.max(g.height, size.h - 4)}
          onPointerDown={() => { keyboardFocus.id = null; }}
          onKeyDown={handleKeyDown}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 그래프 SVG 는 model/layout 이 값을 이스케이프해 만든 문자열이다
          dangerouslySetInnerHTML={{ __html: g.svg }}
        />
        <p id="graph-help" className="sr-only">{t("canvas.help")}</p>
        {/* 드래그 중 결과 미리보기 (interactions/drag 가 직접 채운다) */}
        <svg id="ghost-graph" aria-hidden="true" />
      </section>
      <button type="button" id="load-more" className="load-more" hidden={!repo.truncated} disabled={loadingMore} onClick={() => void handleLoadMore()}>
        {t("canvas.more", { shown: shown.toLocaleString(), total: (repo.totalCommits || shown).toLocaleString() })}
      </button>
    </>
  );
};

export default CanvasSection;
