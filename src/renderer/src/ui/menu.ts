// 떠 있는 메뉴 (드롭 메뉴 · 오른쪽 클릭 메뉴 공용). 숫자 키·화살표·Enter·Esc 로 고른다.
import { esc } from "@/lib/html";
import { byId } from "@/lib/dom";

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

let items: MenuItem[] | null = null;
let onCloseHook: (() => void) | null = null;

export const menuOpen = () => !byId("v2-menu").classList.contains("hidden");

export function openMenu(x: number, y: number, title: string, list: MenuItem[], onClose?: () => void): void {
  closeMenu();
  const m = byId("v2-menu");
  // 모달 창(dialog) 은 화면 맨 위 층에 그려지므로, 그 위에서 연 메뉴는 창 안으로 옮겨야 보인다
  const host = document.querySelector("dialog[open]") ?? document.body;
  if (m.parentElement !== host) host.appendChild(m);
  m.innerHTML = `<div class="m-title">${esc(title)}</div>` + list.map((a, i) => `
    <button type="button" role="menuitem" data-i="${i}">
      <span class="m-verb">${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}${esc(a.label)}</span>
      ${a.cmd ? `<span class="m-cmd">${esc(a.cmd.split("\n")[0])}</span>` : ""}
      ${a.warn ? `<span class="m-warn">${esc(a.warn)}</span>` : ""}
    </button>`).join("") + `<button type="button" role="menuitem" class="m-cancel" data-i="-1">취소 <kbd>Esc</kbd></button>`;
  m.classList.remove("hidden");
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.transform = `translate(${Math.round(Math.min(x, innerWidth - w - 8))}px, ${Math.round(Math.min(y, innerHeight - h - 8))}px)`;
  items = list;
  onCloseHook = onClose ?? null;
  const btns = [...m.querySelectorAll<HTMLButtonElement>("button")];
  btns.forEach((b) => {
    const it = list[Number(b.dataset.i)];
    b.onmouseenter = b.onfocus = () => it?.onHover?.();
    b.onclick = () => pickMenu(Number(b.dataset.i));
  });
  btns[0]?.focus();
}

export function pickMenu(i: number): void {
  const list = items;
  closeMenu();
  if (i >= 0 && list?.[i]) list[i].onPick();
}

export function closeMenu(): void {
  const m = byId("v2-menu");
  if (m.classList.contains("hidden")) return;
  m.classList.add("hidden");
  items = null;
  const hook = onCloseHook;
  onCloseHook = null;
  hook?.();
}

/** 메뉴가 열려 있을 때의 키 처리. 처리했으면 true */
export function menuKey(e: KeyboardEvent): boolean {
  if (!menuOpen()) return false;
  const btns = [...byId("v2-menu").querySelectorAll<HTMLButtonElement>("button")];
  const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") closeMenu();
  else if (e.key === "ArrowDown") btns[(cur + 1) % btns.length].focus();
  else if (e.key === "ArrowUp") btns[(cur - 1 + btns.length) % btns.length].focus();
  else if (/^[1-9]$/.test(e.key)) pickMenu(Number(e.key) - 1);
  else return false; // Enter 는 버튼 기본 동작
  e.preventDefault();
  return true;
}

export function mountMenu(): void {
  // 메뉴 밖을 누르면 닫는다
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen() && !(e.target as Element).closest("#v2-menu")) closeMenu();
  }, true);
}
