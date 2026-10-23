# D1 회원 등록 방식으로 인증 전환

기준 main: `0e384a960ebb37214dd845355763a27257cc6240`.
이 PR은 구현과 격리 검증만 포함한다. 운영 SQL, 리소스 생성, 배포를 수행하지 않는다.

## 변경과 데이터 영향

- Classroom의 교사/학생 조회, roster 조회, 5분 권한 캐시와 OAuth roster scope를 제거한다. Google OAuth Authorization Code + PKCE는 유지하고 nonce와 10분 state 만료를 검증한다.
- `jose` 6.2.12로 Google JWKS 서명, RS256, issuer, audience, expiry, nonce, verified email, `hd=joongdong.hs.kr` 및 제공된 access-token hash를 확인한다. 교사도 학교 계정만 허용한다. 도메인 확인만으로 접근을 허용하지 않는다.
- `0009_members.sql`은 `member_cohorts`, `members`, `member_audit`만 추가한다. 기존 테이블/소유자/기사/배정/사진/편집파일/lock은 변경하지 않는다.
- 기수 35/36과 명시적으로 승인된 `editor@joongdong.hs.kr` 교사만 초기 등록한다. Classroom 명단이나 기존 작성자를 자동 회원으로 등록하지 않는다.
- 회원 ID와 Google ID는 별개다. 사전 등록한 정확한 이메일의 최초 검증 로그인에서 Google `sub`를 한 번만 연결한다. 기존 기사·배정의 Google ID와 동일한 식별자를 계속 사용한다. 이름이나 학번을 소유권 키로 사용하지 않는다.
- 연결된 Google ID는 변경/해제할 수 없다. 이메일을 수정해도 다른 Google 계정으로 대체할 수 없다. 같은 이메일을 재사용한 다른 Google 계정은 거부한다. 계정 교체가 정말 필요하면 별도의 소유권 검토가 필요하다.
- 학생 이메일은 h + 입학연도 두 자리 + 다섯 자리 번호 + 학교 도메인이다. 학년 진급 후 학교 이메일의 과거 번호와 현재 학번이 달라도 허용한다. 기수는 입력 시 추천만 하며 D1 저장값을 사용한다.
- 활성 학생은 최초 로그인 전에도 배정 명단에 포함된다. 새 0010 migration의 member_assignment_targets는 캠페인과 D1 회원 ID를 외래 키로 연결하고 배부 시각을 보관한다. 기존 assignment_targets/recipients/instances의 student_id에는 실제 Google ID만 저장한다. UI의 `member:<회원 ID>`는 명시적인 회원 선택 참조이며 Google ID가 아니다.
- 검증된 최초 로그인 시 Google sub 연결과 배정 수신자·슬롯 생성이 하나의 D1 batch로 확정된다. 배부 시에도 DB의 현재 연결 상태로 확정하므로 로그인/배부의 실행 순서가 바뀌거나 구 명단으로 배부해도 유실되지 않는다. 재로그인/재배부는 기존 수신일·슬롯 ID·원고·제출 이력을 덮어쓰지 않는다. 초안 대상 선택은 로그인만으로 배부되지 않는다.
- 배정 대상인 미연결 회원의 이메일 변경은 차단한다. 이메일 변경으로 다른 계정에 사전 배정이 넘어가는 것을 방지한다. 비활성 회원은 배정 명단/로그인에서 제외되며 기존 배정은 보존된다. 계정 정정이 필요하면 별도로 검토한다.
- 관리자 과제 카드에는 최초 로그인 연결 대기 인원을 별도 표시한다. 기존 제출 집계는 실제 Google ID에 연결된 학생 기준이다. 과제 삭제 시 해당 회원 배정 의도만 CASCADE로 제거하며 회원·기사·제출은 삭제하지 않는다.
- 기존 1·2학년 신규 과제 대상 제한은 유지한다. 기수별 배포/공지 시스템은 이번 범위에 없다.

## API와 권한

