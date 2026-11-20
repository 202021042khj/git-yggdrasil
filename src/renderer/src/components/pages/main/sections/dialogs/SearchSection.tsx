import "./SearchSection.css";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { toast } from "@/components/ui/toastUtils";
import { short } from "@/lib/html";
import { relTime } from "@/lib/time";
import { store } from "@/app/store";
import { revealCommit } from "@/components/pages/main/sections/canvas/canvasUtils";
import { openSearch, searchOpenStore } from "@/components/pages/main/sections/dialogs/searchUtils";
import { t } from "@shared/i18n/i18n";
import type { SearchHit } from "@shared/types/ipc";

type Row = { kind: "commit"; hit: SearchHit } | { kind: "file"; path: string };

/** ⌘K 찾기: 커밋(메시지·작성자·해시)과 파일 이름 */
const SearchSection = () => {
  const isOpen = useSmallStore(searchOpenStore);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ref = useModal(isOpen, () => searchOpenStore.set(false));

  // 열 때마다 비우고 입력칸에 초점
  useEffect(() => {
    if (!isOpen) return;
    setQ("");
    setRows([]);
    inputRef.current?.focus();
  }, [isOpen]);

  // ⌘K (앱 메뉴의 찾기는 main.tsx 에서 연결)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 입력이 잠깐 멈추면 찾는다. 늦게 온 이전 결과는 버린다
  useEffect(() => {
    const term = q.trim();
    if (!term) { setRows([]); setActive(0); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const lower = term.toLowerCase();
      const files: Row[] = store.repo.files.filter((f) => f.toLowerCase().includes(lower)).slice(0, 8).map((path) => ({ kind: "file", path }));
      let hits: SearchHit[] = [];
      try { hits = await window.gitApi.search(term); } catch { /* 검색 실패는 파일 결과만 */ }
      if (!alive) return;
      setRows([...hits.map((hit): Row => ({ kind: "commit", hit })), ...files]);
      setActive(0);
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  // 고른 줄이 보이게 (그릴 때마다)
  useLayoutEffect(() => { listRef.current?.querySelector(".sr.on")?.scrollIntoView({ block: "nearest" }); });

  const close = () => ref.current?.close();

  const choose = (r: Row | undefined) => {
    if (!r) return;
    close();
    if (r.kind === "file") { store.update({ selected: null, selectedFile: { path: r.path, commit: null }, detailTab: "history" }); return; }
    if (!revealCommit(r.hit.id)) toast(t("search.notLoaded"));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === "Enter") { e.preventDefault(); choose(rows[active]); }
    // 검색 칸의 Esc 는 기본으로 글자만 지우므로, 한 번에 창을 닫는다
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 바깥(배경) 클릭으로 닫기. 키보드는 Esc 로 닫는다
    <dialog id="search" ref={ref} className="ask search" aria-label={t("search.aria")} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <input id="search-input" ref={inputRef} type="search" placeholder={t("search.placeholder")} aria-label={t("top.search")} autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleKeyDown} />
      <div id="search-list" ref={listRef} className="search-list" role="listbox" aria-label={t("search.results")}>
        {rows.length
          ? rows.map((r, i) => (
            <button key={r.kind === "commit" ? r.hit.id : `f:${r.path}`} type="button" role="option" className={`sr${i === active ? " on" : ""}`} aria-selected={i === active} onClick={() => choose(r)}>
              {r.kind === "commit"
                ? <><span className="sr-k">{t("search.commit")}</span><span className="sr-t">{r.hit.msg}</span><span className="sr-m">{short(r.hit.id)} · {r.hit.author || ""} · {relTime(r.hit.date)}</span></>
                : <><span className="sr-k">{t("search.file")}</span><span className="sr-t">{r.path}</span><span className="sr-m">{t("search.history")}</span></>}
            </button>
          ))
          : <p className="muted">{q.trim() ? t("search.none") : t("search.prompt")}</p>}
      </div>
    </dialog>
  );
};

export default SearchSection;
