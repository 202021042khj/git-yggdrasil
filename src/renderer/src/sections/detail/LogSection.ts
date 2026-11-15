// 실행 기록: 앱에서 한 조작과 대응하는 git 명령 (최근 것이 위)
import "./LogSection.css";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";

export function renderLog(): void {
  const log = store.ui.log;
  byId("log").innerHTML = log.length
    ? [...log].reverse().map((e) => `<li>${esc(e.summary)}<code>${esc(e.cmd)}</code></li>`).join("")
    : `<li class="muted">아직 실행한 조작이 없습니다.</li>`;
}
