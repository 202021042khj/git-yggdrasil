import useMainLogic from "@/hooks/useMainLogic";
import DesktopPageContainer from "@/components/pages/main/DesktopPageContainer";

/** 앱의 유일한 화면 (창 하나 · 라우팅 없음) */
const MainPage = () => {
  const logic = useMainLogic();

  return <DesktopPageContainer {...logic} />;
};

export default MainPage;
