// 작은 외부 상태 (토스트 · 메뉴 · 대화상자처럼 어디서든 함수로 여는 화면 부품용). React 와 무관하다.
export interface SmallStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export const createStore = <T>(initial: T): SmallStore<T> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
};
