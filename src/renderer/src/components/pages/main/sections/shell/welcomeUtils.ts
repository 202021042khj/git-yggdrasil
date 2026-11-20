// clone 흐름 (시작 화면 · 메뉴 · GitHub 저장소 목록에서 함께 쓴다)
import { errorText } from "@/lib/html";
import { askCredential } from "@/components/ui/credentialUtils";
import { askText } from "@/components/ui/dialogUtils";
import { toast } from "@/components/ui/toastUtils";
import { open } from "@/app/repoSession";
import { t } from "@shared/i18n/i18n";

/** clone 하는 동안 화면을 바쁨 상태로. 인증이 필요한 GitHub 밖 호스트는 로그인 창을 띄우고 같은 위치에 다시 받는다 */
export const cloneInto = async (url: string, retry = false): Promise<void> => {
  toast(t("welcome.cloning", { url }));
  document.body.classList.add("busy");
  let authUrl: string | null = null;
  try {
    await open(window.gitApi.clone(url, retry).catch((err) => {
      const m = /AUTH_REQUIRED (\S+)/.exec(errorText(err));
      if (!m) throw err;
      // 저장한 정보로도 실패: git 은 틀린 자격 증명을 도우미에서 스스로 지운다
      if (retry) throw new Error(t("welcome.cloneAuthFailed", { host: new URL(m[1]).host }));
      authUrl = m[1];
      return null;
    }));
  } finally {
    document.body.classList.remove("busy");
  }
  if (authUrl && (await askCredential(authUrl))) await cloneInto(url, true);
};

export const cloneFlow = async (): Promise<void> => {
  const url = await askText(t("welcome.cloneUrl"), "", t("welcome.cloneUrlHint"));
  if (url) await cloneInto(url);
};
