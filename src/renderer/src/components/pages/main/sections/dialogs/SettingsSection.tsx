import "./SettingsSection.css";

import { useEffect, useState } from "react";

import Dropdown from "@/components/ui/Dropdown";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { saveSettings, settingsOpenStore, settingsStore } from "@/components/pages/main/sections/dialogs/settingsUtils";
import type { Settings } from "@shared/types/ipc";

const THEME_OPTIONS: Array<{ value: Settings["theme"]; label: string }> = [
  { value: "system", label: "시스템을 따름" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
];
const FETCH_OPTIONS = [
  { value: "0", label: "끔" },
  { value: "5", label: "5분마다" },
  { value: "15", label: "15분마다" },
  { value: "30", label: "30분마다" },
  { value: "60", label: "1시간마다" },
];
const PULL_OPTIONS: Array<{ value: Settings["pullMode"]; label: string }> = [{ value: "merge", label: "merge" }, { value: "rebase", label: "rebase" }];

/** 설정 창: 바꾸는 즉시 저장·적용한다 */
const SettingsSection = () => {
  const isOpen = useSmallStore(settingsOpenStore);
  const s = useSmallStore(settingsStore);
  // 확대는 끄는 동안에도 숫자를 보여 주고, 놓을 때 저장한다
  const [zoom, setZoom] = useState(s.zoom);
  // 에디터 명령은 입력을 마칠 때(칸을 벗어날 때) 저장한다
  const [editor, setEditor] = useState(s.editor);
  const ref = useModal(isOpen, () => settingsOpenStore.set(false));

  useEffect(() => { setZoom(s.zoom); setEditor(s.editor); }, [s.zoom, s.editor]);

  return (
    <dialog id="settings" ref={ref} className="ask settings" aria-labelledby="settings-title">
      <form method="dialog" id="settings-form">
        <h2 id="settings-title">설정</h2>
        <div className="set-grid">
          <label htmlFor="set-theme">화면 색</label>
          <Dropdown id="set-theme" label="화면 색" value={s.theme} options={THEME_OPTIONS} onChange={(theme) => void saveSettings({ theme })} />
          <label htmlFor="set-zoom">글자 크기</label>
          <span className="set-zoom">
            <input id="set-zoom" type="range" min="0.8" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} onPointerUp={() => void saveSettings({ zoom })} onKeyUp={() => void saveSettings({ zoom })} />
            <output id="set-zoom-out">{Math.round(zoom * 100)}%</output>
          </span>
          <label htmlFor="set-editor">에디터</label>
          <span>
            <input id="set-editor" type="text" placeholder="비우면 OS 기본 앱 (예: code, cursor, subl)" spellCheck={false} autoComplete="off" value={editor} onChange={(e) => setEditor(e.target.value)} onBlur={() => { if (editor !== s.editor) void saveSettings({ editor }); }} />
            <span className="muted set-hint">충돌 파일을 "외부 에디터로" 열 때 씁니다. 공백이 있는 경로는 따옴표로 감싸세요.</span>
          </span>
          <label htmlFor="set-fetch">자동 fetch</label>
          <Dropdown id="set-fetch" label="자동 fetch" value={String(s.autoFetchMinutes)} options={FETCH_OPTIONS} onChange={(v) => void saveSettings({ autoFetchMinutes: Number(v) })} />
          <label htmlFor="set-pull">pull 방식</label>
          <Dropdown id="set-pull" label="pull 방식" value={s.pullMode} options={PULL_OPTIONS} onChange={(pullMode) => void saveSettings({ pullMode })} />
          <span />
          <label className="set-check">
            <input id="set-reopen" type="checkbox" checked={s.reopenLast} onChange={(e) => void saveSettings({ reopenLast: e.target.checked })} /> 켤 때 마지막 저장소 다시 열기
          </label>
        </div>
        <p className="muted set-hint">화면 문구는 지금 한국어만 지원합니다.</p>
        <div className="ask-actions"><button type="submit" className="primary">닫기</button></div>
      </form>
    </dialog>
  );
};

export default SettingsSection;
