// 커밋 정리(interactive rebase) 창 열기
import { createStore } from "@/lib/createStore";
import { toast } from "@/components/ui/toastUtils";
import { store } from "@/app/store";
import { stems } from "@/model/graph";

/** 정리할 브랜치 (null 이면 닫힘) */
export const rebaseStore = createStore<{ branch: string; ids: string[] } | null>(null);

export const openRebaseEditor = (b: string) => {
  const s = store.repo;
  const st = stems(s).stems[b];
  if (!st?.ids.length) { toast(`${b} 에 정리할 커밋이 없습니다.`); return; }
  if (!st.base) { toast(`${b} 는 첫 커밋부터 시작하는 줄기라 아직 정리할 수 없습니다.`); return; }
  if (st.ids.some((id) => s.commits[id].parents.length > 1)) { toast("merge 커밋이 있는 줄기는 아직 정리할 수 없습니다."); return; }
  rebaseStore.set({ branch: b, ids: [...st.ids] });
};
