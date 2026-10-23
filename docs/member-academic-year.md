# 회원 UX와 학년도별 활동 범위

기준 main: `5ebde7800e5b308be37bfee8088411f348396717`.

## 재사용 및 데이터 보존

- 기존 `members`, `member_cohorts`, 회원 CRUD, OAuth/D1 역할 검증과 로그인 전 과제 수신자 연결을 재사용한다. 테이블, migration, 예약 작업, 신규 API는 없다.
- 공통 `student-identity.js`가 KST 3월 1일을 학년도 경계로 계산한다. 1학년은 학년도 − 1990, 2학년은 그보다 한 기수 이전이다. 저장된 기수나 `active`는 진급 시 변경하지 않는다.
- 회원 기본 목록은 현재 두 기수와 교사이다. `activity=all`로 비활성 및 활동 종료 회원도 기존 검색·역할·기수 필터와 함께 조회/수정할 수 있다. 활동 여부와 로그인 활성 여부는 별개다.
- 현재 두 기수는 목록 API에서 가상 선택지로 제공한다. 실제 회원 저장 시 필요한 기수만 기존 테이블에 등록한다. 과거·다른 기수는 기존 수동 기수 등록 기능을 사용한다.
- 신규 등록은 활성으로 저장하며 상태 선택은 수정에만 제공한다. 교사 선택 시 최고 관리자 권한을 안내한다. 이메일과 현재 학번은 독립적으로 검증하며 서로 일치시켜 강제하지 않는다.
- 신규 배정 명단과 생성/배부 API는 저장된 기수로 활동 범위를 검증한다. 명시적으로 선택한 종료 회원은 오류로 반환하여 일부에게만 조용히 배부하지 않는다.
- 기사 overview는 현재 기수를 기본으로 채우되 기존 기사/배정이 있는 과거 회원은 이름과 기록을 유지한다. 기존 기사 작성·수정·소유권이나 과거 과제 수정/조회, 로그인 전 배정 연결을 막지 않는다. 별도 관리자 작성자/담당자 변경 API는 현재 없다.
- 이름에서 학번을 읽는 이전 display-only 요약 데이터의 호환 경로는 유지한다. 실제 신규 배정 서버 명단은 D1의 명시적 기수를 사용한다.

## 학교 계정 자동완성 (관리자 선택 동의)

회원 등록 모달에서 학교 디렉터리/내 연락처/기타 연락처 중 하나를 고른 뒤 Google 검색 연결을 누른다. 기존 OAuth client/callback, PKCE/state/nonce, 암호화 HttpOnly 세션을 재사용한다. 연결 시작은 관리자 전용 CSRF 보호 POST이며 callback도 원래의 활성 관리자 세션과 Google sub가 일치해야 한다. 일반 로그인 scope에는 아무것도 추가하지 않는다. 검색용 access token은 기존 암호화 세션 안에만 있으며 브라우저 JS/로그에 제공하지 않는다. 새 DB나 refresh token은 없다. 세션 만료 후 필요 시 다시 연결한다.

선택한 출처의 읽기 권한 하나만 추가 요청한다:

| 출처 | People API | 추가 scope | 범위/제약 |
|---|---|---|---|
| 학교 디렉터리 | people.searchDirectoryPeople | https://www.googleapis.com/auth/directory.readonly | 조직에서 공개한 프로필. Workspace 디렉터리 가시성과 관리자 앱 정책에 따라 승인 필요 |
| 내 연락처 | people.searchContacts | https://www.googleapis.com/auth/contacts.readonly | 해당 관리자 개인 연락처만. 학교 전체 계정 명단은 아님 |
| 기타 연락처 | otherContacts.search | https://www.googleapis.com/auth/contacts.other.readonly | 관리자 계정의 자동 저장 연락처만. 프로필 사진 미제공 |

Google Cloud의 기존 OAuth 프로젝트에서 People API 활성화와 사용하는 scope의 동의 화면 설정이 필요할 수 있다. Workspace 앱 접근 정책으로 차단되면 학교 관리자가 해당 client/scope를 승인해야 한다. 도메인 전체 위임·서비스 계정·Classroom·Gmail 읽기 권한은 사용하지 않는다. 이번 작업은 외부 설정을 변경하거나 실계정 추가 동의를 수행하지 않았다.

공식 문서:
- https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople
- https://developers.google.com/people/api/rest/v1/people/searchContacts
- https://developers.google.com/people/api/rest/v1/otherContacts/search

연락처 검색은 공식 empty-query warmup 후 실행한다. 검색은 Google의 prefix 검색 의미를 따르며 Gmail 후보와 완전히 같다고 보장하지 않는다. 특히 표시 이름에 붙은 숫자와 한글 부분의 검색 가능 여부는 실제 조직 프로필 필드에 따라 달라 실제 학교 계정 확인이 필요하다. 결과 최대 10개, 학교 이메일만 반환, 이메일 중복 제거, 이름 중복은 유지한다. 사진은 Googleusercontent HTTPS URL만 허용하고 referrer 없이 표시하며 없으면 기본 아이콘이다. 300ms debounce, abort/sequence, 키보드/터치 선택, 실패 시 수동 입력을 제공한다. 표시 이름의 5자리 학번만 분리하며 이메일에서 현재 학번을 유추하지 않는다. 선택만으로 저장하지 않는다.

실제 `유현승` 학교 계정 검색 및 Google 추가 동의는 아직 미검증이다. mock 테스트와 실제 Google 검색 성공을 구분해야 하며, 외부 승인 없이 기능 운영 가능으로 판단하지 않는다. 배포 전 preview에서 사용자의 명시적 승인 아래 동일 학교 관리자 계정으로 확인해야 한다.

## 적용

PR 승인 후 Worker → 동일 commit Vercel 순서로 반영한다. D1 migration이나 기존 회원 일괄 갱신은 필요 없다. 운영 회원 등록·데이터 변경 및 배포는 이번 작업에서 실행하지 않는다.

## 검증 결과

- Worker 282, frontend build 8, 배포 정책 20, Chrome 브라우저 212: 총 522개 통과.
- 최종 빌드의 회원 화면 8개 별도 재검증 통과. 390/820/1440px screenshot과 overflow 검사 통과.
- 2026/2027/2028년, KST 3월 1일 직전/직후 및 윤년, 미래 기수의 가상 표시/최초 저장, 이메일·현재 학번 불일치, 종료 회원 로그인/기존 원고·배정 보존, 혼합 수신자 요청 차단을 검증했다.
- Worker static build, frontend build, validate 및 git diff --check 통과. 운영 데이터로 쓰기 테스트하거나 조직 디렉터리를 실제 검색하지 않았다.
