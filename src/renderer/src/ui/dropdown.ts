// 공통 드롭다운 (Figma "App · Components / Dropdown").
// 네이티브 <select> 를 그대로 두고 그 위에 버튼 + 목록을 씌운다.
// 그래서 다른 코드는 지금처럼 select.value 를 읽고 쓰고 change 이벤트를 듣는다.
// select 는 숨기기만 하므로 값과 form 동작은 select 쪽에 남는다.
import "./dropdown.css";
import { esc } from "@/lib/html";

const enhanced = new WeakMap<HTMLSelectElement, Dropdown>();
const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!;
const indexProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex")!;
let seq = 0;
let openOne: Dropdown | null = null;

/** select 의 이름: aria-label → 연결된 label 의 글자 (select 자신의 글자는 뺀다) */
function nameOf(sel: HTMLSelectElement): string {
  const aria = sel.getAttribute("aria-label");
  if (aria) return aria;
  const label = sel.labels?.[0];
  if (!label) return "";
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("select, .dd").forEach((n) => n.remove());
  return copy.textContent?.trim() ?? "";
}

class Dropdown {
  readonly root: HTMLSpanElement;
  readonly btn: HTMLButtonElement;
  readonly list: HTMLUListElement;
  private active = -1;
  private typed = "";
  private typedAt = 0;

