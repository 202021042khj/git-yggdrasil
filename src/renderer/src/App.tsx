import "@/styles/index.css";

import IconSprite from "@/components/common/IconSprite";
import AskDialog from "@/components/ui/AskDialog";
import CredentialDialog from "@/components/ui/CredentialDialog";
import Menu from "@/components/ui/Menu";
import NoticeDialog from "@/components/ui/NoticeDialog";
import Toast from "@/components/ui/Toast";
import useSmallStore from "@/hooks/useSmallStore";
import { localeStore } from "@/app/locale";
import MainPage from "@/pages/MainPage";

/** 최상위: 전역 스타일 · 아이콘 · 화면 · 어디서든 함수로 여는 부품(토스트 · 메뉴 · 입력창).
 *  화면 언어를 구독해, 바뀌면 아래 전체가 새 언어로 다시 그린다 (memo 한 컴포넌트가 없다) */
const App = () => {
  useSmallStore(localeStore);
  return (
    <>
      <IconSprite />
      <MainPage />
      {/* 드래그 중 동사 라벨 · 결과 설명 · 끄는 항목 (interactions/drag 가 직접 채운다) */}
      <div id="v2-layer" className="v2-layer" aria-hidden="true" />
      <div id="tip" className="tip hidden" />
      <div id="ghost" className="ghost hidden" />
      <Menu />
      <AskDialog />
      <NoticeDialog />
      <CredentialDialog />
      <Toast />
    </>
  );
};

export default App;
