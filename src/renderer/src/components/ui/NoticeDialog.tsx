import "./Dialog.css";

import { useEffect, useRef } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { noticeStore } from "@/components/ui/dialogUtils";
import { t } from "@shared/i18n/i18n";

/** showNotice() 로 여는 알림창: 원인 · 해결 방법 · git 원문 */
const NoticeDialog = () => {
  const notice = useSmallStore(noticeStore);
  const okRef = useRef<HTMLButtonElement>(null);
  const ref = useModal(!!notice, () => noticeStore.set(null));

  useEffect(() => { if (notice) okRef.current?.focus(); }, [notice]);

  return (
    <dialog id="notice" ref={ref} className="ask notice" aria-labelledby="notice-title">
      <form method="dialog">
        <h2 id="notice-title">{notice?.title}</h2>
        <p id="notice-body" className="notice-body">{notice?.body}</p>
        {notice?.detail && (
          <details id="notice-detail" key={notice.title + notice.detail}>
            <summary>{t("notice.raw")}</summary>
            <pre id="notice-detail-text">{notice.detail}</pre>
          </details>
        )}
        <div className="ask-actions">
          <button type="submit" id="notice-ok" ref={okRef} className="primary">{t("common.ok")}</button>
        </div>
      </form>
    </dialog>
  );
};

export default NoticeDialog;
