import "./SettingsSection.css";

import { useEffect, useState } from "react";

import Dropdown from "@/components/ui/Dropdown";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { saveSettings, settingsOpenStore, settingsStore } from "@/components/pages/main/sections/dialogs/settingsUtils";
import { t } from "@shared/i18n/i18n";
import type { Settings } from "@shared/types/ipc";

const themeOptions = (): Array<{ value: Settings["theme"]; label: string }> => [
  { value: "system", label: t("set.theme.system") },
  { value: "light", label: t("set.theme.light") },
  { value: "dark", label: t("set.theme.dark") },
];
const fetchOptions = () => [
  { value: "0", label: t("set.fetch.off") },
  { value: "5", label: t("set.fetch.min", { n: 5 }) },
  { value: "15", label: t("set.fetch.min", { n: 15 }) },
  { value: "30", label: t("set.fetch.min", { n: 30 }) },
  { value: "60", label: t("set.fetch.hour") },
];
/** 언어 이름은 그 언어로 적는다 (지금 화면 언어를 못 읽는 사람도 고를 수 있게) */
const languageOptions = (): Array<{ value: Settings["language"]; label: string }> => [
  { value: "system", label: t("set.lang.system") },
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
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
        <h2 id="settings-title">{t("set.title")}</h2>
        <div className="set-grid">
          <label htmlFor="set-lang">{t("set.lang")}</label>
          <Dropdown id="set-lang" label={t("set.lang")} value={s.language} options={languageOptions()} onChange={(language) => void saveSettings({ language })} />
          <label htmlFor="set-theme">{t("set.theme")}</label>
          <Dropdown id="set-theme" label={t("set.theme")} value={s.theme} options={themeOptions()} onChange={(theme) => void saveSettings({ theme })} />
          <label htmlFor="set-zoom">{t("set.zoom")}</label>
          <span className="set-zoom">
            <input id="set-zoom" type="range" min="0.8" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} onPointerUp={() => void saveSettings({ zoom })} onKeyUp={() => void saveSettings({ zoom })} />
            <output id="set-zoom-out">{Math.round(zoom * 100)}%</output>
          </span>
          <label htmlFor="set-editor">{t("set.editor")}</label>
          <span>
            <input id="set-editor" type="text" placeholder={t("set.editorPlaceholder")} spellCheck={false} autoComplete="off" value={editor} onChange={(e) => setEditor(e.target.value)} onBlur={() => { if (editor !== s.editor) void saveSettings({ editor }); }} />
            <span className="muted set-hint">{t("set.editorHint")}</span>
          </span>
          <label htmlFor="set-fetch">{t("set.fetch")}</label>
          <Dropdown id="set-fetch" label={t("set.fetch")} value={String(s.autoFetchMinutes)} options={fetchOptions()} onChange={(v) => void saveSettings({ autoFetchMinutes: Number(v) })} />
          <label htmlFor="set-pull">{t("set.pull")}</label>
          <Dropdown id="set-pull" label={t("set.pull")} value={s.pullMode} options={PULL_OPTIONS} onChange={(pullMode) => void saveSettings({ pullMode })} />
          <span />
          <label className="set-check">
            <input id="set-reopen" type="checkbox" checked={s.reopenLast} onChange={(e) => void saveSettings({ reopenLast: e.target.checked })} /> {t("set.reopen")}
          </label>
        </div>
        <div className="ask-actions"><button type="submit" className="primary">{t("common.close")}</button></div>
      </form>
    </dialog>
  );
};

export default SettingsSection;
