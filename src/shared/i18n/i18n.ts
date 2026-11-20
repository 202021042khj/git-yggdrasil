// 화면 문구 번역: 사전(ko.ts · en.ts)에서 키로 찾아 문장을 만든다. main 과 renderer 가 같은 코드를 각자 번들한다.
// 지금 언어는 main 이 정하고(설정 + OS 언어), renderer 는 main 에게 받아 setLocale 한다.
import { en } from "@shared/i18n/en";
import { ko, type Messages } from "@shared/i18n/ko";

export type Locale = "ko" | "en";
/** 설정에 저장하는 값: system 이면 OS 언어를 따른다 */
export type LanguagePref = "system" | Locale;
export type MessageKey = keyof Messages;
/** 키마다 받는 값: 문자열 문구는 없음, 함수 문구는 그 함수의 인자 하나 */
export type MessageArgs<K extends MessageKey> = Messages[K] extends (p: infer P) => string ? [params: P] : [];

const DICTS: Record<Locale, Messages> = { ko, en };
let current: Locale = "ko";

/** 설정값과 OS 언어(app.getLocale() · navigator.language)로 실제 언어를 정한다: ko* → ko, 그 밖은 en */
export function resolveLocale(pref: LanguagePref | undefined, system: string | undefined): Locale {
  if (pref === "ko" || pref === "en") return pref;
  return /^ko\b/i.test(system ?? "") ? "ko" : "en";
}

export const getLocale = (): Locale => current;
export const setLocale = (l: Locale): void => { current = l; };

/** 문구 하나. 인자가 있는 문구는 params 를 받아 문장 전체를 만든다 (조각을 이어 붙이지 않는다) */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  const m = (DICTS[current][key] ?? ko[key]) as string | ((p: unknown) => string);
  return typeof m === "function" ? m(args[0]) : m;
}

/** 날짜·시각을 지금 언어로 */
export const dateLocale = (): string => (current === "ko" ? "ko-KR" : "en-US");
