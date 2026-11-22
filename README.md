# Neon Megacity

마우스로 자유롭게 둘러볼 수 있는 브라우저 기반 사이버펑크 도시입니다.
three.js(r0.187) + Vite + TypeScript(strict)로 만들었으며, 도시와 간판, 이름은 모두 이 프로젝트를 위해 새로 만든 오리지널 디자인입니다.

**라이브 데모:** https://ldhbenecia.github.io/neon-megacity/

## 조작법

| 입력                    | 동작                                 |
| ----------------------- | ------------------------------------ |
| 왼쪽 드래그             | 카메라 회전                          |
| 마우스 휠               | 줌 인 / 아웃                         |
| 오른쪽 드래그           | 지면을 따라 이동(팬)                 |
| `C`                     | 시네마틱 카메라(자동 궤도) 켜기/끄기 |
| 우측 상단 City Controls | lil-gui 패널에서 각종 값 조절        |

## URL 쿼리 파라미터

스크린샷이나 디버깅을 위해 장면을 고정할 수 있습니다. 예: `?time=0.5&cam=street&rain=0&nogui`

| 파라미터     | 값                                                     | 설명                                  |
| ------------ | ------------------------------------------------------ | ------------------------------------- |
| `?time=0..1` | `0` 자정, `0.25` 오전 6시, `0.5` 정오, `0.75` 오후 6시 | 시간대를 고정합니다(시간 흐름 정지).  |
| `?cam=name`  | `overview`, `street`, `core`, `topdown`, `skyline`     | 미리 정의된 카메라 위치로 시작합니다. |
| `?rain=0..1` | `0` 맑음 ~ `1` 폭우                                    | 초기 비 강도를 지정합니다.            |
| `?nogui`     | (값 없음)                                              | lil-gui 컨트롤 패널을 숨깁니다.       |

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
- **Pages** (`pages.yml`): main에 머지되면 `/neon-megacity/` 경로로 빌드해 GitHub Pages에 배포합니다.

## 참고

- 모든 텍스처와 효과는 캔버스와 셰이더로 절차적으로 생성합니다. 외부 에셋 파일이나 CDN을 쓰지 않습니다.
- 도시, 간판 문구, 기업명 등은 모두 가상의 것입니다. 실제 브랜드나 기존 게임·애니메이션의 이름, 캐릭터, 장소를 사용하지 않습니다.

## 라이선스

MIT
