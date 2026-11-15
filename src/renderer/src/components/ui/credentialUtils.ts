// GitHub 밖 HTTPS 호스트 로그인 창을 여는 함수. <CredentialDialog /> 가 그린다.
import { createStore } from "@/lib/createStore";
import { hideToast } from "@/components/ui/toastUtils";

export interface CredentialAsk {
  url: string;
  host: string;
  resolve: (saved: boolean) => void;
}

export const credentialStore = createStore<CredentialAsk | null>(null);

export const HELPER_NAME: Record<string, string> = { osxkeychain: "macOS 키체인", manager: "Git Credential Manager" };

/** 호스트별로 어떤 토큰을 만들면 되는지 */
export const tipFor = (host: string): string => {
  if (/gitlab/.test(host)) return "GitLab: 사용자 설정 → Access Tokens 에서 read_repository, write_repository 권한으로 토큰을 만들어 붙여 넣으세요.";
  if (/bitbucket/.test(host)) return "Bitbucket: 개인 설정 → App passwords(또는 API token)에서 저장소 읽기·쓰기 권한으로 만들어 붙여 넣으세요. 사용자 이름은 Bitbucket 사용자 이름입니다.";
  if (/azure|visualstudio/.test(host)) return "Azure DevOps: User settings → Personal access tokens 에서 Code(Read & write) 권한으로 만드세요.";
  return "대부분의 서비스는 계정 비밀번호 대신 개인 액세스 토큰(Personal Access Token)을 받습니다. 서비스의 사용자 설정에서 저장소 읽기·쓰기 권한으로 만드세요.";
};

/** 저장했으면 true. 앱은 토큰을 따로 보관하지 않고 git 도우미(키체인 등)에 맡긴다 */
export const askCredential = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    hideToast();
    credentialStore.get()?.resolve(false);
    credentialStore.set({ url, host: new URL(url).host, resolve });
  });
