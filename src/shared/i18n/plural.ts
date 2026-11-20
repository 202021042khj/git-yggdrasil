// 영어 복수형 도우미 (사전 en.ts 에서만 쓴다). 한국어는 수에 따라 낱말이 바뀌지 않는다.
const rules = new Intl.PluralRules("en-US");

/** count(3, "commit") → "3 commits", count(1, "commit") → "1 commit" */
export const count = (n: number, one: string, other = `${one}s`): string => `${n} ${rules.select(n) === "one" ? one : other}`;

/** 수는 빼고 낱말만: word(1, "file") → "file" */
export const word = (n: number, one: string, other = `${one}s`): string => (rules.select(n) === "one" ? one : other);
