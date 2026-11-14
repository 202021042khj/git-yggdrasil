// 커밋 그래프 배치 (px)
/** 열 간격: 세대 하나당 가로 거리 */
export const DX = 130;
/** 줄 높이 기본값 (이름표가 많으면 더 벌어진다) */
export const DY = 120;
/** 첫 줄의 y (위는 원격 띠) */
export const TOP = 120;
export const PADX = 90;
/** 노드 아래로 쌓는 이름표 간격 */
export const LABEL_STEP = 24;
/** 이름표 글자 폭 추정 (px/글자) */
export const CHAR_W = 7.2;
export const LANE_COLORS = ["var(--lane-1)", "var(--lane-2)", "var(--lane-3)", "var(--lane-4)", "var(--lane-5)", "var(--lane-6)"];
/** 진행 중 작업(rebase 도중)의 끝을 보여 주는 가짜 ref 이름 */
export const OP_REF = "⏸ 진행 중";
/** 드래그 라벨이 자석처럼 붙는 거리 */
export const SNAP_PX = 28;
