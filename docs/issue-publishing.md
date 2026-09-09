# 신문 호수 발행

## 조사 결과와 번호 정정

- 조사 기준 main: `e710e2b0aa2f0625b209c4a5bc5aa8faea1b19be`.
- 조사 당시 실제 `https://jdlions.github.io/` HTML과 `/data/issues.json`은 No.16–No.33의 18개 항목이었다. 공개 JSON은 main과 모든 필드가 일치했고, 공개 `archive.js`도 main과 같은 JSON을 읽었다. HTML은 JavaScript 실패 시 쓰는 동일 목록의 fallback이며, 범위 표시는 하드코딩되어 있었다.
- 원격 branch를 fetch한 뒤 main과 origin/main의 차이는 0이었다. 전체 Git 이력에서 `No.35`를 추가한 index/JSON/archive 변경은 발견되지 않았다. 익명 GitHub Pages 설정 API는 404를 반환했으므로 설정상의 source branch는 별도로 확인하지 못했다. 관측한 공개 데이터에서는 다른 branch나 데이터 소스로 인한 불일치는 재현되지 않았다.
- PR #1은 mock 발행·미리보기와 JSON 기반 아카이브를 도입했고, PR #3은 운영 발행을 수동 JSON PR 절차로 정했다. 이후 native 관리자 화면에는 발행 메뉴가 없었다. 운영 service의 `publishIssue()`는 예외만 던졌으며 현재 Worker에는 발행 API가 없었다. D1의 기존 `issues`는 과거 편집 설정으로, 공개 아카이브 번호/Drive 링크 저장소가 아니다.
- 사용자가 추가로 확인한 원인: 2023년까지 홈페이지 No.와 실제 Vol.은 일치했지만 2024·2025년 자료 없이 2026년 자료가 추가되며 불일치했다. 기존 No.33 PDF는 실제 **Vol.34**다. 이 지시에 따라 JSON의 해당 `number/label`과 HTML의 해당 표시/범위만 **No.34**로 정정했다. 같은 항목의 제목, 연도, 계절, Drive 링크, 위치와 다른 17개 항목은 보존한다. No.33이나 누락 연도에 해당하는 자료를 추정해 만들지 않는다. 다음 신규 발행 추천은 **No.35**다.

참조 PR: https://github.com/jdlions/jdlions.github.io/pull/1 · https://github.com/jdlions/jdlions.github.io/pull/3

## 데이터 흐름

1. Vercel의 PrideDesk 관리자 **신문 발행** 화면이 same-origin `GET /api/publications`로 목록과 다음 번호를 읽는다.
2. 관리자가 PDF 링크/번호/연도/Summer 또는 Winter/제목을 입력하고 미리보기 및 공개 공유 상태를 확인한다.
3. 기존 Vercel → `/pridedesk/` Worker proxy를 통해 `POST /api/publications`를 호출한다.
4. Worker가 기존 session/membership/admin/Origin/CSRF 검사 후 D1 `issue_publications`에 한 번만 삽입한다.
5. GitHub Pages는 `GET https://lions-pride-editorial-api.editor-936.workers.dev/api/public/issues`를 인증 정보 없이 읽어 새 호수를 기준 JSON 앞에 렌더링한다. 페이지를 열거나 새로고침하면 반영된다. 이미 열린 페이지를 실시간 push로 갱신하지는 않는다.

기준 JSON의 7개 필드(`number`, `label`, `date`, `year`, `season`, `title`, `url`)를 그대로 사용한다. Worker bundle은 이 JSON을 읽어 기존 중복을 차단한다. 신규 목록만 번호 내림차순이며 기준 목록 자체는 다시 정렬하지 않는다. 새 번호는 현재 최신 번호보다 커야 한다. 관리자는 추천값보다 큰 번호를 선택할 수 있다.

발행 때 GitHub commit이나 Pages 배포를 수행하지 않는다. 프런트엔드/Worker에 GitHub write token을 추가하지 않는다. Vercel·Worker·D1·Pages 구조와 기존 기사/과제/사진/로그인은 그대로 사용한다.

## API

| 경로 | 권한 | 동작 |
| --- | --- | --- |
| `GET /api/publications` | 관리자 | `{issues, nextNumber}` 반환 |
| `POST /api/publications` | 관리자 + Origin + CSRF | 신규 발행. 처음 201, 동일 요청 재시도 200 |
| `GET /api/public/issues` | 공개 | 기존 목록 + 신규 목록을 7개 공개 필드로 반환 |
| `HEAD /api/public/issues` | 공개 | GET과 같은 상태·헤더, 본문 없음 |

POST는 `X-Editorial-CSRF: 1`과 `Idempotency-Key`(16–100자 영숫자/하이픈/밑줄)가 필요하다. JSON 예시의 file ID는 설명용이다.

```json
{
  "number": 35,
  "year": 2026,
  "season": "Winter",
  "title": "The Lion's Pride — 2026 Winter Edition",
  "url": "https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing",
  "publicPdfConfirmed": true
}
```

공개 API는 인증을 요구하지 않는 이 경로에서만 공개 필드를 선택하며 작성자, 학생 자료, idempotency key는 노출하지 않는다. CORS는 `https://jdlions.github.io` 읽기만 허용하고 credential 허용 헤더를 보내지 않는다. 기존 내부 API CORS는 바꾸지 않는다. 공개 경로에 대한 변경 요청은 405다. 목록 응답은 `no-store`이며 API/D1 장애 시 503을 반환해 클라이언트가 기준 JSON을 보존한다.

