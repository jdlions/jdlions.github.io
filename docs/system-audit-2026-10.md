# PrideDesk 시스템 감사 결과 — 2026-10-03

## 기준과 확인 범위

- 기준 main: `dd06f9282c08bd7cd123e594bd88b5b3569f6f21`, 새 브랜치 `audit/pridedesk-system-stability`.
- GitHub main과 Vercel Production / GitHub Pages deployment의 동일 SHA 및 success 확인. 시작 시 열린 PR 없음.
- 기존 미추적 `.wrangler/`는 보존했다. 운영 데이터 변경, 실제 Slack 전송, Drive 변경, merge, 배포, migration 적용은 하지 않았다.
- baseline **Worker 186 + build 4 + Chrome 71 = 261**, Edge warm-cache 3개 추가 통과. baseline 실패 없음.
- 최신 frontend는 실제 production의 `/assets/build-162e7f2bd6fd3014/` 경로로 제공된다.
- 0001–0007 schema와 코드를 조사했다. 0006/0007 운영 적용 완료는 사용자가 제공한 기준이다. 이번 원격 migration **조회**는 Cloudflare 오류 7403(계정/서비스 접근 권한)으로 실패했으므로 적용 상태를 독립 재확인했다고 주장하지 않는다.
- Worker + D1 + private Drive + Vercel + GitHub Pages 구조를 유지했다.

## 발견 사항과 실제 수정

|심각도|확인한 문제|조치와 근거|
|---|---|---|
|Critical|이번 검토에서 확인된 항목 없음|전체 시스템에 취약점이 없다는 보증은 아님|
|High|학생 입력 `articleType`이 관리자 목록의 HTML 속성에 그대로 삽입됨|실제 draft validator를 통과한 입력으로 관리자 초기화 브라우저 테스트에서 이미지 요소 삽입 재현. 기사/과제 행의 해당 속성을 escape 처리. 수정 후 삽입 및 이벤트 실행 차단|
|High|사진 INSERT 성공 후 조회/연결 실패도 Drive 원본 삭제로 보상 처리|자동 삭제 제거. 실제 SQLite INSERT 후 조회 실패를 주입해 사진 row가 존재해도 원본 삭제 호출이 0임을 검증. 결과 불명확 시 목록 확인 안내|
|Medium|학생 과제 campaign에 다른 수신 학생 ID 전체가 포함됨|학생 경로는 targets 조회를 생략하고 호환 배열을 비운다. 과제·슬롯·자신의 배정은 유지, 관리자는 수신 설정 유지|
|Medium|편집 파일/설정 조회가 navigation promise를 점유해 다른 메뉴 이동까지 대기|화면 조회를 navigation 완료와 분리. 기존 generation 취소와 업로드 busy guard 유지. 보류된 API 중 dashboard 이동 및 늦은 오류 무시를 브라우저에서 검증|
|Medium|동일 인증 사용자의 cold/만료된 membership 동시 요청이 Google 조회를 반복|동일 course/user/credential의 진행 중 요청만 공유. 기존 5분 TTL 유지, 실패는 캐시하지 않고 만료된 권한으로 우회하지 않음|
|Medium|편집 파일 조회 5개 D1 읽기가 직렬 실행|project 조회 후 latest/history/lock/audit만 병렬화. mutation 순서/lock/CAS는 변경 없음|
|Medium|완료 버전 조회가 기존 partial index 조건을 인식하지 못해 scan/sort|동치 조건 `state!='cancelled'`를 명시하여 0006의 기존 index 활용. 새 index/migration 없음|
|Low|깨진 URL 인코딩 cookie가 인증 실패 대신 500 유발|영향은 해당 요청/브라우저에 국한되고 권한 우회는 없음. Low 항목은 보고만 한다는 범위에 따라 기존 처리 유지|

관리자 과제 API의 campaigns/assignments도 독립적으로 조회한다. 의존성이 있는 Drive 업로드/예약/finalize 순서는 그대로 유지했다.
삭제 보상 제거로 더 이상 참조되지 않는 `deleteDriveFile`만 제거했다. DM/Member ID/SENS/SMS/이메일 알림 runtime은 발견되지 않았다. 0007의 legacy 호환 컬럼은 유지했다.

## 실제 production 측정과 한계

별도 비로그인 Chrome, 네트워크 throttle 없음, cold context 1회 측정이다. Resource Timing 합계에는 cross-origin Timing-Allow-Origin 제한으로 보이지 않는 전송이 있을 수 있다. 사용자 원고/개인정보를 측정 결과에 기록하지 않았다.

