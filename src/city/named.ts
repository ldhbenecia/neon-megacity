// Named arterials (SEOUL.md 5.3). They are laid before the zone grids and become arterial
// `Road` segments; `NamedRoad` keeps the polyline and the real name for HUD and neon.
import { TEHERAN } from './districts';
import type { Bridge, NamedRoad, Vec2 } from './types';

function landing(bridges: readonly Bridge[], id: string, side: 'north' | 'south'): Vec2 {
  const br = bridges.find((b) => b.id === id);
  if (!br) throw new Error(`named road needs bridge ${id}`);
  return side === 'north' ? { ...br.landA } : { ...br.landB };
}

export function makeNamedRoads(bridges: readonly Bridge[]): NamedRoad[] {
  // 서울역 sits west of 남산 in reality; with the plan compressed 1:6 its projection (-282, -456)
  // lands on the mountain, so it is moved to the foot of the slope.
  const seoulStation = { x: -480, z: -520 };
  const gwanghwamun = { x: -190, z: -890 };
  return [
    { id: 'rd-sejong', name: '세종대로', width: 50, points: [gwanghwamun, seoulStation] },
    {
      id: 'rd-jongno',
      name: '종로',
      width: 30,
      points: [
        { x: -190, z: -820 },
        { x: 290, z: -760 },
      ],
    },
    {
      id: 'rd-hangang',
      name: '한강대로',
      width: 40,
      points: [seoulStation, landing(bridges, 'br-hangang', 'north')],
    },
    {
      id: 'rd-mapo',
      name: '마포대로',
      width: 36,
      points: [landing(bridges, 'br-mapo', 'north'), { x: -573, z: -300 }, seoulStation],
    },
    {
      id: 'rd-yanghwa',
      name: '양화로',
      width: 30,
      points: [landing(bridges, 'br-yanghwa', 'north'), { x: -985, z: -481 }, { x: -800, z: -640 }],
    },
    {
      id: 'rd-gangnam',
      name: '강남대로',
      width: 50,
      // 한남대교 is not in v3; the avenue starts at the nearest landing (동호대교 south, 압구정).
      points: [landing(bridges, 'br-dongho', 'south'), TEHERAN[0], { x: 600, z: 1250 }],
    },
    { id: 'rd-teheran', name: '테헤란로', width: 50, points: [TEHERAN[0], TEHERAN[1]] },
    {
      id: 'rd-yeongdong',
      name: '영동대로',
      width: 50,
      // 영동대교 is not in v3; the avenue starts at 청담대교's south landing next to it.
      points: [landing(bridges, 'br-cheongdam', 'south'), TEHERAN[1], { x: 1100, z: 800 }],
    },
    {
      id: 'rd-banpo',
      name: '반포대로',
      width: 40,
      points: [landing(bridges, 'br-banpo', 'south'), { x: 60, z: 900 }],
    },
    {
      id: 'rd-olympic-ro',
      name: '올림픽로',
      width: 40,
      points: [
        { x: 1300, z: 400 },
        { x: 1990, z: 400 },
      ],
    },
  ];
}