## Drive 링크와 제한

- HTTPS의 정확한 `drive.google.com`/`docs.google.com` 파일 공유 경로만 허용한다. `/file/d/ID/view`, `/preview`, `/edit`, `/open?id=ID`, `/uc?id=ID` 등을 정규화한다. 폴더, Google Docs 문서, 타 도메인, credentials, 잘못되거나 모호한 ID는 거부한다.
- 정규화 결과는 `https://drive.google.com/file/d/ID/view`이며 접근에 필요한 `resourcekey`가 있으면 유지한다. 추적용 query는 제거한다. 중복 확인은 URL 문자열이 아닌 file ID를 기준으로 한다.
- **링크 형식 검증은 PDF 존재·MIME·공개 권한 검증이 아니다.** 기존 `drive.file`은 임의의 공유 파일을 읽을 권한을 보장하지 않는다. 광범위한 Drive 권한 추가나 불안정한 Drive 페이지 scraping 대신 화면에 이 제한을 명시하고, 관리자가 PDF와 로그아웃 상태에서의 접근을 확인하도록 한다. Worker도 확인 플래그를 요구한다.
- 기존 Drive API 업로드/사진 조회는 변경하지 않으며 신문 발행 중에는 Drive 이동·삭제·권한 변경 API를 호출하지 않는다.

공식 scope 설명: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## 중복과 장애 처리

- D1의 `number` PK, `drive_file_id` UNIQUE, `idempotency_key` UNIQUE가 Worker 인스턴스 간 경쟁에서도 중복 삽입을 막는다.
- 최신 번호 검사와 삽입을 하나의 SQL statement로 수행한다. 먼저 읽고 나중에 쓰는 간격에 낮은 번호가 끼어들 수 없다. SQL 값은 모두 binding한다.
- key와 정규화된 요청·관리자 ID를 D1에 함께 저장한다. 같은 key와 동일 요청은 이전 결과를 반환하고, 다른 내용/사용자는 409다. 전송 응답 유실 후 같은 화면에서 재시도할 때 key를 유지한다. 새로고침 등으로 key가 바뀌어도 number/file 제약이 중복을 차단한다.
- 발행 중 입력·버튼을 잠그고 화면 내 이동을 막는다. 실패하면 입력과 재시도 key를 보존한다. 현재 목록을 읽을 수 없을 때 임의 기본값으로 발행하지 않는다.
- JSON과 기존 HTML을 유지하는 fallback은 기존 호수의 가용성을 위한 것이다. Worker 장애 동안 신규 D1 호수는 보이지 않을 수 있으며 복구 후 페이지 새로고침으로 다시 읽는다. 신규 발행의 복구/백업 기준은 기존 D1 운영 정책이다.

## merge 후 초기 적용 (이 PR에서는 실행하지 않음)

1. D1의 적용된 migration을 확인하고 **추가 migration `0005_issue_publications.sql`**을 운영 `editorial-production`에 적용한다. 기존 테이블/데이터를 수정하거나 seed하지 않는다. 표준 명령은 `worker`에서 `npx wrangler d1 migrations apply editorial-production --remote`이며, 실행 전에 기존 0001–0004 적용 상태를 확인한다.
2. 기존 설정을 유지한 채 Worker를 배포한다. 신규 secret/OAuth scope/환경 변수는 필요 없다. 공개 API가 18개 보존 항목과 No.34를 반환하는지 읽기 검증한다.
3. Vercel PrideDesk 프런트엔드를 배포하고 GitHub Pages에 public script/번호 정정이 반영됐는지 확인한다. 자동 배포가 먼저 완료되어도, Worker가 준비되기 전에는 관리자 목록이 실패 상태로 잠기고 공개 페이지는 기존 목록을 유지한다.
4. 관리자가 다음 실제 PDF로 No.35 발행을 확인한다. 테스트 목적으로 운영에 가짜 호수를 발행하지 않는다.

삭제/수정 API는 제공하지 않는다. 운영에서 자료 정정이 필요하면 별도 요청으로 검토한다. 롤백 시 신규 D1 테이블/데이터를 삭제하지 않는다.

## 구현 검증

- Worker 전체 테스트: 125개 통과 (신규 발행 검증 9개 포함).
- PrideDesk build/프록시 테스트: 2개 통과.
- 브라우저 전체 테스트: Chrome 24개 통과 (신규 관리자·공개 아카이브 검증 7개 포함). 데스크톱 및 390px 모바일에서 미리보기, 제목 생성, 중복 클릭 잠금, 재시도 key 유지, 성공 메시지, 기존 목록, 악성 링크/제목, API/JSON fallback을 확인했다.
- 저장소 validator, JavaScript 문법, diff 검사 통과.
- Worker `deploy --dry-run` 번들 검증과 별도 로컬 D1의 migration 0001–0005 적용 통과. 운영 배포와 운영 migration은 실행하지 않았다.
- 기준 commit의 아카이브와 비교해 승인된 첫 항목 number/label 정정 외 모든 필드·링크·순서 보존을 확인했다.
- D1 검증은 실제 SQLite 제약 및 로컬 D1을 사용한다. 브라우저 네트워크는 테스트 응답을 사용하며 실제 운영 관리자 계정이나 실물 PDF로 발행하지 않았다.
