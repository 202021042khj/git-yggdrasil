// 점검용 실행: YGG_SMOKE=<저장소 경로> [YGG_SHOT=<png>] [YGG_EVAL=<js>] [YGG_SMOKE_OUT=<json>] npm start
// (YGG_SMOKE_OUT: 결과를 파일로도 쓴다 — Windows 패키지 앱은 콘솔 출력이 보이지 않아 CI 스모크 테스트가 이 파일을 읽는다)
// 저장소를 열고 화면 오류를 모은 뒤, 시나리오를 실행하고 캡처를 남기고 종료한다.
// 화면 상태는 window.__yggDebug (renderer 의 dev/debug.ts) 로 읽는다.
import fs from "node:fs";
import { app, type BrowserWindow } from "electron";

export function runSmoke(win: BrowserWindow, repoDir: string): void {
  const errors: string[] = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") errors.push(e.message);
  });
  win.webContents.once("did-finish-load", async () => {
    // 다시 불러오는 동안 executeJavaScript 가 끝나지 않을 수 있어 기다리지 않고, 리스너를 먼저 건다
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      const info = await win.webContents.executeJavaScript(`(() => {
        const s = window.__yggDebug?.state;
        return { repo: s?.repoName, head: s?.head, commits: s ? Object.keys(s.commits).length : 0,
          branches: s ? Object.keys(s.branches) : [], nodes: document.querySelectorAll('#graph .node').length,
          welcome: !!document.getElementById('welcome'),
          tree: document.querySelectorAll('.ft-row').length };
      })()`);
      if (process.env.YGG_EVAL) info.eval = await win.webContents.executeJavaScript(fs.readFileSync(process.env.YGG_EVAL, "utf8"));
      // 시나리오가 바꾼 화면이 실제로 그려진 뒤에 캡처한다 (안 기다리면 이전 프레임이 찍힌다)
      await win.webContents.executeJavaScript("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))))");
      if (process.env.YGG_SHOT) fs.writeFileSync(process.env.YGG_SHOT, (await win.webContents.capturePage()).toPNG());
      const result = JSON.stringify({ ...info, errors });
      console.log("SMOKE " + result);
      if (process.env.YGG_SMOKE_OUT) fs.writeFileSync(process.env.YGG_SMOKE_OUT, result);
      app.quit();
    }, 1500));
    void win.webContents.executeJavaScript(`localStorage.setItem("ygg-recent", JSON.stringify([${JSON.stringify(repoDir)}])); setTimeout(() => location.reload(), 0);`);
  });
}