- `GET/POST /api/admin/members`, `PATCH /api/admin/members/:id`, `POST /api/admin/cohorts`: 등록된 활성 교사만 사용한다. 기존 Origin + CSRF, private response 정책을 유지한다. 물리 삭제 API는 없다.
- `GET /api/members/roster`: 로그인 여부와 무관한 활성 학생 명단. `/api/classroom/students`는 구 프런트가 열린 채 Worker가 바뀌는 동안의 임시 별칭이며 같은 D1 조회만 실행한다. 전환 완료와 구 asset 소멸 확인 후 별칭을 제거할 수 있다.
- DB의 역할은 teacher/student이다. 기존 관리자 API·프런트와 호환되도록 세션 응답에서 teacher를 기존 `admin`으로 매핑한다. 모든 교사 권한은 동일하다.
- 매 요청마다 primary D1에서 활성 상태, Google ID, auth_version을 확인한다. 비활성화/역할/이메일/이름 변경 시 세션이 무효화된다. 재활성화해도 예전 세션은 부활하지 않는다. D1 오류 시 기존 권한 캐시로 우회하지 않는다.
- 전환 전 세션은 모두 재로그인이 필요하다. 등록되지 않은 기존 Classroom 교사도 접근하지 못한다.
- bootstrap editor의 이메일/역할/활성 상태와 마지막 활성 교사를 DB trigger로 보호한다. 자기 자신의 접근 권한 해제도 API에서 막는다. 계정 삭제는 trigger로 막는다. 변경 audit은 같은 SQL 트랜잭션의 trigger에서 기록한다.
- Drive/Docs OAuth 범위와 private 저장은 그대로다. PrideDesk 교사 등록은 Google Drive 파일 공유권한을 자동으로 부여하지 않는다. 신규 교사의 파일 접근 권한은 기존 운영자가 별도로 확인해야 한다.

## 운영 적용 전 필수 승인·절차

1. 현재 main, 기존 Worker/프런트 버전, 운영 migration ledger를 확인한다. 명시적 운영 적용 승인을 받는다. 이 PR을 승인 없이 병합하지 않는다.
2. 실제 학교 관리자 계정 `editor@joongdong.hs.kr`의 접근 가능 여부를 확인한다. 교사/학생 등록 명단과 이메일을 관리자가 검토한다. Classroom 자동 가져오기는 없다.
3. 기존 Google ID와 OAuth sub의 일치 여부를 학교 계정으로 검증한다. 기존 사용자 기록 연결은 공식 Google의 안정적 계정 ID에 의존하며 실제 운영 계정 검증을 건너뛰지 않는다.
4. 적용 직전 D1 Time Travel bookmark와 복구 가능 시점을 읽기 전용으로 확인·운영 기록한다. 조사 시 2026-10-19에 현재 및 29일 전 bookmark 조회가 성공했다. 이는 그 시점의 확인이며 실제 복구를 실행한 증거는 아니다. R2/별도 백업/유료 리소스는 만들지 않는다.
5. `0009`와 `0010`은 seed와 trigger가 있으므로 기존 자동 배포의 안전 SQL 허용 범위를 벗어난다. `approved-migrations.json`에 추가하지 않는다. 승인을 받은 운영자가 다른 미적용 migration이 없는지 확인한 뒤 검토된 0009 → 0010 순서로 적용하고 ledger/추가 테이블/기본 교사를 확인한다. 운영 적용 시점까지 SQL 쓰기는 금지한다.
6. 적용 이후 새 Worker → 동일 commit Vercel 순서로 기존 배포 체계를 사용한다. 0009 또는 0010이 미적용이면 기존 배포 파이프라인이 Worker 전에 중단한다. 자동 배포 gate를 우회하거나 완화하지 않는다.
7. editor가 다시 로그인하여 추가 교사와 학생을 등록한다. 로그인 전 학생에게 과제를 배정할 수 있다. 학생 최초 로그인 후 사전 배정과 기존 기사·과제·사진·편집파일을 읽기 중심으로 확인한다. 등록 전 일반 회원 접근 불가 시간을 공지하고 전환 시간을 확보한다.
8. 새 교사/학생, 미등록/비활성 계정, 권한 변경 후 기존 세션, 기존 기사 소유권, Drive 권한을 확인한다. 실제 학생 원고 수정/일괄 반려를 검증 목적으로 수행하지 않는다.

## 실패와 복구

추가 테이블만 만드는 migration이므로 기존 Worker는 이를 사용하지 않는다. Worker 전환 전에 문제가 발견되면 기존 서비스를 유지하며 원인을 확인하고 추가 테이블을 임의 삭제하지 않는다.

전환 후 이전 Classroom Worker로 자동 롤백하면 미등록 계정 접근이 다시 열릴 수 있으므로 금지한다. 인증은 차단 상태를 유지하며 승인된 수정/배포를 진행한다. D1 전체 Time Travel 복원은 이후 정상 기사 작성까지 되돌릴 수 있다. 운영자 승인, 영향 범위와 복구 시점 검토 없이 실행하지 않는다. 이 PR은 복원 명령이나 자동 롤백을 제공하지 않는다.

## 근거

Google OpenID Connect의 sub는 이메일과 독립적인 계정 식별자이며 Workspace 확인에는 hd를 사용한다:
https://developers.google.com/identity/openid-connect/openid-connect
https://developers.google.com/identity/openid-connect/reference

새 JWT 의존성은 직접 서명 검증을 작성하지 않기 위한 것이다. OAuth/회원 테스트는 격리 SQLite/Workers와 생성된 테스트 RSA 키 및 Google 응답 mock을 사용한다. 실제 학교 로그인 및 운영 데이터 변경은 수행하지 않는다.
