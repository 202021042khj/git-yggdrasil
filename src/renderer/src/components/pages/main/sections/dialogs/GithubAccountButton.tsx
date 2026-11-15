import useSmallStore from "@/hooks/useSmallStore";
import { ghStatusStore, login, logout } from "@/components/pages/main/sections/dialogs/githubUtils";

/** 상단의 GitHub 계정 단추: 로그인 · 로그아웃 */
const GithubAccountButton = () => {
  const status = useSmallStore(ghStatusStore);
  const u = status.loggedIn ? status.user : undefined;

  return (
    <button
      type="button"
      id="gh-account"
      className="small gh-account"
      title={u ? `${u.name} (${u.login}) — 클릭하면 로그아웃` : "GitHub 계정으로 로그인하면 push·pull 인증, 내 저장소 clone, PR 만들기를 쓸 수 있습니다"}
      onClick={() => void (status.loggedIn ? logout() : login())}
    >
      {u ? <>{u.avatar && <img src={`${u.avatar}&s=36`} alt="" />}{u.login}</> : "GitHub 로그인"}
    </button>
  );
};

export default GithubAccountButton;
