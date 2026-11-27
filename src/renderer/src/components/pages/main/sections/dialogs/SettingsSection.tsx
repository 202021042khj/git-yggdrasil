import "./SettingsSection.css";

import { useEffect, useState } from "react";

import Dropdown from "@/components/ui/Dropdown";
import { confirmAction } from "@/components/ui/dialogUtils";
import useAsync from "@/hooks/useAsync";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { run } from "@/app/actions";
import { store } from "@/app/store";
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

/** 커밋 서명: 지금 저장소에 적용되는 값과, 이 저장소에만 켜고 끄는 스위치 (확인 후 .git/config 에 쓴다) */
const SigningRow = ({ isOpen }: { isOpen: boolean }) => {
  const [tick, setTick] = useState(0);
  const hasRepo = isOpen && store.hasRepo();
  const { data } = useAsync(() => (hasRepo ? window.gitApi.signing() : Promise.resolve(null)), [hasRepo, tick]);

  const toggle = async (on: boolean) => {
    const cmd = `git config --local commit.gpgsign ${on}`;
    if (!confirmAction(t("set.sign.confirm", { cmd }))) return;
    await run({ op: "setSigning", args: [on], summary: t("set.sign.summary", { on }) });
    setTick((n) => n + 1);
  };

  return (
    <>
      <label htmlFor="set-sign">{t("set.sign")}</label>
      {!data ? <span className="muted set-hint">{t("set.sign.noRepo")}</span> : (
        <span>
          <label className="set-check">
            <input id="set-sign" type="checkbox" checked={data.enabled} onChange={(e) => void toggle(e.target.checked)} /> {t("set.sign.toggle")} · <b>{data.enabled ? t("set.sign.on") : t("set.sign.off")}</b>
          </label>
          <span className="muted set-hint" id="set-sign-detail">
            {t("set.sign.detail", { format: data.format, key: data.key || t("set.sign.noKey") })}
            {data.local === null && data.enabled && ` · ${t("set.sign.fromGlobal")}`}
            <br /><code>git config --local commit.gpgsign {String(!data.enabled)}</code>
            <br />{t("set.sign.hint")}
          </span>
        </span>
      )}
    </>
  );
};

/** git hook: 설치된 hook · hook 폴더(core.hooksPath · husky) 와, 이 저장소에서만 hook 을 건너뛰는 스위치 */
const HooksRow = ({ isOpen }: { isOpen: boolean }) => {
  const [tick, setTick] = useState(0);
  const hasRepo = isOpen && store.hasRepo();
  const { data } = useAsync(() => (hasRepo ? window.gitApi.hooks() : Promise.resolve(null)), [hasRepo, tick]);

  const toggle = async (on: boolean) => {
    const cmd = `git config --local yggdrasil.skipHooks ${on}`;
    if (!confirmAction(t("set.hooks.skipConfirm", { cmd }))) return;
    await run({ op: "setSkipHooks", args: [on], summary: t("set.hooks.skipSummary", { on }) });
    setTick((n) => n + 1);
  };

  return (
    <>
      <label htmlFor="set-hooks-skip">{t("set.hooks")}</label>
      {!data ? <span className="muted set-hint">{t("set.hooks.noRepo")}</span> : (
        <span>
          <label className="set-check">
            <input id="set-hooks-skip" type="checkbox" checked={data.skip} onChange={(e) => void toggle(e.target.checked)} /> {t("set.hooks.skip")}
          </label>
          <span className="muted set-hint" id="set-hooks-detail">
            {data.hooks.length ? data.hooks.map((h) => (
              <span key={h.name}><code>{h.name}</code>{!h.executable && ` (${t("set.hooks.notExec")})`} </span>
            )) : t("set.hooks.none")}
            <br />{t("set.hooks.dir", { dir: data.dir })}
            {data.configured && <><br />{t("set.hooks.configured", { path: data.configured })}{data.husky && ` · ${t("set.hooks.husky")}`}</>}
            {data.skip && <><br /><code>git commit --no-verify · git push --no-verify</code></>}
            <br />{t("set.hooks.hint")}
          </span>
        </span>
      )}
    </>
  );
};

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
          <SigningRow isOpen={isOpen} />
          <HooksRow isOpen={isOpen} />
        </div>
        <div className="ask-actions"><button type="submit" className="primary">{t("common.close")}</button></div>
      </form>
    </dialog>
  );
};

export default SettingsSection;
