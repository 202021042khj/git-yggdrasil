import { publish } from "@/components/pages/main/sections/dialogs/githubUtils";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

interface GithubPublishButtonProps {
  repo: RepoState;
  hasRepo: boolean;
}

/** GitHub 원격이 없는 저장소에만: GitHub 에 새 저장소로 올리기 */
const GithubPublishButton = ({ repo, hasRepo }: GithubPublishButtonProps) => {
  const hasGithub = (repo.remoteList || []).some((r) => /github\.com[:/]/.test(r.url));
  if (!hasRepo || hasGithub) return null;
  return <button type="button" id="gh-publish" className="small" onClick={() => void publish()}>{t("gh.publish")}</button>;
};

export default GithubPublishButton;