  constructor(readonly sel: HTMLSelectElement) {
    const id = `dd-${++seq}`;
    this.root = document.createElement("span");
    this.root.className = `dd ${sel.className}`.trim();
    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "dd-btn";
    this.btn.setAttribute("aria-haspopup", "listbox");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.setAttribute("aria-controls", `${id}-list`);
    this.list = document.createElement("ul");
    this.list.className = "dd-list";
    this.list.id = `${id}-list`;
    this.list.setAttribute("role", "listbox");
    this.list.hidden = true;
    sel.after(this.root);
    this.root.append(sel, this.btn, this.list);
    sel.classList.add("dd-native");
    sel.tabIndex = -1;

    // 코드가 select.value / selectedIndex 를 바꿔도 버튼 글자가 따라오게
    const self = this;
    Object.defineProperty(sel, "value", { configurable: true, get() { return valueProp.get!.call(this); }, set(v) { valueProp.set!.call(this, v); self.sync(); } });
    Object.defineProperty(sel, "selectedIndex", { configurable: true, get() { return indexProp.get!.call(this); }, set(v) { indexProp.set!.call(this, v); self.sync(); } });
    new MutationObserver(() => this.sync()).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
    sel.addEventListener("change", () => this.sync());
    // <label for> 를 눌러 select 로 간 초점은 버튼으로
    sel.addEventListener("focus", () => this.btn.focus());

    this.btn.addEventListener("click", () => (this.isOpen() ? this.close() : this.open()));
    this.btn.addEventListener("keydown", (e) => this.onKey(e));
    this.list.addEventListener("mousedown", (e) => e.preventDefault()); // 버튼 초점 유지
    this.list.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-i]");
      if (li && li.getAttribute("aria-disabled") !== "true") this.pick(Number(li.dataset.i));
    });
    this.list.addEventListener("mousemove", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-i]");
      if (li) this.setActive(Number(li.dataset.i));
    });
    this.sync();
  }

  isOpen(): boolean { return !this.list.hidden; }

  sync(): void {
    const o = this.sel.selectedOptions[0];
    const name = nameOf(this.sel);
    this.btn.innerHTML = `<span class="dd-v">${esc(o?.text ?? "")}</span><svg class="i dd-chev" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
    this.btn.setAttribute("aria-label", name ? `${name}: ${o?.text ?? ""}` : o?.text ?? "");
    this.btn.disabled = this.sel.disabled;
    if (this.isOpen()) this.renderList();
  }

  private renderList(): void {
    const cur = this.sel.selectedIndex;
    this.list.innerHTML = [...this.sel.options].map((o, i) =>
      `<li id="${this.list.id}-${i}" role="option" data-i="${i}" aria-selected="${i === cur}"${o.disabled ? ' aria-disabled="true"' : ""} class="${i === this.active ? "on" : ""}">` +
      `<svg class="i dd-check" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg><span>${esc(o.text)}</span></li>`).join("");
    if (this.active >= 0) this.btn.setAttribute("aria-activedescendant", `${this.list.id}-${this.active}`);
  }

  private place(): void {
    const r = this.btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    this.list.style.minWidth = `${r.width}px`;
    this.list.style.left = `${Math.min(r.left, window.innerWidth - this.list.offsetWidth - 8)}px`;
    if (below < this.list.offsetHeight + 8 && r.top > below) this.list.style.top = `${r.top - this.list.offsetHeight - 4}px`;
    else this.list.style.top = `${r.bottom + 4}px`;
  }

  open(): void {
    if (this.btn.disabled) return;
    openOne?.close(false);
    openOne = this;
    this.active = Math.max(0, this.sel.selectedIndex);
    this.list.hidden = false;
    this.root.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    this.renderList();
    this.place();
    this.list.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
  }

  close(focus = true): void {
    if (!this.isOpen()) return;
    this.list.hidden = true;
    this.root.classList.remove("open");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.removeAttribute("aria-activedescendant");
    if (openOne === this) openOne = null;
    if (focus) this.btn.focus();
  }

  private setActive(i: number): void {
    const n = this.sel.options.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    this.active = i;
    this.list.querySelectorAll("li").forEach((li, k) => li.classList.toggle("on", k === i));
    this.btn.setAttribute("aria-activedescendant", `${this.list.id}-${i}`);
    this.list.children[i]?.scrollIntoView({ block: "nearest" });
  }

  private pick(i: number): void {
    const changed = this.sel.selectedIndex !== i;
    indexProp.set!.call(this.sel, i);
    this.close();
    this.sync();
    if (changed) {
      this.sel.dispatchEvent(new Event("input", { bubbles: true }));
      this.sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private onKey(e: KeyboardEvent): void {
    const open = this.isOpen();
    const k = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) { e.preventDefault(); this.open(); }
      return;
    }
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); return; } // 창(dialog)까지 닫히지 않게
    if (k === "Tab") { this.close(false); return; }
    if (k === "ArrowDown") { e.preventDefault(); this.setActive(this.active + 1); return; }
    if (k === "ArrowUp") { e.preventDefault(); this.setActive(this.active - 1); return; }
    if (k === "Home") { e.preventDefault(); this.setActive(0); return; }
    if (k === "End") { e.preventDefault(); this.setActive(this.sel.options.length - 1); return; }
    if (k === "Enter" || k === " ") { e.preventDefault(); if (!this.sel.options[this.active]?.disabled) this.pick(this.active); return; }
    if (k.length === 1) {
      // 글자를 치면 그 글자로 시작하는 항목으로
      const now = Date.now();
      this.typed = now - this.typedAt < 700 ? this.typed + k.toLowerCase() : k.toLowerCase();
      this.typedAt = now;
      const opts = [...this.sel.options];
      const hit = opts.findIndex((o, i) => i > this.active - (this.typed.length > 1 ? 1 : 0) && o.text.toLowerCase().startsWith(this.typed));
      const any = hit >= 0 ? hit : opts.findIndex((o) => o.text.toLowerCase().startsWith(this.typed));
      if (any >= 0) this.setActive(any);
    }
  }
}

function enhance(sel: HTMLSelectElement): void {
  if (enhanced.has(sel) || sel.multiple || sel.size > 1) return;
  enhanced.set(sel, new Dropdown(sel));
}

/** 지금 있는 select 와 앞으로 생길 select (다시 그려지는 목록 안의 것 포함) 를 모두 드롭다운으로 */
export function mountDropdowns(root: ParentNode = document): void {
  root.querySelectorAll("select").forEach(enhance);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n instanceof HTMLSelectElement) enhance(n);
      else if (n instanceof HTMLElement) n.querySelectorAll("select").forEach(enhance);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("mousedown", (e) => {
    if (openOne && !openOne.root.contains(e.target as Node)) openOne.close(false);
  }, true);
  window.addEventListener("resize", () => openOne?.close(false));
  document.addEventListener("scroll", (e) => { if (openOne && !openOne.list.contains(e.target as Node)) openOne.close(false); }, true);
}
