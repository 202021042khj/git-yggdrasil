import "./LogSection.css";

import { openReflog } from "@/components/pages/main/sections/dialogs/reflogUtils";
import { t } from "@shared/i18n/i18n";
import type { LogEntry } from "@/app/store";

interface LogSectionProps {
  log: LogEntry[];
}

/** 실행 기록: 앱에서 한 조작과 대응하는 git 명령 (최근 것이 위) */
const LogSection = ({ log }: LogSectionProps) => (
  <>
    <div className="pr-head">
      <h3>{t("log.title")}</h3>
      <button type="button" id="reflog-open" className="small" title={t("log.reflogTip")} onClick={() => void openReflog()}>{t("log.reflog")}</button>
    </div>
    <ol id="log" className="log">
      {log.length
        ? [...log].reverse().map((e, i) => <li key={log.length - i}>{e.summary}<code>{e.cmd}</code></li>)
        : <li className="muted">{t("log.empty")}</li>}
    </ol>
  </>
);

export default LogSection;
