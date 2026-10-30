# 학생 사진 제출 — OAuth API 접근 진단

## 현재 확인된 사실

- 사용자 확인: 오류가 발생한 동일 학생 계정으로 기존 제출 폴더에 직접 파일 추가 성공. 폴더 사용자 쓰기 권한이 없다고 단정하지 않는다.
- 초기부터 학생 OAuth access token을 Worker가 중계해 같은 설정 폴더에 업로드했다. PR #58은 Classroom 회원 판정을 D1으로 바꿨으며 Drive 업로드 token은 변경하지 않았다. PR #59의 `7d38b0d`에서 `include_granted_scopes=true`가 제거됐다. 실제 발급 scope에 미친 영향은 아직 미확인이다.
- `drive.readonly`는 훨씬 이전 `73fd3fb`에서 제거됐다. PR #59가 Drive scope를 새로 제거한 것으로 설명하지 않는다. 현재 요청은 openid/email/profile/drive.file, online 그대로다.
- Drive 사용자 권한과 `drive.file`의 앱별 파일 접근은 별개다. 폴더 브라우저 업로드 성공만으로 현재 앱 토큰의 API 접근이 증명되지는 않는다. https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## PR #61 변경

서버 전용 Refresh Token 전환을 철회했다. PHOTO_DRIVE_REFRESH_TOKEN이나 추가 secret은 요구하지 않는다. 업로드·폴더 검사·미리보기·원본 스트림은 기존 학생/교사의 세션 access token을 사용한다. OAuth scope/PKCE/state/nonce/동의 옵션/Google Cloud 설정/Drive ACL은 변경하지 않는다.

기사 검색·선택 제거와 피처/학교 선택은 유지한다. 새 사진만 기존 photos 필드에 `issue_id=student-photo:school|feature`, `article_submission_id=''`, `article_id=NULL`로 구분한다. 기존 사진·기사 연결·촬영 출처·Drive 원본은 보존한다. 조회 전 D1 소유권 검사와 CSRF/Origin/private no-store를 유지한다. migration은 없다.

## 안전한 진단 방법

PR 코드가 승인된 격리 테스트 환경에 배포돼 있고, 그 환경에서 실패 학생의 정상 Google 로그인 세션을 사용할 수 있을 때:

1. 사진 제출 → **업로드 권한 진단** 클릭. POST `/api/photos/upload-diagnostics`는 인증된 학생 자신의 세션만 허용한다. 토큰/이메일/Google ID/임의 폴더 입력을 받지 않는다. 학생은 토큰이나 쿠키를 복사해서 전달하지 않는다.
2. tokeninfo 조회 HTTP, 실제 grantedScopes, OAuth client 일치 여부, 폴더 조회 HTTP/allowlist reason/isAppAuthorized/canAddChildren을 확인한다. 조회 실패/누락은 null(미확인)이며 false나 폴더 권한 부족으로 추정하지 않는다.
3. tokeninfo는 Google 공식 auth library와 같은 POST + Authorization header 방식이다. 토큰을 query string에 넣지 않는다. 응답의 이메일/ID/원문 오류/토큰은 반환·기록하지 않는다. https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/oauth2client.ts
4. `drive.file`이 실제 승인되지 않았으면 현재 요청 scope의 동의 여부부터 확인한다. 자동 scope 확대/과거 권한 전체 복구/재동의는 하지 않는다. 승인됐어도 폴더 앱 접근이 거절되면 Google Picker 등 공식 per-file 승인 방법을 검토하되 별도 근거/승인 없이 추가하지 않는다.
5. `isAppAuthorized=false`만으로 실패 원인을 확정하지 않는다. 실제 scope·HTTP/reason·canAddChildren을 함께 판정한다. 앱 승인과 ACL을 구분한다. `includeGrantedScopesRequested=false`는 현재 요청 옵션 설명이며 인과관계 판정이 아니다.

진단은 Google에 읽기 요청 두 개만 보내며 Drive 업로드·권한 변경·D1 쓰기를 하지 않는다. tokeninfo 실패가 폴더 결과를 없애거나 반대로 폴더 실패가 scope 결과를 숨기지 않는다. 일반 로그인/업로드에는 진단 호출이 추가되지 않는다.

## 검증 및 남은 조건

격리 DB/Google mock으로 학생 token 사용, 기사 없는 두 유형 업로드, 기존 행 보존, IDOR, CSRF, 진단의 scope/403/404/누락/timeout 처리와 비밀정보 비노출을 검증한다. 실제 실패 학생의 API 토큰 응답과 실제 Drive 업로드는 아직 미검증이다. 운영 배포/PR 병합/OAuth 설정/Drive 공유 변경은 수행하지 않는다. 원인이 해결됐거나 운영 제출이 정상화됐다고 간주하지 않는다.
## 실계정 HTTP 404 이후 최소 수정안 (실행 전 검토)

2026-10-30 확인: 운영 Worker의 폴더 ID와 Drive 메타데이터의 실제 폴더 ID는 모두 `1eMyFE3z4WVLbZf89RuJz90M3v-J4Jbxd`이며 폴더명은 The Lion's Pride - Photo Submissions이다. 폴더는 존재하고 My Drive 폴더다. API에는 supportsAllDrives=true가 이미 포함된다. 연결된 Drive 계정에서 반환된 폴더 URL에는 resourcekey가 없지만, 이를 실패 학생 토큰의 접근 증명으로 사용하지 않는다.