|항목|PrideDesk login|공개 홈페이지|
|---|---:|---:|
|HTML TTFB|86ms|244ms|
|DOMContentLoaded|725ms|901ms|
|LCP|1,020ms|756ms|
|HTML decoded 크기|4,250B|35,669B|
|관측 요청 수(HTML 포함)|14|10|
|관측 transfer 합계|43,033B|52,088B|
|가장 긴 resource|login-app.js 272ms|public issues 338ms|
|session API|144ms / 35B decoded|해당 없음|

로그인 페이지는 session 확인 이후 사용 가능한 흐름이며, 위 수치는 측정 당시 네트워크 상태의 단일 표본이다. 이번 PR은 아직 배포하지 않았으므로 production After 수치나 사용자 체감 개선율을 만들지 않았다.

실제 로그인된 관리자 세션으로 dashboard, 시간대 인사말, editor-settings 표시 및 dashboard 숨김을 확인했다. 편집 파일 진입에서는 **Classroom 요청 경로의 upstream 520 오류**와 retry UI를 관측했다. 이를 Google 자체 장애인지 중간 연결 장애인지까지 단정할 수 없다.
인증 브라우저 도구에는 Performance API가 노출되지 않아 관리자 전체 waterfall/TTFB/실제 usable ms와 Drive·D1별 시간을 분리 측정하지 못했다. 학생 운영 세션도 사용하지 않았다. 이후 브라우저 연결 도구 오류로 추가 운영 재측정은 못 했으며, 아래 인증 후 수치는 격리 테스트/코드 기준이다.

확인된 느림의 원인은 다음과 같이 구분한다.

1. **운영에서 관측:** Classroom 권한 조회 실패. membership cache가 없거나 만료되면 API는 외부 권한 재확인을 기다린다. 권한 확인 실패 시 계속 허용하는 방식으로 바꾸지 않았다.
2. **브라우저 재현:** 편집 파일/설정 요청이 끝날 때까지 다른 메뉴 이동이 막혔다. 조회 중에도 다른 메뉴를 쓸 수 있게 수정했다.
3. **코드/격리 측정:** 중복 membership 조회, 편집 metadata 직렬 읽기, history partial-index 미사용. 이들만 안전하게 최적화했다.

## Before / After

|항목|이번 main 기준 Before|After|검증 종류|
|---|---|---|---|
|관리자 dashboard 초기 API|session + article page = 2|2|실제 frontend 초기화, 로컬 API fixture|
|학생 dashboard 초기 API|session + article page + assignments = 3|3, 영역별 독립 완료|동일|
|편집 파일 메뉴|projects/editors 병렬 → 선택 project detail, 3|3, dashboard 진입 시 0|코드 및 브라우저|
|편집자 설정|settings 1|1, dashboard 진입 시 0|동일|
|cold 동시 admin session 6개 Google 호출|코드상 profile/teacher 각 6 = 12|실측 profile/teacher 각 1 = 2|Worker fetch mock, 동일 isolate/credential 한정|
|학생 과제 DB 조회(비어 있지 않음)|4|3|실제 SQLite, 1/10 campaigns|
|관리자 과제 DB 조회|4|4, 독립 읽기 중첩|동일|
|편집 detail DB 조회|5 queries / 직렬 5단계|5 queries / 의존 단계 2|지연 DB fixture, 최대 동시 읽기 4|
|편집 조회 대기 중 메뉴 이동|API 응답까지 대기|API 보류 상태에서도 이동|수정 전 실패 / 수정 후 통과|
|history 1,000개, 25회 중앙값|0.723ms, scan + temporary sort|0.131ms, 기존 index search|독립 synthetic SQLite 측정|
|history 10,000개, 동일 조건|6.222ms|0.124ms|동일|
|history 51개 row payload|20,558B|20,558B, 완전히 동일|동일 10,000 fixture|

병렬 테스트 부하가 있는 full-suite에서는 history 10,000개 수치가 달라진다. 위 표는 같은 전용 실행의 Before/After 중앙값만 사용한다. 원격 D1 latency/CPU와 동일한 값은 아니다.
20ms 지연을 각 DB read에 넣은 테스트는 5개 statement와 4개 독립 동시 read를 검증한다. 이 가상 지연을 운영 개선 시간으로 해석하지 않는다.

기사 pagination/요약 구조는 변경하지 않았다. 기존 4A fixture 재측정에서 100개 기사 전체 요약 53,401B 대비 첫 page 8,718B / 다음 page 8,656B, query 3 / 1을 유지한다.
과거 3차 full-body 비교 fixture는 20개 1,451,051B → summary 11,351B, detail 72,567B 유지다. 이는 **이번 PR에서 새로 달성한 절감이 아니라 이전 최적화 회귀 확인**이다.

