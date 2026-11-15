import "./toast.css";
import { byId } from "@/lib/dom";

const SHOW_MS = 2600;
let timer: ReturnType<typeof setTimeout> | null = null;

/** 화면 위쪽 가운데 짧은 알림 */
export function toast(msg: string): void {
  const t = byId("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => t.classList.add("hidden"), SHOW_MS);
}

/** 떠 있는 알림을 바로 닫는다 (더 자세한 알림 창을 띄울 때) */
export function hideToast(): void {
  if (timer) clearTimeout(timer);
  byId("toast").classList.add("hidden");
}
