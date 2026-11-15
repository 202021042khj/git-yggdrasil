import { useEffect, useState, type DependencyList } from "react";

import { errorText } from "@/lib/html";

export interface AsyncState<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
}

/** 비동기로 읽어 와 그린다. deps 가 바뀌면 다시 읽고, 늦게 온 이전 결과는 버린다 */
const useAsync = <T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> => {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: "", loading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: undefined, error: "", loading: true });
    load().then(
      (data) => { if (alive) setState({ data, error: "", loading: false }); },
      (err) => { if (alive) setState({ data: undefined, error: errorText(err), loading: false }); },
    );
    return () => { alive = false; };
    // biome-ignore lint/correctness/useExhaustiveDependencies: 다시 읽을 기준은 부르는 쪽이 deps 로 정한다
  }, deps);

  return state;
};

export default useAsync;
