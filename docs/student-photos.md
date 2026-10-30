# 학생 사진 제출 복구

## 원인과 최소 수정
학생의 기존 drive.file 토큰에서 기존 공유 폴더 files.get은 404지만, 같은 토큰의 files.create는 해당 폴더에 파일을 생성할 수 있었다. 업로드 전 driveFolderPreflight를 필수 호출해 읽기 실패를 쓰기 실패로 처리한 것이 제출 차단 원인이다.

사진 업로드에서만 사전 조회를 제거한다. 폴더 설정 누락 검증을 유지하며, 서버에 설정된 기존 폴더를 parents로 지정한 파일 생성 API가 실제 쓰기 권한을 검사한다. 생성 실패 시 사진 DB 레코드를 저장하지 않는다. 관리자용 폴더 상태 조회는 유지한다.

Google OAuth client, 기존 openid/email/profile/drive.file, PKCE/state/nonce, 회원 연결·가입 코드 정책은 변경하지 않는다. include_granted_scopes 복원, drive.readonly, Classroom/Docs 권한, Picker, 서버 Refresh Token은 사용하지 않는다.

## 화면과 데이터
기사 검색·선택을 제거하고 피처/학교 유형과 사진 및 기존 출처/사용 허가 입력을 사용한다. 기사 ID는 받지 않는다. 기존 photos.issue_id에 student-photo:feature/school을 기록하며 실제 Google sub로 소유권을 검증한다. 이전 사진과 기사 연결 및 비공개 저장은 유지한다.

## 실제 검증
운영 DB와 분리한 Preview에서 동일 학생이 기존 drive.file만 포함한 토큰으로 피처·학교 PNG 각 1장(77바이트)을 실제 기존 제출 폴더에 저장했다. 학교 결과는 HTTP 201, metadata/download HTTP 200, 부모 폴더·MIME·크기·다운로드 바이트 일치가 확인됐다. 기존 파일은 수정하거나 삭제하지 않았다. 모바일/데스크톱, 재시도, CSRF/Origin, IDOR 및 이전 데이터 보존은 격리 테스트로 검증한다.

## 진단 종료 및 배포
임시 진단 버튼을 제거하고 API는 학생 인증·Origin/CSRF를 유지한 채 no-store 410을 반환해 Google 호출을 중단한다. 내부 진단 helper의 순수 테스트는 공개 endpoint를 활성화하지 않는다. 테스트 파일/Preview 리소스는 임의로 삭제하지 않는다.
D1 migration·회원 데이터 변경은 없다. PR 병합 후 기존 자동 검증 → Worker → 같은 merge commit의 Vercel 순서로 반영한다. Preview 성공과 전체 학생 운영 제출 검증은 구분한다.
