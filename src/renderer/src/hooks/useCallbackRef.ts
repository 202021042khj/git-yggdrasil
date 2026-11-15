import { useCallback, useLayoutEffect, useRef } from "react";

/** 항상 최신 함수를 부르지만 자신의 정체(참조)는 바뀌지 않는 콜백 (이벤트 리스너에 한 번만 걸 때) */
const useCallbackRef = <A extends unknown[], R>(fn: (...args: A) => R) => {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
};

export default useCallbackRef;
