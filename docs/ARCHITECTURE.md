# 아키텍처

MDViewer는 Paseo 안에서 Markdown 파일을 열고, 읽기 좋게 그리고, 바로 고칠 수 있게 하는 플러그인이다. 데몬이 Markdown을 HTML로 바꾸고, 앱은 탭 안의 격리된 iframe에서 그 HTML과 다이어그램·수식을 그린다.

## 목표와 비목표

목표
- Paseo 안에서 `.md` 파일을 클릭 한 번으로 연다. 대화 속 링크, 파일 트리, 검색, 턴 끝 버튼 모두 같은 뷰어로 열린다.
- GitHub 수준의 Markdown과 Mermaid·수식을 데스크톱에서 보기 좋게 그린다.
- 보기·분할·원문 모드로 같은 탭에서 바로 편집하고 저장한다.
- 에이전트(Claude, Codex)가 만든 문서를 사람이 놓치지 않게 한다.

비목표
- 대화 답변 렌더링을 대신하지 않는다. 답변은 Paseo 기본 렌더러나 다른 플러그인이 그린다.
- 범용 코드 에디터가 아니다. 원문 편집은 일반 텍스트 입력이다.
- Markdown 외 문서(PDF, Office)는 다루지 않는다.

## 전체 구조

| 위치 | 실행 환경 | 맡는 일 |
|---|---|---|
| `engine/render.ts` | 빌드 시 번들 | markdown-it과 플러그인, highlight.js, KaTeX로 Markdown → HTML |
| `server/` | 데몬 하위 프로세스 | RPC 처리, 파일 읽기·쓰기·감시, Finder 열기, 턴 끝 버튼, 에이전트 도구 |
| `server/generated/` | 빌드 산출물 | `engine.js`(렌더러 번들), `runtime.ts`(Mermaid 스크립트와 KaTeX CSS·글꼴) |
| `client/` | Paseo 앱 | 파일 패널, 파일별 탭, 툴바, 경로 메뉴, 설정 화면, 대화 행 렌더러 |
| `client/shell.ts` | iframe 안 | 디자인 CSS, Mermaid 실행, 목차, 찾기, 확대 창, 링크·복사·체크박스 처리 |
| `shared/` | 양쪽 | RPC 계약, 설정 스키마, 경로 추출 |

데몬은 플러그인 서버 코드를 자체 번들러로 묶고, 가져온 패키지의 타입 선언까지 따라간다. markdown-it·highlight.js처럼 타입 선언을 따라갈 수 없는 패키지가 있어 렌더러는 `scripts/build.mjs`가 미리 `server/generated/engine.js`로 묶는다. 같은 이유로 Mermaid와 KaTeX 자원도 실행 중 `node_modules`를 읽지 않고 생성 모듈에 문자열로 넣는다.

## 주요 흐름

### 파일 열기

1. 사용자가 대화 링크, 파일 트리, 검색 결과에서 `.md`를 연다.
2. Paseo가 파일 탭을 만들고, 등록된 파일 패널 중 기억된 선택(MDViewer)으로 연다.
3. 파일 패널이 `useFileText`로 내용을 읽고 변경을 감시한다.
4. 렌더 RPC가 HTML을 돌려주면 iframe에 `postMessage`로 넘긴다.

턴 끝 버튼, `/mdv`, 문서 안 링크, 에이전트 카드는 파일별 워크스페이스 패널(`doc-<경로 해시>`)을 연다. 같은 파일은 같은 패널 ID라서 기존 탭으로 이동한다. 연 파일 목록은 데몬(`plugin-data/paseo-mdviewer/recent.json`)에 남겨, 재시작 뒤 복원된 탭이 자기 패널을 찾게 한다.

### 그리기

- 데몬: front matter 분리 → markdown-it 렌더 → 블록마다 `data-line` 부여 → 로컬 이미지는 data URI로, 로컬 링크는 `data-path`로 바꾼다.
- iframe: HTML을 넣고, Mermaid 블록을 하나씩 SVG로 바꾼다. 같은 다이어그램은 캐시를 재사용해 편집 중 깜빡임을 줄인다.
- iframe은 `sandbox="allow-scripts allow-popups"`로 앱과 출처가 분리된다. 앱과는 `postMessage`로만 주고받는다.

### 편집과 저장

- 분할·원문 모드에서 입력하면 초안이 생기고, 0.14초 뒤 다시 그린다.
- 자동 저장이 켜져 있으면 입력을 멈추고 0.7초 뒤 저장한다. 꺼져 있으면 툴바의 Save 버튼으로 저장한다.
- 파일 패널은 Paseo 파일 핸들로, 파일별 탭은 `mtime` 비교 RPC로 저장한다. 다른 곳에서 파일이 바뀌었으면 충돌 배너에서 버리기·덮어쓰기를 고른다.

### 턴 끝 버튼

1. `agent.turn.after` 훅이 끝난 턴의 타임라인 끝부분을 다시 읽는다.
2. 마지막 사용자 메시지 뒤 답변 글에서 Markdown 경로를 뽑는다.
3. 경로를 작업 폴더 기준으로 찾고, 없으면 작업 폴더 아래에서 같은 이름을 찾는다(깊이 8, 디렉터리 4,000개, 30초 캐시).
4. 실제 있는 파일만 최대 12개를 버튼 행(`mdviewer-files`)으로 붙인다. 행 ID는 매번 새로 만든다.

## 불변 조건

- iframe 밖의 앱 코드는 DOM을 직접 만지지 않는다. DOM 접근은 `client/web.ts`에만 있고 웹 플랫폼에서만 동작한다.
- 모바일 등 웹이 아닌 환경에서는 iframe 대신 Paseo 기본 Markdown 컴포넌트로 보여 준다.
- 타임라인 행의 `kind`는 소문자·숫자·하이픈만 쓴다.
- 앱 텍스트 색은 모두 Paseo 테마 값에서 가져온다.

## 실패 처리

| 상황 | 동작 |
|---|---|
| 렌더 RPC 실패 | 이전 렌더 결과를 유지한다 |
| Mermaid 문법 오류 | 그 블록 자리에 오류 문구를 보여 주고 나머지는 계속 그린다 |
| 파일 삭제 | "File not found"를 보여 준다 |
| 저장 충돌 | 배너로 버리기·덮어쓰기를 묻는다 |
| 패널 렌더 오류 | 오류 문구를 보여 주고 플러그인 로그에 남긴다 |
| 턴 끝 처리 실패 | 버튼 행을 붙이지 않고 플러그인 로그에 남긴다 |

## 알려진 한계

- Paseo 파일 탭의 아이콘은 Paseo가 파일 종류로 정한다. 플러그인은 바꿀 수 없다.
- 답변 본문 속 경로를 링크로 바꾸는 일은 답변을 그리는 쪽이 한다. `better-paseo`의 "Plugin markdown for replies"가 켜져 있으면 링크가 맥 기본 앱으로 열린다.
- 같은 파일이 Paseo 파일 탭(링크로 연 것)과 파일별 탭(버튼으로 연 것)으로 따로 열릴 수 있다. 플러그인이 Paseo 파일 탭을 직접 여는 API가 없다.
- Finder 열기는 데몬이 도는 기기에서 실행된다.
