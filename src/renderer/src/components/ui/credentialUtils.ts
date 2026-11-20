// GitHub 밖 HTTPS 호스트 로그인 창을 여는 함수. <CredentialDialog /> 가 그린다.
import { createStore } from "@/lib/createStore";
import { hideToast } from "@/components/ui/toastUtils";
import { t } from "@shared/i18n/i18n";

export interface CredentialAsk {
  url: string;
  host: string;
  resolve: (saved: boolean) => void;
}

export const credentialStore = createStore<CredentialAsk | null>(null);

export const helperName = (id: string): string => (id === "osxkeychain" ? t("cred.helper.osxkeychain") : id === "manager" ? "Git Credential Manager" : id);

/** 호스트별로 어떤 토큰을 만들면 되는지 */
export const tipFor = (host: string): string => {
  if (/gitlab/.test(host)) return t("cred.tip.gitlab");
  if (/bitbucket/.test(host)) return t("cred.tip.bitbucket");
  if (/azure|visualstudio/.test(host)) return t("cred.tip.azure");
  return t("cred.tip.other");
};

/** 저장했으면 true. 앱은 토큰을 따로 보관하지 않고 git 도우미(키체인 등)에 맡긴다 */
export const askCredential = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    hideToast();
    credentialStore.get()?.resolve(false);
    credentialStore.set({ url, host: new URL(url).host, resolve });
  });
