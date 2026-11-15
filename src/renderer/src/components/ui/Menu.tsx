import "./Menu.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import useSmallStore from "@/hooks/useSmallStore";
import { closeMenu, menuStore, pickMenu } from "@/components/ui/menuUtils";

const Menu = () => {
  const menu = useSmallStore(menuStore);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // 화면 밖으로 넘치지 않게 크기를 잰 뒤 자리를 정하고, 첫 항목에 초점
  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return; }
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    setPos({ x: Math.round(Math.min(menu.x, innerWidth - w - 8)), y: Math.round(Math.min(menu.y, innerHeight - h - 8)) });
    ref.current.querySelector("button")?.focus();
  }, [menu]);

  // 메뉴 밖을 누르면 닫는다
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest("#v2-menu")) closeMenu(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  if (!menu) return null;
  const { title, items, host } = menu;

  return createPortal(
    <div
      id="v2-menu"
      ref={ref}
      className="v2-menu"
      role="menu"
      style={{ transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : undefined, visibility: pos ? undefined : "hidden" }}
    >
      <div className="m-title">{title}</div>
      {items.map((a, i) => (
        <button key={i} type="button" role="menuitem" onClick={() => pickMenu(i)} onMouseEnter={() => a.onHover?.()} onFocus={() => a.onHover?.()}>
          <span className="m-verb">
            {i < 9 && <kbd>{i + 1}</kbd>}
            {a.label}
          </span>
          {a.cmd && <span className="m-cmd">{a.cmd.split("\n")[0]}</span>}
          {a.warn && <span className="m-warn">{a.warn}</span>}
        </button>
      ))}
      <button type="button" role="menuitem" className="m-cancel" onClick={() => pickMenu(-1)}>
        취소 <kbd>Esc</kbd>
      </button>
    </div>,
    host,
  );
};

export default Menu;
