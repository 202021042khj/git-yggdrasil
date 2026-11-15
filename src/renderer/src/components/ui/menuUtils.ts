// 떠 있는 메뉴 (드롭 메뉴 · 오른쪽 클릭 메뉴 공용). openMenu(...) 로 열고 <Menu /> 가 그린다.
// 숫자 키 · 화살표 · Enter · Esc 로 고른다.
import { createStore } from "@/lib/createStore";

export interface MenuItem {
  label: string;
  /** 대응 git 명령 (작게 표시) */
  cmd?: string;
  /** 경고 문구 (충돌 예상 등) */
  warn?: string;
  onPick(): void;
  /** 고르기 전에 결과를 미리 보여 주기 */
  onHover?(): void;
}

export interface MenuState {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
  /** 모달 창(dialog)은 화면 맨 위 층이라, 그 위에서 연 메뉴는 창 안에 그려야 보인다 */
  host: Element;
}

export const menuStore = createStore<MenuState | null>(null);

let onCloseHook: (() => void) | null = null;
/** 메뉴를 닫으면 초점을 열기 전 자리로 돌려준다 (키보드 사용자가 길을 잃지 않게) */
let returnFocus: HTMLElement | SVGElement | null = null;

export const menuOpen = () => !!menuStore.get();

const menuButtons = () => [...document.querySelectorAll<HTMLButtonElement>("#v2-menu button")];

export const closeMenu = () => {
  if (!menuStore.get()) return;
  const wasInMenu = !!document.activeElement?.closest("#v2-menu");
  menuStore.set(null);
  const hook = onCloseHook;
  onCloseHook = null;
  hook?.();
  const back = returnFocus;
  returnFocus = null;
  if (back?.isConnected && (wasInMenu || document.activeElement === document.body)) back.focus({ preventScroll: true });
};

export const openMenu = (x: number, y: number, title: string, items: MenuItem[], onClose?: () => void) => {
  closeMenu();
  const a = document.activeElement;
  returnFocus = a instanceof HTMLElement || a instanceof SVGElement ? a : null;
  onCloseHook = onClose ?? null;
  menuStore.set({ x, y, title, items, host: document.querySelector("dialog[open]") ?? document.body });
};

export const pickMenu = (i: number) => {
  const items = menuStore.get()?.items;
  closeMenu();
  if (i >= 0 && items?.[i]) items[i].onPick();
};

/** 메뉴가 열려 있을 때의 키 처리. 처리했으면 true */
export const menuKey = (e: KeyboardEvent): boolean => {
  if (!menuOpen()) return false;
  const btns = menuButtons();
  const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") closeMenu();
  else if (e.key === "ArrowDown") btns[(cur + 1) % btns.length]?.focus();
  else if (e.key === "ArrowUp") btns[(cur - 1 + btns.length) % btns.length]?.focus();
  else if (/^[1-9]$/.test(e.key)) pickMenu(Number(e.key) - 1);
  else return false; // Enter 는 버튼 기본 동작
  e.preventDefault();
  return true;
};
