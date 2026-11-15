import "./Dialog.css";
import "./CredentialDialog.css";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { errorText } from "@/lib/html";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { confirmAction } from "@/components/ui/dialogUtils";
import { credentialStore, HELPER_NAME, tipFor } from "@/components/ui/credentialUtils";

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
        if (!r.needsHelper) { setError(r.message ?? "저장 도우미가 없습니다."); return; }
        const name = HELPER_NAME[r.needsHelper] ?? r.needsHelper;
        if (!confirmAction(`git 에 자격 증명 저장 도우미가 꺼져 있습니다.\n${name}(${r.needsHelper})에 저장하도록 git 전역 설정을 켤까요?\n\ngit config --global credential.helper ${r.needsHelper}`)) return;
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
        <h2 id="cred-title">로그인이 필요합니다</h2>
        <p id="cred-host" className="muted">
          {ask && `${ask.host} 에 접속하려면 로그인이 필요합니다. 입력한 정보는 이 컴퓨터의 git 자격 증명 도우미에 저장되고, 다음부터 자동으로 쓰입니다.`}
        </p>
        <label htmlFor="cred-user">사용자 이름</label>
        <input id="cred-user" ref={userRef} type="text" autoComplete="username" spellCheck={false} required value={user} onChange={(e) => setUser(e.target.value)} />
        <label htmlFor="cred-pass">액세스 토큰 (또는 앱 비밀번호)</label>
        <input id="cred-pass" ref={passRef} type="password" autoComplete="current-password" spellCheck={false} required value={pass} onChange={(e) => setPass(e.target.value)} />
        <p id="cred-tip" className="muted cred-tip">{ask && tipFor(ask.host)}</p>
        <p id="cred-error" className="cred-error" role="alert">{error}</p>
        <div className="ask-actions">
          <button type="submit" className="primary">저장하고 다시 시도</button>
          <button type="button" onClick={() => ref.current?.close()}>취소</button>
        </div>
      </form>
    </dialog>
  );
};

export default CredentialDialog;
