# PrideDesk 최종 성능·접근성·SEO 검증

기준: `d34318e2d04bf7837992bbfaa37fc43e63cf5bfa`. 운영 학생 데이터는 읽거나 변경하지 않았다. 구현과 격리 검증이며 운영 배포 완료 보고가 아니다.

## 사진 thumbnail과 업로드

기존 목록의 `/api/photos/:id/content` 원본 다운로드를 `/api/photos/:id/thumbnail`로 교체했다. 원본 열기는 사용자가 선택하는 별도 링크로 남는다. 학생·관리자 목록 모두 lazy loading, 이미지 크기 지정, 실패 안내를 사용하며 thumbnail 실패가 원본 자동 다운로드로 이어지지 않는다.

Google이 생성하는 `thumbnailLink`를 기존 OAuth 토큰으로 Worker가 읽는 방식을 선택했다. 별도 저장소/생성 서버는 운영 부담을 늘리고, 클라이언트에서 원본을 받은 뒤 축소하는 방법은 전송량을 줄이지 못한다. [Drive Files 공식 문서](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)에 따르면 thumbnail URL은 수명이 짧고 private 파일은 인증된 요청이 필요하다.

- 저장 위치·수명: Google Drive가 생성·관리한다. D1이나 public asset에 thumbnail/URL을 저장하지 않는다. 요청마다 metadata를 다시 조회한다.
- 권한: 기존 session/role 및 사진·연결 기사 소유권 검증 후에만 Drive에 접근한다. 학생은 다른 학생 사진을 조회할 수 없다. 기존 원본도 private으로 유지한다.
- 외부 요청: HTTPS Googleusercontent 도메인만 허용하고 redirect를 거부한다. JPEG/PNG/WebP만 허용하며 선언 크기와 실제 수신 크기를 모두 최대 1MiB로 제한한다. 인증 토큰이나 thumbnail URL은 브라우저에 반환하지 않는다.
- 캐시: thumbnail API도 `private, no-store`. 공유 CDN이나 영속 thumbnail 캐시는 만들지 않는다.
- 원본 변경: Google의 thumbnail 갱신을 따른다. 매번 새 metadata를 조회하지만 Google의 즉시 생성/갱신을 보장하지는 않는다. thumbnail 미제공·실패 시 안내와 명시적 원본 링크를 표시한다.
- timeout: metadata 20초, thumbnail body 수신까지 120초. 기존 공통 deadline 구현을 재사용한다.

비교: 브라우저의 사진당 요청은 원본 1회 → thumbnail 1회. Worker의 Drive 요청은 원본 1회 → metadata+thumbnail 2회다. 기존 원본은 최대 15MiB, thumbnail 응답은 최대 1MiB다. 격리 전송 fixture는 24,000B였다. 이는 실제 운영 사진 평균이나 실측 압축률이 아니다. 실제 절감량은 로그인 후 기존 사진의 thumbnail 크기에 따라 달라진다.

업로드는 파일별 현재 진행/완료 개수를 표시한다. 전송 중 버튼·파일 입력·모달 닫기를 잠그며 중복 요청 방지와 부분 성공 파일의 재전송 방지를 유지한다. 실패 시 파일과 입력을 보존하여 재시도할 수 있다. 파일 전체에 대해 형식과 15MiB 상한을 먼저 검사한다. 원본 압축·재인코딩은 하지 않는다. 표시 진행률은 확인된 파일 수이며 네트워크 byte 퍼센트를 추정하지 않는다. 통신 실패 시 서버가 이미 처리했는지 불확실한 기존 업로드의 한계는 남아 있으므로 오류 안내에 따라 결과 확인 후 재시도해야 한다.

## 접근성·모바일

사진 업로드를 native dialog로 전환하고 기존 기사/과제 삭제 dialog에 같은 focus·scroll 처리를 적용했다. 열 때 focus 이동, Tab/Shift+Tab 순환, Escape, 닫힌 뒤 trigger 복귀, 배경 비활성화·scroll lock을 적용한다. 업로드/삭제 처리 중 닫기 제한과 삭제의 정확한 문구 확인은 유지한다.

편집기의 본문·제목·기사 유형·서식 버튼에 이름을 제공하고, 저장 상태·데이터 로딩·업로드 진행에 제한된 `status`/polite announcement를 적용했다. 본문 전체를 live region으로 만들지 않는다. 주요 버튼/링크/입력의 visible focus를 보존·보완하고, 화면 재생성 후 편집기 진입/탭 이동 focus를 유지한다. 모바일의 닫힌 sidebar는 keyboard 탐색에서 제외하며 Escape로 메뉴를 닫고 trigger로 복귀한다.