|가상 기사 수|first|뒤쪽 cursor|검색|상태|복합 필터|picker|
|---|---|---|---|---|---|---|
|1,000 Before → After ms|6.16 → 7.57|2.03 → 2.07|3.78 → 3.81|4.43 → 4.57|4.57 → 4.02|0.66 → 0.76|
|10,000 Before → After ms|28.70 → 28.34|2.59 → 2.94|13.09 → 14.02|17.25 → 19.75|12.05 → 14.02|1.11 → 1.24|
|query 수|3|1|3|3|3|1|
|10,000 fixture 응답 B|9,139|8,810|9,157|9,105|9,118|5,746|

기사 query 코드는 바꾸지 않았으며 시간 차이는 부하/측정 변동이다. payload는 Before/After 동일하다. 사진 metadata/private thumbnail 구조 및 public/login asset 용량도 이번 PR에서 변경하지 않았다.

## D1, cache, 인증/보안

- article student 범위: 기존 student+updated index 사용. admin 전체 목록 및 substring 검색에는 scan/sort가 남는다. 이번 데이터 크기/측정에서 새 index를 추가할 운영 근거가 부족해 유지했다.
- editorial latest/history: 기존 partial index search. active lock: partial unique index. upload chunks: upload_id/offset primary index.
- audit history: project 필터 scan/sort가 남지만 30개 반환 제한. photo는 student index 후 sort, admin metadata 목록은 아직 전체 조회. 실제 운영 규모/시간 확인 후 별도 판단할 항목이며 근거 없이 index를 추가하지 않았다.
- HTML/API production: `private, no-store`. build JS: `public, max-age=3600, must-revalidate`. private download/thumbnail no-store와 nosniff 유지.
- PR39 content-hash 자산 그래프와 Chrome/Edge warm-cache deployment 전환 유지. unversioned 자산으로 되돌리지 않음.
- OAuth Code+PKCE S256/state, 고정 callback origin, 45분 sealed session, Secure/HttpOnly/SameSite=Lax/__Host 쿠키, CSRF header+Origin, admin/student 권한 유지.
- API마다 Google token 검증/Drive를 호출하는 구조는 아님. membership은 기존 5분 isolate cache 사용; 만료 시 Classroom 조회. 동시 요청 합치기는 다른 사용자/credential의 진행 중 확인과 공유하지 않는다.
- SQL은 바인딩하고 cursor는 student scope/필터와 결합한다. 다른 학생 기사/사진, forged cursor, 다른 작업자/사용자의 upload lock 및 학생의 editorial API 접근을 격리 테스트로 차단 확인.
- 학생 internalNote allowlist, 관리자 메모 보존, private photo thumbnail 인증·1MiB 상한, Drive ID를 통한 우회 차단 유지.
- 일반 학생 계정 운영 로그인, 실제 보조기기, 외부 침투 테스트는 수행하지 않았다. 코드/자동화 감사의 범위로 해석해야 한다.

## Affinity, 동시성, 실패 복구

- .af/.afpub/.afdesign/.afphoto, 1GiB, 자동 번호/정규 파일명, 원래 이름 metadata, private Drive, 최신/과거 원본, 역할/이름 snapshot 유지.
- 임의 extension만으로 바이너리의 진짜 Affinity 형식까지 판별하는 기능은 없다. 파일은 실행/preview하지 않고 octet-stream attachment로만 내려준다.
- checkout unique index와 finalize CAS/transaction 유지. 동시 checkout, 중복 upload init/finalize, stale base, 잘못된 owner, force/cancel vs finalize, 새로운 기기 복원 검증.
- chunk bounds/total size/해시, 누락·순서 뒤바뀜·중복·부분 ack·재시도·종료된 작업 차단 검증. content-type을 실행 가능한 미리보기로 취급하지 않음.
- D1 finalize 중간 statement에 실제 SQLite trigger 실패를 주입: 버전/latest/lock/audit rollback 후 같은 Drive ID로 재시도 성공. latest update 실패·응답 분실에도 중복 버전 없음.
- Drive 파일 보존은 의도적이다. 취소/강제 종료/실패 후 미등록 파일이나 세션이 남을 수 있다. 자동 삭제하지 않으며 lock도 탭 종료만으로 해제하지 않는다.
- 사진 업로드는 ambiguous 결과의 완전한 서버 idempotency까지 새로 구현하지 않았다. 원본 유실을 막았지만 재전송 시 중복 원본 가능성은 남아 목록 확인이 필요하다.
- Slack은 `chat.postMessage` 단일 채널, `chat:write`, 서버 secret, 일반 텍스트 이름. DM scope/runtime 없음. 실패/불명확 결과에 자동 재전송하지 않고 핵심 commit/lock 종료도 rollback하지 않는다. 모두 mock 검증이며 운영 채널에 메시지를 보내지 않았다.
- session 30초, 일반 API 60초, 일반 업로드/가져오기 및 chunk 180초 정책 유지. Google 일반 metadata 20초 / body 120초 유지. 기존 editorial Drive adapter는 metadata에도 120초, 대용량 다운로드 30분 상한을 사용한다. 이 차이는 이번 PR에서 변경하지 않았고 end-to-end 보장 시간이 아니다.
- 외부 오류/timeout은 숨기지 않고 retry 상태를 제공한다. 편집 메뉴 조회 실패가 다른 메뉴 navigation을 막는 문제만 제거했다. 쓰기 timeout은 서버 rollback 보장이 아니므로 결과 확인 후 재시도한다.

