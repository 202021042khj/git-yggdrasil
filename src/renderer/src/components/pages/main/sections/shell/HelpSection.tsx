interface HelpSectionProps {
  open: boolean;
}

/** 도움말 패널 (상단의 도움말 버튼으로 연다) */
const HelpSection = ({ open }: HelpSectionProps) => (
  <div id="help" className={`help${open ? "" : " hidden"}`}>
    <h3>끌면 놓을 곳이 보입니다</h3>
    <p>커밋, 브랜치 이름표, 변경 묶음, 파일, stash 카드, 원격 이름표를 끌기 시작하면 놓을 수 있는 모든 곳에 무슨 일이 일어나는지 적힌 라벨이 뜹니다. 라벨에 가까이 가면 자석처럼 붙고, 결과가 캔버스에 겹쳐 보입니다.</p>
    <p>할 수 있는 일이 여러 개인 곳(예: 커밋을 다른 브랜치에 놓기 = 옮기기 또는 복사)에 놓으면 메뉴가 뜹니다. 숫자 키나 화살표와 Enter 로 고르고, <kbd>Esc</kbd> 로 취소합니다.</p>
    <p>끌지 않고도 됩니다. 아무 항목이나 <b>오른쪽 클릭</b>하면 같은 조작을 메뉴에서 고를 수 있습니다.</p>
    <p>브랜치 이름표를 끌면 그 브랜치의 커밋이 함께 움직입니다(rebase). 합치기(merge)와 포인터만 옮기기는 메뉴에 있습니다.</p>
    <h3>공통</h3>
    <p>이름표 더블클릭은 checkout, 커밋 더블클릭은 메시지 수정입니다. push 된 커밋(색이 찬 노드)을 다시 쓰는 조작은 실행 전에 확인합니다. 충돌이 나면 멈추고 오른쪽 패널에서 해결합니다. <kbd>⌘Z</kbd> 로 언제든 되돌립니다.</p>
  </div>
);

export default HelpSection;
