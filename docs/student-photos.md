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
