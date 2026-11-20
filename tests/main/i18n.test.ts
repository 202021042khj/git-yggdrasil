// 화면 문구 사전: ko · en 의 키와 모양이 같고, 언어 고르기 · 인자 넣기 · 복수형이 맞는지
import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { en } from "@shared/i18n/en";
import { ko } from "@shared/i18n/ko";
import { getLocale, resolveLocale, setLocale, t } from "@shared/i18n/i18n";

afterEach(() => setLocale("ko"));

const HANGUL = /[가-힣]/;
/** 어떤 이름을 물어도 값을 주는 가짜 인자 (문구 함수를 모두 불러 보려고) */
const anyParams = new Proxy({}, { get: (_t, k) => (k === "n" || k === "total" || k === "done" || k === "step" ? 2 : `‹${String(k)}›`) });

test("ko 와 en 의 키가 똑같다 (빠진 키 · 남는 키 없음)", () => {
  const k = Object.keys(ko).sort(), e = Object.keys(en).sort();
  assert.deepEqual(e.filter((x) => !k.includes(x)), [], "en 에만 있는 키");
  assert.deepEqual(k.filter((x) => !e.includes(x)), [], "ko 에만 있는 키");
  assert.ok(k.length > 500, `키가 ${k.length}개`);
});

test("같은 키는 두 사전에서 같은 모양 (문자열 ↔ 함수)", () => {
  for (const key of Object.keys(ko) as Array<keyof typeof ko>) assert.equal(typeof en[key], typeof ko[key], key);
});

test("영어 문구에 한글이 섞이지 않고, 인자를 모두 채운다", () => {
  for (const [key, m] of Object.entries(en)) {
    const text = typeof m === "function" ? (m as (p: unknown) => string)(anyParams) : m;
    assert.ok(!HANGUL.test(text), `${key}: ${text}`);
    assert.ok(!/undefined|\[object/.test(text), `${key}: ${text}`);
  }
});

test("언어 고르기: 설정이 우선, system 이면 OS 언어가 ko* 일 때만 한국어", () => {
  assert.equal(resolveLocale("en", "ko-KR"), "en");
  assert.equal(resolveLocale("ko", "en-US"), "ko");
  assert.equal(resolveLocale("system", "ko-KR"), "ko");
  assert.equal(resolveLocale("system", "ko"), "ko");
  assert.equal(resolveLocale("system", "en-GB"), "en");
  assert.equal(resolveLocale("system", "ja"), "en");
  assert.equal(resolveLocale(undefined, ""), "en");
});

test("t: 지금 언어로 문장 전체를 만들고, 영어는 수에 따라 복수형", () => {
  assert.equal(getLocale(), "ko");
  assert.equal(t("verb.copyMany", { n: 3, branch: "main" }), "커밋 3개를 main 브랜치에 복사");
  setLocale("en");
  assert.equal(t("verb.copyMany", { n: 3, branch: "main" }), "Copy 3 commits to main");
  assert.equal(t("verb.copyMany", { n: 1, branch: "main" }), "Copy 1 commit to main");
  assert.equal(t("verb.rebaseOnto", { branch: "main" }), "Rebase onto main");
  assert.equal(t("common.cancel"), "Cancel");
});
