// 화면 위쪽 가운데 짧은 알림. 어디서든 toast("…") 로 띄우고, <Toast /> 가 그린다.
import { createStore } from "@/lib/createStore";

const SHOW_MS = 2600;
let timer: ReturnType<typeof setTimeout> | null = null;

export const toastStore = createStore<string | null>(null);

export const toast = (msg: string) => {
  toastStore.set(msg);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => toastStore.set(null), SHOW_MS);
};

/** 떠 있는 알림을 바로 닫는다 (더 자세한 알림 창을 띄울 때) */
export const hideToast = () => {
  if (timer) clearTimeout(timer);
  toastStore.set(null);
};
