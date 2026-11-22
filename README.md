# Neon Megacity

가상의 도시 **가람(GARAM)** 을 마우스와 키보드로 날아다니며 둘러보는 브라우저 기반 사이버펑크 도시입니다.
three.js(r0.187) + Vite + TypeScript(strict)로 만들었으며, 도시와 간판, 이름은 모두 이 프로젝트를 위해 새로 만든 오리지널 디자인입니다.

**라이브 데모:** https://ldhbenecia.github.io/neon-megacity/

## 조작법

| 입력                        | 동작                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| 왼쪽 드래그                 | 둘러보기(회전)                                                           |
| 오른쪽 드래그, Shift+드래그 | 지면을 따라 이동                                                         |
| 마우스 휠                   | 커서가 가리키는 곳으로 부드럽게 줌                                       |
| 클릭                        | 건물로 날아가서 건물 정보 카드 보기                                      |
| 더블클릭                    | 그 지점으로 이동                                                         |
| `W` `A` `S` `D`, 방향키     | 앞뒤좌우 이동(높을수록 빠름)                                             |
| `Q` / `E`                   | 내려가기 / 올라가기                                                      |
| `Shift`                     | 세 배 빠르게                                                             |
| `F`                         | 비행 모드(마우스로 시선, `Esc`로 끄기)                                   |
| `1` ~ `8`                   | 카메라 위치(강변, 코어 상공, 등불가 거리 등)                             |
| `C`                         | 시네마틱 카메라(입력 없이 90초가 지나도 시작)                            |
| `R`                         | 처음 위치로                                                              |
| `H`                         | 화면 정보 숨기기                                                         |
| `?`                         | 조작법 보기                                                              |
| `Esc`                       | 패널, 조작법, 비행 모드, 선택 순서로 닫기                                |
| 터치                        | 한 손가락 회전, 두 손가락 줌과 이동, 탭은 건물 정보, 두 번 탭은 날아가기 |

화면 아래 타임라인으로 시각을 바꾸거나 시간 흐름을 멈출 수 있고, 오른쪽 위 버튼으로 날씨(맑음, 비, 폭우), 카메라 위치, 시네마틱, 비행 모드를 고를 수 있습니다.

## URL 쿼리 파라미터

스크린샷이나 디버깅을 위해 장면을 고정할 수 있습니다. 예: `?time=0.5&cam=street&rain=0`

| 파라미터       | 값                                                     | 설명                                                   |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `?time=0..1`   | `0` 자정, `0.25` 오전 6시, `0.5` 정오, `0.75` 오후 6시 | 시간대를 고정합니다(시간 흐름 정지).                   |
| `?cam=name`    | `overview`, `street`, `core`, `topdown`, `skyline`     | 미리 정의된 카메라 위치로 시작합니다.                  |
| `?preset=1..8` | 카메라 위치 번호                                       | `?cam`이 없을 때 그 번호의 위치로 시작합니다.          |
| `?rain=0..1`   | `0` 맑음 ~ `1` 폭우                                    | 초기 비 강도를 지정합니다.                             |
| `?hud=0`       | (값 없음)                                              | 화면 정보를 숨긴 채 시작합니다.                        |
| `?stats`       | (값 없음)                                              | fps, draw calls, triangles 오버레이와 `window.__garam` |
| `?debug`       | (값 없음)                                              | 개발자용 lil-gui 패널을 띄웁니다.                      |
| `?nogui`       | (값 없음)                                              | `?debug`여도 lil-gui 패널을 숨깁니다.                  |

범위를 벗어난 숫자는 0..1로 잘리고, 알 수 없는 값은 무시됩니다.

## 명령어

Node 24 이상이 필요합니다.

```bash
npm ci                 # 의존성 설치
npm run dev            # 개발 서버 (Vite)
npm run build          # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview        # dist/ 미리보기
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint (lint:fix 로 자동 수정)
npm run format:check   # Prettier 검사 (format 으로 자동 정리)
npm test               # Vitest 단위 테스트
npm run test:e2e       # Playwright e2e 스모크 테스트
npm run shots          # 고정된 장면 스크린샷 촬영 (screenshots/<label>/)
```

`npm run shots -- <label> [--swiftshader] [--no-build]` 처럼 라벨과 옵션을 넘길 수 있습니다.

## 구조

```
src/
  main.ts          렌더러, 카메라, OrbitControls, 메인 루프, GUI 루트
  core/            공유 타입(types.ts), 시드 난수(random.ts), URL 쿼리 파싱(query.ts), HUD 시계 포맷(clock.ts)
  city/layout.ts   블록 / 도로 / 건물 배치의 단일 기준
  lighting/        시간대, 해/달, 하늘, 그림자, 노출
  buildings/       지면, 도로, 건물 지오메트리, 창문
  neon/            간판, 홀로그램, 가로등, 지상 및 비행 교통
  atmosphere/      안개, 비, 별, 구름, 서치라이트, 후처리
tests/             Vitest 단위 테스트, tests/e2e/ 에 Playwright 테스트
scripts/           스크린샷 스크립트(screenshot.ts)
docs/              아키텍처 문서
.github/workflows/ CI, 자동 포맷 수정(autofix), GitHub Pages 배포
```

각 기능 폴더는 `init(ctx) -> { update(dt, elapsed), dispose() }` 형태의 모듈을 내보내며,
lighting → buildings → neon → atmosphere 순서로 초기화되고 갱신됩니다.
자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.

## CI와 배포

- **CI** (`ci.yml`): PR과 main 푸시마다 포맷, 린트, 타입 검사, 단위 테스트, 빌드, e2e 테스트를 실행합니다.
- **Autofix** (`autofix.yml`): 같은 저장소의 PR에서 린트/포맷 문제를 자동으로 고쳐 커밋하고, 그 커밋에 대해 CI를 다시 실행합니다.
- **Pages** (`pages.yml`): main에 푸시된 커밋의 CI가 통과하면 그 커밋을 `/neon-megacity/` 경로로 빌드해 GitHub Pages에 배포합니다.

## 참고

- 모든 텍스처와 효과는 캔버스와 셰이더로 절차적으로 생성합니다. 외부 에셋 파일이나 CDN을 쓰지 않습니다.
- 도시, 간판 문구, 기업명 등은 모두 가상의 것입니다. 실제 브랜드나 기존 게임·애니메이션의 이름, 캐릭터, 장소를 사용하지 않습니다.

## 라이선스

[MIT](LICENSE)