학생 편집기·사진 picker·업로드 dialog는 390/820/1440px에서 확인한다. 기존 관리자 목록/필터/삭제/발행 테스트는 390px 및 넓은 화면을 포함한다. 가로 overflow, custom select 위치, pagination 줄바꿈, 저장 전 탭 이동을 검증한다. 자동화된 keyboard/DOM 검증이며 NVDA/VoiceOver 청취 기반 전면 인증을 주장하지 않는다.

## SEO·공개 HTML

공개 홈페이지에 실제 production root canonical, OG title/description/image/URL/type, Twitter summary card를 추가했다. 이미지 URL은 기존 `assets/images/public-logo.webp`이며 페이지 제목과 기존 설명을 사용한다. 내용·archive 순서·디자인은 변경하지 않는다.

PrideDesk 로그인/관리자/학생 HTML은 `noindex, nofollow` meta를 명시한다. 기존 Vercel X-Robots-Tag도 유지한다. 실제 보안 경계는 기존 인증/권한 검사다.

공개 HTML에 남은 JPEG data URL을 원래 바이트 그대로 200×200 정적 이미지로 분리했다. 나머지 큰 data URL 문제는 이전 작업에서 이미 해소됐다. 로고·사진에 intrinsic dimensions, 적절한 lazy/async 설정을 추가했다. 로고의 기존 공유 경로와 정적 JSON/HTML archive fallback은 유지한다.

| 항목 | 기준 main | 이번 변경 |
|---|---:|---:|
| 공개 HTML (UTF-8, LF) | 40,546B | 35,716B |
| 공개 HTML gzip (로컬 zlib) | 13,188B | 8,610B |
| 분리된 JPEG | HTML에 내장 | 4,535B |
| HTML+해당 사진 cold gzip/bytes 합계 | 13,188B | 13,145B |
| 로그인 소스 HTML | 3,995B | 4,043B |
| 로그인 로고 | 13,704B | 동일 |
| favicon | 3,292B | 동일 |
| 공개 작은/큰 로고 | 5,262 / 25,540B | 동일 |

HTML 감소율만큼 cold 전체 transfer가 감소한다고 해석하면 안 된다. 분리 이미지의 첫 요청이 추가되므로 최초 총량은 비슷하고 HTML 및 반복 탐색에서의 독립 캐싱이 개선점이다. 외부 폰트/네트워크/CDN 압축에 따라 실제 wire bytes는 달라진다. 과거 574KB PrideDesk PNG는 이미 2차에서 대체된 상태다.

2026-09-13 비인증 production GET 확인: 공개 HTML 40,546 decoded bytes/200, 로그인 4,041B/200, session 35B/200. 로그인·session `private, no-store`, 로고/CSS `public, max-age=3600, must-revalidate`였다. 이는 배포 전 기준 측정이며 새 코드의 production 결과가 아니다.

## 4A·DB·누적 성능

기존 pagination 테스트가 0/1/20 미만/정확히 20/초과/여러 페이지, 마지막 페이지, 동일 정렬 값, 삽입 중 탐색, 검색/복합 필터/집계/picker, 잘못된 cursor/다른 사용자 cursor/limit>50을 이미 검증한다. 실제 Worker HTTP 학생 테스트에 검색·복합 필터·picker·다음 cursor 응답의 소유권과 내부 필드 비노출 검증을 추가했다. 브라우저의 300ms debounce/abort/늦은 응답 제외 테스트도 유지한다. 실제 운영 로그인 성공을 대신 주장하지 않는다.

`worker/test/large-article-performance.test.js`: 모든 migration 스키마를 적용한 메모리 SQLite, 가상 학생 10명, 기사 1,000/10,000개. 실제 query 구현과 cursor로 마지막까지 이동한다. 운영 D1은 접근하지 않는다. 로컬 단독 실행 예시는 아래와 같고 CPU 부하에 따라 달라진다.

| 조회 | query 수 | 1,000개 ms / bytes | 10,000개 ms / bytes |
|---|---:|---:|---:|
| 첫 페이지 | 3 | 3.25 / 9,116 | 27.88 / 9,139 |
| 뒤쪽 cursor | 1 | 0.72 / 8,810 | 2.08 / 8,810 |
| 검색 | 3 | 1.59 / 4,954 | 13.01 / 9,157 |
| 상태 필터 | 3 | 2.19 / 9,082 | 18.41 / 9,105 |
| 복합 필터 | 3 | 2.52 / 9,096 | 13.44 / 9,118 |
| 학생 picker | 1 | 0.37 / 5,726 | 1.09 / 5,746 |

첫/검색/필터 3회는 목록 1+상태 집계 1+과제 선택지 1이다. 다음 페이지와 picker는 집계를 반복하지 않는다. 검색 1,000개 결과는 11행, 나머지는 20행이며 동일 개수 payload 비교가 아님에 주의한다.

