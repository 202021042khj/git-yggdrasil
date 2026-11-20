import "./Dialog.css";
import "./CredentialDialog.css";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { errorText } from "@/lib/html";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { confirmAction } from "@/components/ui/dialogUtils";
import { credentialStore, helperName, tipFor } from "@/components/ui/credentialUtils";
import { t } from "@shared/i18n/i18n";

/** askCredential() 로 여는 로그인 창: 사용자 이름과 토큰을 git 자격 증명 도우미에 저장한다 */
const CredentialDialog = () => {
  const ask = useSmallStore(credentialStore);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const saved = useRef(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const ref = useModal(!!ask, () => {
    const cur = credentialStore.get();
    setPass("");
    if (!cur) return;
    credentialStore.set(null);
    cur.resolve(saved.current);
  });

  // 창이 열릴 때만 초기화한다. 사용자 이름은 지난번 값을 남겨 둔다 (같은 사람이 다시 입력하는 경우가 많다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: user 가 바뀔 때마다 다시 초기화하면 안 된다
  useEffect(() => {
    if (!ask) return;
    saved.current = false;
    setPass("");
    setError("");
    requestAnimationFrame(() => (user ? passRef : userRef).current?.focus());
  }, [ask]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ask) return;
    setError("");
    try {
      let r = await window.gitApi.saveCredential({ url: ask.url, username: user, password: pass });
      if (r.needsHelper !== undefined) {
        if (!r.needsHelper) { setError(r.message ?? t("cred.noHelper")); return; }
        const name = helperName(r.needsHelper);
        if (!confirmAction(t("cred.enableHelper", { name, helper: r.needsHelper }))) return;
        r = await window.gitApi.saveCredential({ url: ask.url, username: user, password: pass, enableHelper: true });
      }
      saved.current = true;
      setPass("");
      ref.current?.close();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <dialog id="cred" ref={ref} className="ask cred" aria-labelledby="cred-title">
      <form id="cred-form" onSubmit={handleSubmit}>
        <h2 id="cred-title">{t("cred.title")}</h2>
        <p id="cred-host" className="muted">
          {ask && t("cred.intro", { host: ask.host })}
        </p>
        <label htmlFor="cred-user">{t("cred.user")}</label>
        <input id="cred-user" ref={userRef} type="text" autoComplete="username" spellCheck={false} required value={user} onChange={(e) => setUser(e.target.value)} />
        <label htmlFor="cred-pass">{t("cred.pass")}</label>
        <input id="cred-pass" ref={passRef} type="password" autoComplete="current-password" spellCheck={false} required value={pass} onChange={(e) => setPass(e.target.value)} />
        <p id="cred-tip" className="muted cred-tip">{ask && tipFor(ask.host)}</p>
        <p id="cred-error" className="cred-error" role="alert">{error}</p>
        <div className="ask-actions">
          <button type="submit" className="primary">{t("cred.save")}</button>
          <button type="button" onClick={() => ref.current?.close()}>{t("common.cancel")}</button>
        </div>
      </form>
    </dialog>
  );
};

export default CredentialDialog;
