import useSmallStore from "@/hooks/useSmallStore";
import { ghStatusStore, login, logout } from "@/components/pages/main/sections/dialogs/githubUtils";
import { t } from "@shared/i18n/i18n";

/** 상단의 GitHub 계정 단추: 로그인 · 로그아웃 */
const GithubAccountButton = () => {
  const status = useSmallStore(ghStatusStore);
  const u = status.loggedIn ? status.user : undefined;

  return (
    <button
      type="button"
      id="gh-account"
      className="small gh-account"
      title={u ? t("gh.accountTip", { name: u.name, login: u.login }) : t("gh.loginTip")}
      onClick={() => void (status.loggedIn ? logout() : login())}
    >
      {u ? <>{u.avatar && <img src={`${u.avatar}&s=36`} alt="" />}{u.login}</> : t("gh.login")}
    </button>
  );
};

export default GithubAccountButton;
