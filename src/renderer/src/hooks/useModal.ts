import { useEffect, useLayoutEffect, useRef } from "react";

import useCallbackRef from "@/hooks/useCallbackRef";

/**
 * 네이티브 <dialog> 를 open 값에 맞춰 showModal / close 한다.
 * Esc · form method="dialog" · close() 어느 쪽으로 닫혀도 onClose 를 부른다 (상태를 닫힘으로 되돌리게).
 */
const useModal = (open: boolean, onClose: () => void) => {
  const ref = useRef<HTMLDialogElement>(null);
  const handleClose = useCallbackRef(onClose);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.addEventListener("close", handleClose);
    return () => d.removeEventListener("close", handleClose);
  }, [handleClose]);

  return ref;
};

export default useModal;
