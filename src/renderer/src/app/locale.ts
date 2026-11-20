// 화면 언어: main 이 정한 언어(설정 + OS 언어)를 받아 이 화면에도 적용한다. 바뀌면 화면 전체를 다시 그린다.
import { createStore } from "@/lib/createStore";
import { store } from "@/app/store";
import { getLocale, setLocale, type Locale } from "@shared/i18n/i18n";

/** App 이 구독한다: 값이 바뀌면 모든 컴포넌트가 새 언어로 다시 그린다 */
export const localeStore = createStore<Locale>(getLocale());

export const applyLocale = (l: Locale): void => {
  setLocale(l);
  document.documentElement.lang = l;
  localeStore.set(l);
  store.update({}); // 그래프 SVG 처럼 store 를 보고 그리는 것도 다시
};

/** main 에게 지금 언어를 물어 맞춘다 (시작할 때 · 설정에서 언어를 바꾼 뒤) */
export const syncLocale = async (): Promise<void> => {
  try { applyLocale(await window.gitApi.getLocale()); } catch { /* 못 받으면 기본(한국어) 그대로 */ }
};
