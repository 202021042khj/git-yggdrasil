import "./Dropdown.css";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface DropdownOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface DropdownProps<V extends string> {
  value: V;
  options: Array<DropdownOption<V>>;
  onChange: (value: V) => void;
  /** 화면 낭독용 이름 ("기간" 처럼). 버튼은 "이름: 지금 값" 으로 읽힌다 */
  label: string;
  id?: string;
  disabled?: boolean;
}

/**
 * 공통 드롭다운 (Figma "App · Components / Dropdown"). WAI-ARIA 의 select-only combobox 모양:
 * 초점은 단추(combobox)에 두고, 목록에서 가리킨 항목은 aria-activedescendant 로 알린다.
 * ↑↓ · Enter · Space 로 열고, ↑↓ · Home · End 로 움직이고, Enter 로 고르고, 글자를 치면 그 글자로 시작하는 항목으로 간다.
 * 대화상자 안에서 Esc 는 목록만 닫는다.
 */
const Dropdown = <V extends string>({ value, options, onChange, label, id, disabled }: DropdownProps<V>) => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index];

  const close = (focus = true) => {
    setOpen(false);
    if (focus) btnRef.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setActive(index);
    setOpen(true);
  };

  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== value) onChange(o.value);
  };

  // 버튼 아래(모자라면 위)에 목록을 놓는다
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !listRef.current) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    const list = listRef.current;
    const below = innerHeight - r.bottom;
    const top = below < list.offsetHeight + 8 && r.top > below ? r.top - list.offsetHeight - 4 : r.bottom + 4;
    setPos({ left: Math.min(r.left, innerWidth - list.offsetWidth - 8), top, minWidth: r.width });
  }, [open]);

  useLayoutEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // 바깥을 누르거나, 창 크기가 바뀌거나, 바깥이 스크롤되면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) { e.preventDefault(); openList(); }
      return;
    }
    const last = options.length - 1;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; } // 창(dialog)까지 닫히지 않게
    if (k === "Tab") { close(false); return; }
    if (k === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); return; }
    if (k === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (k === "Home") { e.preventDefault(); setActive(0); return; }
    if (k === "End") { e.preventDefault(); setActive(last); return; }
    if (k === "Enter" || k === " ") { e.preventDefault(); pick(active); return; }
    if (k.length === 1) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at < 700 ? t.text + k.toLowerCase() : k.toLowerCase();
      t.at = now;
      const from = active - (t.text.length > 1 ? 1 : 0);
      const hit = options.findIndex((o, i) => i > from && o.label.toLowerCase().startsWith(t.text));
      const any = hit >= 0 ? hit : options.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
      if (any >= 0) setActive(any);
    }
  };

  return (
    <span ref={rootRef} className={`dd${open ? " open" : ""}`}>
      <div
        ref={btnRef}
        id={id}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        aria-disabled={disabled || undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className="dd-v">{current?.label}</span>
        <svg className="i dd-chev" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </div>
      {open && (
        <div
          ref={listRef}
          id={listId}
          className="dd-list"
          role="listbox"
          style={pos ?? { visibility: "hidden" }}
          onMouseDown={(e) => e.preventDefault()} // 버튼 초점 유지
        >
          {options.map((o, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: combobox 패턴이라 초점은 단추에 두고 aria-activedescendant 로 가리킨다
            // biome-ignore lint/a11y/useKeyWithClickEvents: 키보드는 단추의 onKeyDown 이 처리한다
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              aria-disabled={o.disabled || undefined}
              className={i === active ? "on" : undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <svg className="i dd-check" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
};

export default Dropdown;
