# 관리자 과제 삭제

PR #25 병합 이후 main을 기준으로 구현했습니다.

## 삭제 의미와 DB 관계

- 관리자는 기사 유무와 관계없이 과제를 삭제할 수 있습니다.
- 삭제 모달은 서버에서 배정 수, 연결 기사 수, 그중 제출 이력이 있는 기사 수를 조회합니다. 제출 건수는 revision 개수가 아니라 submitted_at이 있는 기사 수입니다.
- 지원 모드는 과제만 삭제(연결 기사 보존)입니다. 정확한 문자열 "삭제"와 mode=preserve_articles를 Worker도 검증합니다.
- assignment_slot_instances가 articles를 참조하며, articles는 과제나 instance를 FK로 참조하지 않습니다. instance → recipients/slots → campaign 순서로 D1 batch에서 삭제하면 FK 무결성을 유지합니다.
- articles, article_revisions, article_feedback, photos, legacy article_edits는 삭제하지 않습니다. photos.article_id에는 FK가 없으므로 기사까지 단순 삭제하면 고아 사진이 발생합니다.
- 기존 Drive 삭제는 사진 업로드 후 DB 저장 실패 시 보상 정리에 사용됩니다. 사용자 기사 전체 삭제 정책은 없으므로 이번 기능은 기사/사진/Drive 전체 삭제를 제공하지 않습니다.
- 보존 기사는 기사 목록과 소유권 검증을 통해 계속 접근할 수 있습니다. 과제 연결과 과제 마감/종료 제한은 없어지고 기존 기사 상태에 따른 학생 수정 잠금은 유지됩니다.
- 삭제 중 새로 연결된 기사도 보존됩니다. 학생의 오래된 instance 조회와 삭제가 경합할 때 신규 고아 초안이 생성되지 않도록 생성 SQL의 instance 존재 조건을 같은 batch에 넣었습니다.
- 과제 배정 삭제는 복구할 수 없습니다. 취소/Escape는 DELETE를 보내지 않습니다. 요청 진행 중에는 중복 제출과 취소를 막습니다.
- DB 구조 검증은 저장소 migrations 전체를 적용한 로컬 SQLite에서 수행했습니다. 운영 D1의 현재 스키마를 직접 조회하거나 데이터를 변경하지 않았습니다.

## 검증

- Worker npm run check: 정확한 확인 문자열, 실제 SQLite FK/트랜잭션 롤백, 빈 과제/제출 기사 보존, stale instance, HTTP 관리자/비로그인/학생/CSRF 검증.
- 프런트 서비스: 성공 후 연결 캐시 정리, 기사와 사진 보존, 실패 시 상태 유지.
- Playwright: 빈/연결 과제, 정확한 입력, 취소/Escape, 중복 제출, 조회/삭제 실패, 모바일 모달.
- 프런트 빌드 검사와 scripts/validate.py.

## 병합 후 배포

1. PR을 main에 병합하고 해당 커밋을 체크아웃합니다.
2. worker 디렉터리에서 npm ci, npm run check, npm run deploy를 실행하여 Worker API와 정적 자산을 재배포합니다. 기존 secrets 및 wrangler.toml 변수를 유지합니다. 새 DB migration은 없습니다.
3. Vercel 프로젝트의 실제 Production Branch가 main인지 확인합니다. 기존 README의 feature/pridedesk-vercel 안내는 초기 연결 당시 기준입니다. 현재 콘솔 설정은 이 작업에서 변경하지 않았습니다.
4. Vercel Root Directory=pridedesk, Build Command=npm run build, Output Directory=dist를 유지하고 병합 커밋이 포함된 Production 배포를 실행합니다. 자동 배포되었다면 커밋과 Ready 상태를 확인합니다.
5. 고정 도메인 pridesk.vercel.app에서 관리자 로그인 후 테스트용 과제로 연결 건수, 취소, 정확한 삭제 입력, 과제 제거 및 기사/사진 보존을 확인합니다. 임의 Preview 도메인은 Worker의 허용 origin에 포함되지 않습니다.

Worker와 Vercel 모두 새 버전이 필요합니다. 배포 사이의 구버전 UI는 확인 문자열을 보내지 않아 삭제가 거부되므로 두 배포 완료 후 새로고침해야 합니다. 이 PR은 운영 배포나 main 병합을 수행하지 않습니다.
