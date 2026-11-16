# 설정

설정 화면은 Paseo 설정 → Plugins → MDViewer의 톱니바퀴에서 연다. 값은 데몬에 저장되어 연결된 모든 기기가 같이 쓴다. 지금 들어 있는 설정은 6개이고, 나머지는 후보다.

## 현재 설정

| 키 | 화면 이름 | 기본값 | 동작 |
|---|---|---|---|
| `turnButtons` | Open buttons after each reply | 켬 | 답변이 끝나면 언급된 md 파일 버튼 행을 붙인다 |
| `agentTool` | Agent card tool | 끔 | 에이전트에 `show_markdown` 도구를 붙인다. 바꾼 뒤 새로 열리는 세션부터 적용된다 |
| `defaultMode` | Open documents in | 보기 | 새로 여는 문서의 시작 모드(보기·분할·원문) |
| `width` | Reading width | 보통 | 본문 폭. 좁게 700px, 보통 860px, 전체 |
| `fontScale` | Text size | 100% | 새로 여는 문서의 글자 크기. 탭에서 핀치나 A-/A+로 따로 바꿀 수 있다 |
| `autosave` | Save automatically | 켬 | 끄면 툴바의 Save 버튼으로만 저장한다 |

스키마 정본은 `shared/settings.ts`다. 시작 모드와 글자 크기는 새 탭에만 적용되고, 이미 연 탭은 탭마다 저장된 값을 쓴다.

## 후보

필요해지면 추가한다.

대화 연동
- 버튼 최대 개수(12)
- 파일 이름만 적혀도 찾기(켬)
- 카드 도구를 붙일 에이전트(Claude, Codex, 둘 다)

보기
- 목차 사이드바 기본값(끔)
- 본문·코드 글꼴
- 테마 고정(Paseo 따라감, 밝게, 어둡게)
- 코드 색 세트(GitHub)

렌더링
- Mermaid(켬)
- 수식(켬)
- 머리말 정보 카드(켬)
- 이모지 단축 코드(켬)
- 로컬 이미지(켬)

편집
- 자동 저장 대기 시간(0.7초)
- 체크박스 클릭 저장(켬)
- 분할 방향(위아래, 좌우)

파일
- 맡을 확장자(md, markdown, mdx)
- 열었던 탭 복원(켬)
