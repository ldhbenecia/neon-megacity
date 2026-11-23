import { CORPS } from '../city/layout';
import type { NeonName } from '../core/palette';

export type CellKind =
  'band' | 'blade' | 'vtext' | 'crown' | 'panel' | 'ring' | 'line' | 'ad' | 'tent' | 'logo' | 'koi';

export interface Shop {
  name: string;
  sub: string;
  kind: CellKind;
  color: NeonName;
}

// Copy rule: no hanja; high-rise kinds (crown, ring, line, logo, koi) are English except apartment
// complex crowns, which keep their Korean name; street-level kinds are at least 85% Korean.
// Business names are fictional; real Seoul place names are allowed (tests/neonCopy.test.ts).
export const SHOPS: readonly Shop[] = [
  { name: '노량진 새벽수산', sub: '', kind: 'vtext', color: 'neonCyan' },
  { name: '달무리 코인노래방', sub: '', kind: 'band', color: 'neonMagenta' },
  { name: '한강전자상가', sub: '', kind: 'vtext', color: 'neonOrange' },
  { name: '새벽불 칼국수', sub: '24시', kind: 'band', color: 'neonAmber' },
  { name: '네온나비 PC방', sub: '', kind: 'blade', color: 'neonTeal' },
  { name: '구름다리 약국', sub: '', kind: 'band', color: 'neonTeal' },
  { name: '천층사우나', sub: '', kind: 'vtext', color: 'neonRed' },
  { name: '별계단 분식', sub: '', kind: 'band', color: 'neonOrange' },
  { name: '심야약방', sub: '', kind: 'blade', color: 'neonCyan' },
  { name: '기계심장 정비소', sub: '', kind: 'band', color: 'neonRed' },
  { name: '반딧불 포차', sub: '', kind: 'tent', color: 'neonOrange' },
  { name: '무한궤도 오락실', sub: '', kind: 'blade', color: 'neonMagenta' },
  { name: '은빛잉어 횟집', sub: '', kind: 'band', color: 'neonCyan' },
  { name: '파란고래 인력사무소', sub: '', kind: 'band', color: 'neonCyan' },
  { name: '회로당 수리', sub: '', kind: 'blade', color: 'neonOrange' },
  { name: '꿈공장 렌탈', sub: '', kind: 'band', color: 'neonAmber' },
  { name: '야광고양이', sub: '', kind: 'blade', color: 'neonMagenta' },
  { name: '유령주파수', sub: '', kind: 'vtext', color: 'neonRed' },
  { name: '골목끝 치킨', sub: '', kind: 'band', color: 'neonOrange' },
  { name: '24시 할매해장국', sub: '', kind: 'band', color: 'neonRed' },
];

export const CORP_EN: Readonly<Record<(typeof CORPS)[number], { name: string; tag: string }>> = {
  연무중공업: { name: 'YEONMU HEAVY', tag: 'LIFT TOMORROW' },
  휘광바이오: { name: 'HWIGWANG BIO', tag: 'CELLS REBORN' },
  심연통신: { name: 'ABYSSNET', tag: 'CONNECT DEEPER' },
  하운금융: { name: 'HAWOON FINANCE', tag: 'HANGANG FINANCIAL' },
  'teraSHIN 반도체': { name: 'TERASHIN', tag: 'ONE ANGSTROM' },
  청람로보틱스: { name: 'CHEONGRAM ROBOTICS', tag: 'MACHINES BY YOUR SIDE' },
};

export const CARGO_CROWN = { name: 'UNHAE CARGO', tag: 'HANGANG PORT' } as const;

export const GENERIC_BANDS: readonly { name: string; sub: string }[] = [
  { name: '반달 당구장', sub: '' },
  { name: '해오름 공인중개사', sub: '' },
  { name: '물방울 코인세탁', sub: '' },
  { name: '밤하늘 만화방', sub: '' },
  { name: '푸른등 치과', sub: '' },
  { name: '돌계단 노래방', sub: '' },
  { name: '강안개 다방', sub: '' },
  { name: '심해 수족관', sub: '' },
  { name: '은하 전파사', sub: '' },
  { name: '빗방울 우산집', sub: '' },
  { name: '삼첩 한의원', sub: '' },
  { name: '새벽시장 정육점', sub: '' },
  { name: '불빛 안경원', sub: '' },
  { name: '회색비 헬스', sub: 'GYM' },
  { name: '반짝 휴대폰', sub: '' },
  { name: '달빛 모텔', sub: '' },
  { name: '골목 편의점', sub: '24H' },
  { name: '번개 PC방', sub: '' },
  { name: '언덕위 교회', sub: '' },
  { name: '등불 고시원', sub: '' },
  { name: '구름 찜질방', sub: '' },
  { name: '을지로 공구상가', sub: '' },
  { name: '자정 국밥', sub: '' },
  { name: '별빛 미용실', sub: '' },
  { name: '골목 떡볶이', sub: '' },
  { name: '언덕 세탁소', sub: '' },
  { name: '한강 숯불갈비', sub: '' },
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
  '모텔',
  '편의점',
  'PC방',
  '치킨',
  '해장국',
];

export const GENERIC_VTEXT: readonly string[] = [
  '청계회관',
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
  '24시',
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

export const RING_COPY: readonly string[] = [
  '◆ YEONMU HEAVY ◆ LIFT TOMORROW',
  '◆ HWIGWANG BIO ◆ CELLS REBORN',
  '◆ ABYSSNET ◆ CONNECT DEEPER',
  '◆ HAWOON FINANCE ◆ ASSETS THAT FLOW',
  '◆ TERASHIN ◆ ONE ANGSTROM DREAM',
  '◆ CHEONGRAM ROBOTICS ◆ MACHINES BY YOUR SIDE',
];

export const SCREEN_LINES: readonly string[] = [
  'WELCOME TO NEO SEOUL',
  'RAIN 82% TONIGHT',
  'ABYSSNET 6G UNLIMITED',
  'NEW SKIN, NEW YOU',
  'FM 88.7 GHOST WAVE',
  'HANGANG NEVER SLEEPS',
  'TERASHIN INSIDE',
  'STAY WARM, STAY WIRED',
];

export const AD_COPY: readonly { name: string; sub: string }[] = [
  { name: '휘광바이오', sub: '새 피부 상담' },
  { name: '심연통신', sub: '6G 무제한' },
  { name: '청람로보틱스', sub: '가사로봇 체험' },
  { name: '한강 불꽃축제', sub: '토요일 밤' },
  { name: '하운금융', sub: '꿈을 저축하세요' },
  { name: '유령주파수', sub: 'FM 88.7' },
];

export const TENT_COPY: readonly string[] = [
  '반딧불 포차',
  '강바람 포차',
  '한강 포장마차',
  '달빛 꼼장어',
];

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

export function hasHanja(s: string): boolean {
  return Array.from(s).some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (
      (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)
    );
  });
}

export function hasHangul(s: string): boolean {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/u.test(s);
}
