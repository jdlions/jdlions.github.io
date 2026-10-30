# 학생 사진 제출

## 원인과 변경

기존 `/api/photos/upload`는 학생의 세션 access token으로 `canAddChildren`을 검사하고 같은 토큰으로 Drive에 저장했다. D1 회원 등록이나 관리자 서버 중계를 거쳤다는 사실은 Google Drive 폴더 권한을 부여하지 않는다. `drive.file`의 파일별 접근 제한도 별도로 적용된다. 운영 secret 이름 조회에서 서버용 Drive credential은 없었다. 실제 학생 세션·Google 원본 오류·폴더 ACL은 이번 작업에서 조회하지 못했으므로 운영의 개별 403 reason은 확정하지 않는다.

학생 화면은 피처/학교 유형만 선택하며 기사 검색·선택 요청을 하지 않는다. 서버는 기사 ID를 받지 않는다. 기존 `photos` 스키마를 그대로 사용하여 새 사진만 `issue_id=student-photo:school|feature`, `article_submission_id=''`, `article_id=NULL`로 기록한다. 기존 기사 연결/파일/행은 수정하지 않는다. source_type은 기존 촬영 출처 의미를 유지한다. 학생/관리자 목록과 학생별 관리 집계는 두 유형도 포함한다.

## 운영 적용 전 필수 설정 (이번 PR에서 수행하지 않음)

1. 제출 폴더를 관리하는 편집부 Google 계정의 **동일 OAuth client**용 offline refresh token을 별도 승인된 관리자 동의 절차로 확보한다. 최소 scope는 기존 `https://www.googleapis.com/auth/drive.file`이며, 이 계정/앱이 설정된 폴더에 접근 가능해야 한다. scope 동의만으로 기존 임의 폴더 접근이 보장되지 않는다. 필요하면 관리자가 해당 폴더를 앱에 승인하는 절차를 사용한다. 학생에게 폴더 쓰기 권한을 주거나 Drive 전체 scope로 자동 확대하지 않는다.
2. 해당 token을 Worker secret `PHOTO_DRIVE_REFRESH_TOKEN`으로 보관한다. 값은 채팅/로그/repo/브라우저에 넣지 않는다. 기존 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_UPLOAD_FOLDER_ID`를 그대로 사용한다. 별도 client로 발급된 refresh token은 사용할 수 없다. 일반 Google 로그인 scope/온라인 세션 정책은 변경하지 않는다.
3. 관리자 `/api/photos/folder-status`는 이제 서버 credential로 실제 대상 폴더 `canAddChildren`을 확인한다. 성공 전에는 운영 사진 제출 정상화를 완료로 판단하지 않는다. scope/폴더 권한/계정 정책은 실제 계정으로 확인해야 한다.
4. 승인 후 Worker → 동일 commit frontend 순서로 배포한다. D1 migration은 없다. 피처/학교 테스트 사진의 실제 저장 확인은 별도 사용자 승인 아래 수행한다.

서버 token은 인증된 사진 저장 및 D1 소유권 확인 후의 새 사진 미리보기/원본 스트림에만 사용한다. raw Drive ID를 입력받는 공개 프록시는 없다. 원본도 인증된 same-origin 스트림으로 제공해 학생의 직접 Drive 접근 권한이 필요하지 않다. 기존 기사 연결 사진은 기존 사용자 Drive token 경로를 유지한다. 파일 공유/ACL 변경/자동 삭제는 하지 않는다.

서버 secret 미설정/폐기 시 학생 token으로 재시도하지 않고 503의 명확한 설정 오류를 반환한다. Drive 403/404/quota는 기존 안전한 코드로 구분하고 로그에는 allowlist reason/HTTP status만 추가한다. token·쿠키·Google 원문 메시지·파일명은 로그에 남기지 않는다.

## 검증 경계

격리 DB와 mocked Google 응답으로 두 유형의 업로드, 지정 폴더/서버 token 사용, 원본 바이트, 학생 IDOR/CSRF, 기존 행 보존, 관리자 집계를 검증한다. 실제 학생 Google 로그인/실제 Drive 쓰기/운영 Google 오류 재현은 수행하지 않는다. Preview UI 검증도 production Worker에 연결하지 않고 browser tests의 격리 응답으로 수행한다.
