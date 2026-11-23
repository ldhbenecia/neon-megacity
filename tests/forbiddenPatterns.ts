// Patterns for text that must never ship: the dropped city and river names, and hanja.
// Hanja ranges are written as escapes so this file itself stays free of hanja.
export const OLD_NAMES = /ramha|\uB78C\uD558|\uD751\uB9B0/i;
export const HANJA = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
