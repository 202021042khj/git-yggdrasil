import { useSyncExternalStore } from "react";

import type { SmallStore } from "@/lib/createStore";

/** lib/createStore 로 만든 작은 상태를 구독한다 */
const useSmallStore = <T>(s: SmallStore<T>): T => useSyncExternalStore(s.subscribe, s.get);

export default useSmallStore;
