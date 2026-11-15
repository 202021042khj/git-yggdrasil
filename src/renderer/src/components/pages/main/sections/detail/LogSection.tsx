import "./LogSection.css";

import { openReflog } from "@/components/pages/main/sections/dialogs/reflogUtils";
import type { LogEntry } from "@/app/store";

interface LogSectionProps {
  log: LogEntry[];
}

/** 실행 기록: 앱에서 한 조작과 대응하는 git 명령 (최근 것이 위) */
const LogSection = ({ log }: LogSectionProps) => (
  <>
    <div className="pr-head">
      <h3>실행 기록 (대응 git 명령)</h3>
      <button type="button" id="reflog-open" className="small" title="되돌리기로 찾을 수 없는 예전 커밋까지 (git reflog)" onClick={() => void openReflog()}>예전 커밋 찾기</button>
    </div>
    <ol id="log" className="log">
      {log.length
        ? [...log].reverse().map((e, i) => <li key={log.length - i}>{e.summary}<code>{e.cmd}</code></li>)
        : <li className="muted">아직 실행한 조작이 없습니다.</li>}
    </ol>
  </>
);

export default LogSection;
