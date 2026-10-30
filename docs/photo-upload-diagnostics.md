# 임시 사진 업로드 권한 진단

이 PR은 main의 기존 기사 검색·선택·사진 제출·OAuth 코드를 그대로 둔다. PR #61의 유형 선택/인증 변경은 포함하지 않는다. 새 버튼은 수동 클릭할 때만 학생 자신의 session access token으로 Google tokeninfo와 서버에 설정된 제출 폴더 metadata를 읽는다.

- 사진 제출 → **업로드 권한 진단**. 기사/파일을 선택하지 않아도 진단 가능하며 제출하기는 누르지 않는다.
- 결과: 실제 승인 scope, 토큰/폴더 HTTP 상태, allowlist reason, isAppAuthorized, canAddChildren, OAuth client 일치 여부. null/조회 실패는 미확인으로 표시한다.
- 로그인된 학생만 POST `/api/photos/upload-diagnostics` 호출 가능. Origin/CSRF/no-store 유지. 임의 token/fileId/folder/account를 입력받지 않는다. Google tokeninfo는 공식 auth library와 같은 POST Authorization 헤더 방식이며 URL에 token을 넣지 않는다.
- 응답/로그에 token/cookie/email/sub/파일명/Google 원문 오류를 남기지 않는다. 파일 생성·삭제·수정, D1 쓰기, 공유 권한·OAuth 설정 변경이 없다. Google 읽기 요청 두 개를 독립 처리한다.
- `includeGrantedScopesRequested=false`는 현재 로그인 요청의 옵션을 기록한 것으로, 오류 원인이라는 판정이 아니다. Google Drive 브라우저 업로드 성공과 API의 앱별 파일 접근은 구분한다. 진단 결과 전까지 해결됐다고 판단하지 않는다.

진단 완료 후 최소 제거 PR에서 `assets/js/shared/photo-upload-diagnostics.js`, `worker/src/photo-upload-diagnostics.js`, 해당 전용 테스트/이 문서를 제거한다. scripts/editorial-files.mjs의 진단 모듈 항목, student-app import/초기화 한 줄씩, student/index.html의 진단 button/result, worker/index.js의 import와 진단 route만 제거한다. 업로드·기사 선택·회원·D1/Google 설정은 수정하지 않는다. 관련 테스트 후 Worker → 동일 commit Vercel 순서로 배포한다. 다른 변경이 진행됐다면 전체 commit을 맹목적으로 revert하지 말고 위 연결점만 제거한다.
