// Sign copy for RAMHA (ART_DIRECTION 5.3). Every name here is fictional: no real shops,
// brands, places or names from existing works. Pure data, shared by the atlas and placement.
import { CORPS } from '../city/layout';
import type { NeonName } from '../core/palette';

/** Which atlas cell family a piece of copy is drawn into. */
export type CellKind =
  | 'band' // horizontal shop band (상가 가로 간판 띠)
  | 'blade' // narrow vertical projecting sign
  | 'vtext' // big vertical letters on a side wall
  | 'crown' // rooftop crown / corp name
  | 'panel' // small sign-pole panel
  | 'ring' // ring billboard strip (wraps around a cylinder)
  | 'ad' // bus-stop light box
  | 'tent' // 포장마차 tent banner
  | 'logo' // corp logo (holograms, screens)
  | 'koi'; // 흑린 koi hologram

export interface Shop {
  /** Korean name (main line). */
  name: string;
  /** Secondary mark: hanja or a little English. */
  sub: string;
  kind: CellKind;
  color: NeonName;
}

/** 5.3: the twenty fictional shops. */
export const SHOPS: readonly Shop[] = [
  { name: '흑린수산', sub: '黑鱗', kind: 'vtext', color: 'neonCyan' },
  { name: '달무리 코인노래연습장', sub: 'MOONHALO', kind: 'band', color: 'neonMagenta' },
  { name: '람하 전뇌상가', sub: '電腦', kind: 'vtext', color: 'neonOrange' },
  { name: '새벽불 칼국수', sub: '24H', kind: 'band', color: 'neonAmber' },
  { name: '네온나비 PC존', sub: 'NEON MOTH', kind: 'blade', color: 'neonTeal' },
  { name: '구름다리 약국', sub: '藥', kind: 'band', color: 'neonTeal' },
  { name: '천층 사우나', sub: '千層', kind: 'vtext', color: 'neonRed' },
  { name: '별계단 분식', sub: '', kind: 'band', color: 'neonOrange' },
  { name: '심야약방', sub: '深夜', kind: 'blade', color: 'neonCyan' },
  { name: '기계심장 정비소', sub: 'CYBER-ORGAN', kind: 'band', color: 'neonRed' },
  { name: '반딧불 포차', sub: '', kind: 'tent', color: 'neonOrange' },
  { name: '운해물류', sub: '雲海 CARGO', kind: 'crown', color: 'neonWhite' },
  { name: '무한궤도 오락실', sub: '∞ ARCADE', kind: 'blade', color: 'neonMagenta' },
  { name: '은빛잉어 횟집', sub: '銀鯉', kind: 'band', color: 'neonCyan' },
  { name: '파란고래 인력사무소', sub: '', kind: 'band', color: 'neonCyan' },
  { name: '회로당 수리', sub: '回路堂', kind: 'blade', color: 'neonOrange' },
  { name: '꿈공장 렌탈', sub: 'DREAM RENT', kind: 'band', color: 'neonAmber' },
  { name: '야광고양이 바', sub: 'GLOWCAT', kind: 'blade', color: 'neonMagenta' },
  { name: '유령주파수 FM 88.7', sub: '', kind: 'vtext', color: 'neonRed' },
  { name: '새빛마을 3단지', sub: '', kind: 'crown', color: 'neonWhite' },
];

/** Corp hanja / English marks for the six fictional megacorps (CORPS from the layout). */
export const CORP_MARKS: Readonly<Record<(typeof CORPS)[number], string>> = {
  연무중공업: '煙霧重工',
  휘광바이오: '輝光',
  심연통신: '深淵 ABYSSNET',
  하운금융: '河雲',
  'teraSHIN 반도체': 'SEMICONDUCTOR',
  청람로보틱스: 'CHEONGRAM',
};

/**
 * Extra generic shop copy so ~3000 signs do not repeat the twenty names too visibly.
 * Generic Korean nouns and invented names only. Mix follows 5.3 roughly:
 * Korean only 70%, Korean + hanja 15%, Korean + English 12%, English only 3%.
 */