사용자 실계정 결과: tokeninfo 200 / OAuth client 일치 / drive.file 승인 / 폴더 GET 404 / 동일 학생의 Drive 브라우저 업로드 성공. 즉 유효한 token과 사용자 ACL이 있어도 앱 token의 대상 파일 접근이 허용된다는 뜻은 아니다. 404는 부재와 접근 불가를 함께 의미하며, isAppAuthorized/canAddChildren은 404에서 미확인이다. 오류 reason notFound도 안전 allowlist에 추가하고 앱에서 폴더를 확인하지 못했다는 문구로 표시한다. 삭제/ACL 부족/앱 미승인을 404 하나로 확정하지 않는다.

현재 증거는 drive.file의 파일별 앱 접근 제한에 부합한다. 과거 broad drive.readonly 승인과 include_granted_scopes=true 조합이 폴더 조회에 영향을 줬을 가능성은 있지만 이전 실제 token scope가 없어 PR #59와의 인과관계는 확정하지 않는다. include_granted_scopes를 되돌려 과거 Classroom/Directory/Drive 권한까지 결합하거나 drive/drive.readonly를 추가하지 않는다.

### 우선안: 기존 폴더를 Google Picker로 명시 승인

- 대상은 **기존 제출 폴더 한 개**다. 교체/생성/이동/공유 ACL 수정은 하지 않는다. 학생별 사용자·앱·파일 승인이므로 관리자 한 명의 승인으로 모든 학생에게 적용된다고 가정하지 않는다.
- 공식 Web Picker의 setSelectFolderEnabled(true), 폴더 MIME 필터, setFileIds([configuredFolderId])로 대상 폴더를 안내한다. callback에서 다른 ID를 선택하면 거부하고, 실제 제출 대상은 계속 서버 설정 폴더만 사용한다.
- Picker가 성공했다고 클라이언트 boolean만 신뢰하지 않는다. **기존 학생 세션 token**으로 서버가 같은 폴더 GET/isAppAuthorized/canAddChildren을 다시 확인한 후 제출하도록 한다. 다른 Google 계정으로 Picker를 열었다면 기존 세션 검증이 성공하지 않는 한 연결 완료로 처리하지 않는다. DB에 가짜 승인 상태를 저장하지 않는다.
- 사진은 기존 학생 OAuth로 업로드하고 기사 검색 없이 피처/학교 UI를 유지한다. 폴더 승인으로 하위 모든 기존 파일까지 재귀 승인됐다고 가정하지 않는다.

### 구현 전에 필요한 설정·보안 결정

표준 Web Picker는 공식 Google JS에 OAuth access token을 전달하는 구조다. 현재 HttpOnly 세션의 token을 브라우저로 꺼내는 API는 추가하지 않는다. 구현하려면 별도 drive.file 전용 단기 browser token을 메모리에서 Picker에만 쓰는 방식 등의 보안 승인이 필요하다. 토큰은 local/session storage·URL·로그에 저장하지 않는다. 현재 코드에는 이 흐름을 추가하지 않았다.

같은 Google Cloud 프로젝트의 Picker API 활성화 여부, OAuth client의 JavaScript origin, project number(App ID), HTTP referrer/API 제한된 Picker API key도 확인·승인해야 한다. 이번 작업에서 Google 설정/키를 생성·수정하지 않는다. 일반 로그인 scope와 흐름은 유지한다.

Google의 trigger_onepick OAuth redirect 문서는 desktop/mobile 경로로 구분돼 있다. 이를 기존 Web client에서 검증 없이 지원된다고 가정해 배포하지 않는다. Web Picker의 보안·설정 조건을 수용할 수 없을 때만 관리자 전용 서버 연결을 대안으로 비교한다. 그 경우에도 OAuth Playground나 새 Refresh Token을 현재 기능의 필수 조건으로 강요하지 않는다.

### 실제 업로드 검증 절차

1. 승인된 테스트 환경에서 같은 실패 학생으로 로그인하고 기존 진단 결과(token 200, drive.file, 폴더 404)를 기록한다. token/cookie/email은 수집하지 않는다.
2. Picker에서 기존 설정 폴더만 선택한다. 취소·다른 폴더·다른 계정 선택은 연결 완료로 처리하지 않는지 확인한다.
3. 기존 학생 token의 폴더 GET 200 및 canAddChildren=true를 확인한다. isAppAuthorized도 관측값 그대로 기록하고, 필드가 없으면 추정하지 않는다. 동일 token에서 404가 유지되면 업로드 복구 성공으로 보고하지 않는다.
4. 별도 테스트 파일 생성 승인 후 식별 가능한 작은 PNG를 피처/학교로 각각 한 번씩 제출한다. 기사 ID 없이 제출되고 원래 폴더 부모 ID·원본 바이트/크기·D1 작성자·유형을 확인한다. 기존 사진·연결 행은 불변인지 확인한다.
5. 다른 학생의 조회/원본 접근 차단 및 관리자 조회를 확인한다. 실제 Google 승인/두 업로드/조회가 모두 통과하기 전에는 해결 완료라고 보고하지 않는다. 기존 자료를 삭제하는 정리 작업은 하지 않는다.

근거:
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/handle-errors#notFound
- https://developers.google.com/workspace/drive/picker/guides/web-picker-sample
- https://developers.google.com/workspace/drive/picker/reference/picker.docsview.setselectfolderenabled
- https://developers.google.com/workspace/drive/picker/reference/picker.view.setfileids
- https://developers.google.com/workspace/drive/picker/guides/overview
