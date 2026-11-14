// GitHub 밖 HTTPS 호스트 로그인 창: 사용자 이름과 토큰을 받아 git 자격 증명 도우미(키체인 등)에 저장한다
import { byId } from "@/lib/dom";
import { errorText } from "@/lib/html";
import { confirmAction } from "@/ui/dialog";
import { hideToast } from "@/ui/toast";

const HELPER_NAME: Record<string, string> = { osxkeychain: "macOS 키체인", manager: "Git Credential Manager" };

/** 호스트별로 어떤 토큰을 만들면 되는지 */
function tipFor(host: string): string {
  if (/gitlab/.test(host)) return "GitLab: 사용자 설정 → Access Tokens 에서 read_repository, write_repository 권한으로 토큰을 만들어 붙여 넣으세요.";
  if (/bitbucket/.test(host)) return "Bitbucket: 개인 설정 → App passwords(또는 API token)에서 저장소 읽기·쓰기 권한으로 만들어 붙여 넣으세요. 사용자 이름은 Bitbucket 사용자 이름입니다.";
  if (/azure|visualstudio/.test(host)) return "Azure DevOps: User settings → Personal access tokens 에서 Code(Read & write) 권한으로 만드세요.";
  return "대부분의 서비스는 계정 비밀번호 대신 개인 액세스 토큰(Personal Access Token)을 받습니다. 서비스의 사용자 설정에서 저장소 읽기·쓰기 권한으로 만드세요.";
}

/** 저장했으면 true. 앱은 토큰을 따로 보관하지 않고 git 도우미에 맡긴다 */
export function askCredential(url: string): Promise<boolean> {
  const host = new URL(url).host;
  const d = byId<HTMLDialogElement>("cred");
  const user = byId<HTMLInputElement>("cred-user");
  const pass = byId<HTMLInputElement>("cred-pass");
  const err = byId("cred-error");
  byId("cred-host").textContent = `${host} 에 접속하려면 로그인이 필요합니다. 입력한 정보는 이 컴퓨터의 git 자격 증명 도우미에 저장되고, 다음부터 자동으로 쓰입니다.`;
  byId("cred-tip").textContent = tipFor(host);
  pass.value = "";
  err.textContent = "";
  hideToast();

  return new Promise((resolve) => {
    let saved = false;
    const form = byId<HTMLFormElement>("cred-form");
    form.onsubmit = async (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value !== "ok") return; // 취소: 그대로 닫는다
      e.preventDefault();
      err.textContent = "";
      try {
        let r = await window.gitApi.saveCredential({ url, username: user.value, password: pass.value });
        if (r.needsHelper !== undefined) {
          if (!r.needsHelper) { err.textContent = r.message ?? "저장 도우미가 없습니다."; return; }
          const name = HELPER_NAME[r.needsHelper] ?? r.needsHelper;
          if (!confirmAction(`git 에 자격 증명 저장 도우미가 꺼져 있습니다.\n${name}(${r.needsHelper})에 저장하도록 git 전역 설정을 켤까요?\n\ngit config --global credential.helper ${r.needsHelper}`)) return;
          r = await window.gitApi.saveCredential({ url, username: user.value, password: pass.value, enableHelper: true });
        }
        saved = true;
        pass.value = "";
        d.close("ok");
      } catch (e2) {
        err.textContent = errorText(e2);
      }
    };
    d.onclose = () => { pass.value = ""; resolve(saved); };
    d.showModal();
    (user.value ? pass : user).focus();
  });
}
