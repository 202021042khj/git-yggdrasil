// ⌘K 찾기 창 열기 (상단 버튼 · 단축키 · 앱 메뉴)
import { createStore } from "@/lib/createStore";
import { store } from "@/app/store";

export const searchOpenStore = createStore(false);

export const openSearch = () => {
  if (!store.hasRepo()) return;
  searchOpenStore.set(true);
};