export const GENERIC_BANDS: readonly { name: string; sub: string }[] = [
  { name: '골목끝 호프', sub: '' },
  { name: '반달 당구장', sub: '' },
  { name: '해오름 부동산', sub: '' },
  { name: '물방울 세탁', sub: '' },
  { name: '밤하늘 만화방', sub: '' },
  { name: '푸른등 치과', sub: '' },
  { name: '소금빛 순대국', sub: '' },
  { name: '돌계단 노래방', sub: '' },
  { name: '강안개 다방', sub: '茶房' },
  { name: '심해 수족관', sub: '深海' },
  { name: '전파상 은하', sub: '銀河' },
  { name: '빗방울 우산집', sub: '' },
  { name: '삼첩 한의원', sub: '韓醫院' },
  { name: '새벽시장 정육', sub: '' },
  { name: '불빛 안경원', sub: '' },
  { name: '회색비 헬스', sub: 'GYM' },
  { name: '반짝 휴대폰', sub: 'MOBILE' },
  { name: '등불 고시원', sub: '' },
  { name: '구름 찜질방', sub: '' },
  { name: '흑린 수리센터', sub: 'REPAIR' },
  { name: '자정 국밥', sub: '' },
  { name: '별빛 미용실', sub: '' },
  { name: 'NIGHT OWL', sub: '' },
];

export const GENERIC_BLADES: readonly string[] = [
  '노래방',
  '여관',
  '당구장',
  '호프',
  '약국',
  '분식',
  '만화방',
  '사우나',
  '수리',
  '전당포',
  '24시',
  '찜질방',
  '다방',
  '국밥',
  '세탁',
  '오락실',
];

export const GENERIC_VTEXT: readonly string[] = [
  '흑린빌딩',
  '전자상가',
  '삼첩회관',
  '운해호텔',
  '등불시장',
  '밤의정원',
];

export const PANEL_WORDS: readonly string[] = [
  '노래방',
  '호프',
  '분식',
  '약국',
  '24H',
  '당구',
  '국밥',
  '수리',
  'PC',
  '세탁',
  '안경',
  '치킨',
  '다방',
  '포차',
  '여관',
  '꽃집',
];

/** Ring billboard strips: corp slogans (fictional). */
export const RING_COPY: readonly string[] = [
  '◆ 연무중공업 煙霧重工 ◆ 내일을 들어 올리는 손',
  '◆ 휘광바이오 輝光 ◆ 다시 태어나는 세포',
  '◆ 심연통신 ABYSSNET ◆ 깊이 연결되다',
  '◆ 하운금융 河雲 ◆ 강물처럼 흐르는 자산',
  '◆ teraSHIN 반도체 ◆ 1옹스트롬의 꿈',
  '◆ 청람로보틱스 ◆ 당신 곁의 기계',
];

/** Bus-stop light boxes. */
export const AD_COPY: readonly { name: string; sub: string }[] = [
  { name: '휘광바이오', sub: '새 피부 상담' },
  { name: '심연통신', sub: '6G 무제한' },
  { name: '청람로보틱스', sub: '가사로봇 체험' },
  { name: '흑린 불꽃축제', sub: '토요일 밤' },
  { name: '하운금융', sub: '꿈을 저축하세요' },
  { name: '유령주파수', sub: 'FM 88.7' },
];

export const TENT_COPY: readonly string[] = [
  '반딧불 포차',
  '강바람 포차',
  '흑린 포장마차',
  '달빛 꼼장어',
];

/** Neon colors for generic copy, weighted toward red / orange and teal (principle 2). */
export const GENERIC_COLORS: readonly NeonName[] = [
  'neonRed',
  'neonOrange',
  'neonOrange',
  'neonAmber',
  'neonRed',
  'neonCyan',
  'neonTeal',
  'neonCyan',
  'neonWhite',
  'neonMagenta',
];
