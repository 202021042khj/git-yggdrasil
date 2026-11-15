import "./Toast.css";

import useSmallStore from "@/hooks/useSmallStore";
import { toastStore } from "@/components/ui/toastUtils";

const Toast = () => {
  const msg = useSmallStore(toastStore);

  return (
    <div id="toast" className={`toast${msg ? "" : " hidden"}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
};

export default Toast;