## UI 및 회귀 결과

- 390/820/1440px: 기존 native select dark option, 독립 editor-settings navigation, 시간대 greeting, login footer overflow 및 편집 파일 workflow 테스트 유지.
- modal focus/trap/Escape/복귀, reduced-motion, 검색 debounce/race, pagination, lazy loading, 오류/empty, draft 탭 이동/뒤로가기 보존, 삭제 확인, publication/archive fallback 전체 기존 suite 통과.
- 새 브라우저 테스트는 실제 admin/student 초기화 모듈을 사용한다. API fixture를 쓰는 로컬 인증 테스트이며 실제 production 계정으로 mutation을 시험한 것은 아니다.
- CI의 기존 사진 실패 테스트는 picker 응답 전에 submit 이벤트를 직접 발생시켜 업로드 요청이 생기지 않는 race가 있었다(기존 테스트 반복 실행 5회 중 3회 실패). picker 응답을 의도적으로 보류하고 로딩 상태를 확인한 뒤 기사 선택·필수 입력·실제 버튼 클릭을 거치도록 수정했다. 제품 코드를 테스트에 맞춰 변경하거나 timeout을 늘리지 않았다.
- **최종 Worker 197 + build 4 + Chrome 76 = 277개 통과**, Edge warm-cache 3개 추가 통과. build/validate/diff-check 통과.
- production archive 18개는 validator/fallback 회귀로 유지 확인. live public homepage 정상 로드. Google Drive/Slack 운영 mutation은 하지 않았다.

## 남은 사항과 적용 조건

- 운영 Classroom upstream 오류 및 Cloudflare 자격 증명 7403은 이 코드 패치만으로 해결됐다고 주장할 수 없다. 운영 담당자가 Cloudflare 계정 권한을 복구하고 배포 전 읽기 전용 상태를 확인해야 한다.
- 인증 운영 API의 전체 waterfall, Google/D1 개별 latency, 대용량 실물 업로드, 실제 학생 계정 smoke는 미측정/미실시. 기존 데이터 변경 없이 수행 가능한 후속 검증으로 남긴다.
- photo 전체 목록/기사 legacy 호환 API/상세 revision payload, 큰 audit 테이블의 index, 미등록 Drive 객체 정리는 운영 근거와 별도 정책이 필요해 이번에 확대하지 않았다.
- 새로운 설정/secret/scope는 필요 없음. 기존 Slack 채널/secret, Drive 폴더, D1 바인딩을 유지한다.
- 변경 계층: Worker와 관리자 frontend. schema와 public homepage 소스 변경 없음.
- 사용자가 승인해 merge한 뒤 **Worker 새 main 배포 → Vercel 동일 merge commit 확인 → 인증/권한·메뉴·목록 smoke** 순서. Vercel 자동 배포가 먼저 되어도 API shape 호환은 유지되지만 보안 수정 완료 확인에는 두 계층 모두 필요하다. D1 migration 없음, Pages 수동 배포 불필요.
- rollback은 계층별 직전 버전으로 가능하고 DB 역마이그레이션은 없다. 다만 과거 버전에는 이번 XSS/원본 삭제 위험이 있으므로 단순 rollback은 보호를 되돌린다는 점을 고려한다.

향후 가이드용 메모(이번에는 사용 가이드를 작성하지 않음): 관리자 메뉴는 대시보드/과제/기사/사진/편집 파일/편집자 설정/신문 발행, 학생은 과제·기사 작성/사진이다. 편집은 역할 선택 후 시작하고, 업로드는 같은 파일로 재시도하며 lock은 브라우저를 닫아도 남는다. 이름·Slack 채널은 관리자 설정이고 secret은 Cloudflare에서만 관리한다. 강제 종료·저장 결과 불명확·공용 계정 역할 선택·개인 원고/private 원본 보존을 다음 가이드에 명시해야 한다.