EXPLAIN QUERY PLAN: 학생 picker는 `native_articles_by_student`, 상태 필터는 `native_articles_by_status`, 연결 데이터는 기존 PK/UNIQUE를 사용한다. 관리자 전체/부분 문자열 검색과 집계에는 scan, 정렬에는 temporary B-tree가 남는다. 로컬 10,000개에서 치명적 지연은 확인되지 않았으나 상수 비용이나 Cloudflare 실제 지연을 주장하지 않는다. 원고 크기·과제 분포·D1 rows_read에 따라 결과가 달라진다. 이번에는 index/migration을 추가하지 않는다. 운영 규모에서 지연이 관측되면 관리자 정렬용 복합 index와 검색 방식을 query plan/rows_read 근거로 검토한다.

누적 회귀 측정은 기존 fixture와 테스트로 유지한다:

- 초기 HTTP: 관리자 session+기사 목록 2회, 학생 session+과제+자유 기사 3회. roster/photos는 초기 진입에 요청하지 않는다. 학생의 기사/과제는 독립 표시한다.
- 4A 동일 100개 fixture: 전체 요약 53,401B → 첫 20개 8,718B, 다음 8,656B. 일반 목록은 본문/편집본을 보내지 않으며 상세에서만 전체 자료를 받는다.
- 3차 본문 20개 fixture: 목록 1,451,051B → 요약 11,351B. 이번에는 상세 payload/원고 품질을 변경하지 않는다.
- 과제 API: 캠페인 10개 32 queries → 4 queries 유지. 빈 목록은 2회.
- session 30초/일반 60초/업로드·가져오기 180초/Google metadata 20초/body 120초 및 실패 후 부분 화면 사용·재시도 테스트 유지.

## Dead code·보안·검증

참조 검색과 기존 workflow 테스트를 기준으로 사용하지 않는 `legacyPhotoPreview`, 열기 경로가 없는 학생 legacy article modal, 현재 목록에서 도달하지 않는 `/api/articles/:id?issueId=...` 상세 분기를 제거했다. active 목록/생성/과제 열기는 모두 native 기사 API다. mock 파일이나 다른 legacy 구조를 광범위하게 삭제하지 않았다.

OAuth Code+PKCE/state/쿠키, session/role, Origin/CSRF, 학생 내부 메모 allowlist, 관리자 메모, Drive/Docs/Classroom 권한, no-store, 삭제 확인 및 Drive 보존, publication 권한·중복 방지, archive API/JSON/HTML fallback 회귀 테스트를 유지한다. 독립 사진 삭제 API/UI는 기존에 없으며 이번에 새로 추가하지 않았다.

검증 명령: Worker `npm run check`, PrideDesk `npm test`, Chrome `npm run test:browser`, `scripts/validate.py`, `git diff --check`. 브라우저 API는 격리 fixture이며 Worker/D1 경로는 별도의 실제 코드 테스트로 검증한다. 실사용자의 Google 로그인/원본 사진은 자동 테스트에 사용하지 않는다.

최종 결과: Worker 165개, PrideDesk 3개, Chrome 브라우저 48개, 총 216개 통과. validate 및 diff whitespace 검증 통과. 브라우저 결과에는 모달 내부 오류 안내, 모바일 sidebar Escape/포커스, thumbnail 실패 시 원본 자동 전송 금지 검증을 포함한다.

## Merge 이후 배포 순서와 남은 확인

1. 승인 후 merge commit 기준 Worker 배포: 새 private thumbnail endpoint가 먼저 필요하다. 기존 bindings/secrets/D1 그대로 유지한다.
2. Vercel이 동일 commit을 production에 반영했는지 확인한다. 자동 배포가 먼저 끝났다면 Worker 반영까지 thumbnail은 실패 안내를 표시하고 원본 링크는 유지된다. 원본 자동 fallback은 없다.
3. GitHub Pages의 동일 commit, SEO 이미지/HTML, archive 18개 및 API 장애 fallback을 확인한다. 자동 배포 완료 시 재배포하지 않는다.
4. 권한 있는 실제 계정으로 thumbnail 제공 여부·실제 사진 전송량과 키보드/보조기기 경험을 확인한다.

D1 migration, 새 secrets/bindings, 별도 이미지 인프라 설정은 필요 없다. 계획된 구현은 이 PR에 모았으며 생산 환경의 인증된 thumbnail 확인과 수동 보조기기 청취, 실제 D1 부하 관찰은 검증 한계/운영 확인으로 남는다. 이 PR 작업에서는 merge/deploy/production migration을 실행하지 않는다.
