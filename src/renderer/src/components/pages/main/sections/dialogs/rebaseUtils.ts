// 커밋 정리(interactive rebase) 창 열기
import { createStore } from "@/lib/createStore";
import { toast } from "@/components/ui/toastUtils";
import { store } from "@/app/store";
import { stems } from "@/model/graph";
import { t } from "@shared/i18n/i18n";

/** 정리할 브랜치 (null 이면 닫힘) */
export const rebaseStore = createStore<{ branch: string; ids: string[] } | null>(null);

export const openRebaseEditor = (b: string) => {
  const s = store.repo;
  const st = stems(s).stems[b];
  if (!st?.ids.length) { toast(t("rb.nothing", { branch: b })); return; }
  if (!st.base) { toast(t("rb.root", { branch: b })); return; }
  if (st.ids.some((id) => s.commits[id].parents.length > 1)) { toast(t("rb.hasMerge")); return; }
  rebaseStore.set({ branch: b, ids: [...st.ids] });
};
