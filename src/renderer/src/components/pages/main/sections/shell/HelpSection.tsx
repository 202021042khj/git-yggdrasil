import RichText from "@/components/common/RichText";
import { t } from "@shared/i18n/i18n";

interface HelpSectionProps {
  open: boolean;
}

/** 도움말 패널 (상단의 도움말 버튼으로 연다) */
const HelpSection = ({ open }: HelpSectionProps) => (
  <div id="help" className={`help${open ? "" : " hidden"}`}>
    <h3>{t("help.dragTitle")}</h3>
    <p>{t("help.drag1")}</p>
    <p><RichText text={t("help.drag2")} /></p>
    <p><RichText text={t("help.drag3")} /></p>
    <p>{t("help.drag4")}</p>
    <h3>{t("help.commonTitle")}</h3>
    <p><RichText text={t("help.common")} /></p>
  </div>
);

export default HelpSection;
