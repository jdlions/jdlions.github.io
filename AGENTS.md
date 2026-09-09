# PrideDesk 작업 규칙

## 기본 원칙

이 저장소는 중동고등학교 영자신문부 The Lion's Pride의 공개 홈페이지와 내부 편집 시스템 PrideDesk를 운영한다.

- 사용자의 현재 명시적 지시가 이 문서보다 항상 우선한다.
- 기존 기능, 기존 데이터, 사용자의 변경을 보존한다.
- 요청 범위 밖의 리팩터링·아키텍처 변경·마이그레이션을 하지 않는다.
- 추측으로 수정하지 않는다. 실제 코드·데이터 흐름·로그 등 확인 가능한 근거를 먼저 확인한다.
- 기본 문제 해결 순서는 `원인 확인 → 최소 수정 → 회귀 검증 → 결과 반환`이다.
- 이미 현재 세션에서 확인한 사실을 특별한 이유 없이 반복 조사하지 않는다.

## 현재 운영 구조

### Public Website

- GitHub repository: `jdlions/jdlions.github.io`
- GitHub Pages: `https://jdlions.github.io/`

### PrideDesk Frontend

- Vercel
- Production: `https://pridesk.vercel.app`

### Backend

- Cloudflare Worker
- `lions-pride-editorial-api`

### Database

- Cloudflare D1
- `editorial-production`

### Google integration

Google OAuth / Classroom:

- 로그인
- admin/student 역할 판별
- 필요한 경우 학생 roster 조회

Google Drive:

- 학생이 업로드한 사진 원본 보관

PrideDesk의 기사·과제·revision·feedback·편집 상태 등은 D1을 기준으로 한다.

Google Classroom을 기사 작성/제출 저장소로 다시 사용하지 않는다.
과거 Cloudflare Worker same-origin frontend 구조로 되돌리지 않는다.

## 설계·검토와 구현 역할 분담

PrideDesk 개발은 두 개의 기존 세션을 고정적으로 재사용한다.

| 역할    | 담당 세션      | 책임                                                              |
| ----- | ---------- | --------------------------------------------------------------- |
| 설계·검토 | 01a086eb-e223-7da0-add7-9a4b23f6b487 | 사용자와 요구사항·범위·완료 조건을 정하고, 구현 결과와 PR을 검토하며 merge/deploy 여부를 판단한다. |
| 구현    | 01a086e6-2b4f-75b2-bcde-92c9a0afbbf6 | 승인된 작업을 실제 코드로 구현하고 테스트한 뒤 commit/push/PR 및 결과를 반환한다.           |

- 세션 UUID가 확정되면 위 표에 기록한다.
- UUID를 세션 식별의 기준으로 사용하고 제목이나 모델 이름으로 대신 선택하지 않는다.
- 새 작업마다 새로운 구현 세션을 생성하지 않는다.
- 사용자가 명시적으로 변경하지 않는 한 기존 설계·검토 세션과 기존 구현 세션을 계속 사용한다.
- 새 세션이 명시적인 인수인계 없이 기존 역할을 자동으로 차지하지 않는다.
- 설계 담당은 원칙적으로 실제 구현을 직접 수행하지 않는다.
- 구현 담당은 승인된 작업 범위를 임의로 확대하지 않는다.
- 구현 중 최초 가정과 다른 실제 원인을 발견하면 잘못된 가정에 맞춰 억지로 구현하지 않는다. 최소 범위에서 실제 원인에 맞게 수정하거나, 범위가 크게 달라지면 설계 담당에게 반환한다.

## 설계 → 구현 → 결과 반환

### 1. 설계 담당

구현 요청에는 필요한 범위에서 다음을 포함한다.

- 문제 또는 요구사항
- 확인된 원인 또는 조사 대상
- 기준 branch/commit이 중요한 경우 해당 값
- 수정 범위
- 반드시 보존할 동작
- 금지되는 변경
- 필요한 검증
- 완료 조건
- 결과를 반환할 설계 세션 UUID

이미 기존 세션과 AGENTS.md가 알고 있는 전체 프로젝트 설명을 매 요청마다 반복하지 않는다.

### 2. 구현 담당

구현 담당은 요청과 관련 코드를 확인하고 승인된 범위 안에서 작업한다.

기본 흐름:

`최신 main 확인 → 작업 branch → 최소 수정 → 관련 테스트 → diff 확인 → commit → push → PR`

하나의 요청은 가능하면 하나의 PR로 처리한다.

사용자가 별도로 지시하지 않은 경우 구현 담당은:

- PR을 merge하지 않는다.
- production deploy하지 않는다.
- 운영 D1 migration을 실행하지 않는다.

### 3. 결과 반환

구현 완료 후 상세 내용은 Git diff와 PR에 남긴다.

설계 담당에게 반환하는 메시지는 가능한 한 다음 정보만 간결하게 포함한다.

- 완료 / 중단 / 검증 실패 상태
- 실제 원인
- 핵심 수정 내용
- PR 번호와 URL
- HEAD SHA
- 테스트 결과
- D1 migration 여부
- frontend / Worker / D1 중 어떤 계층의 배포가 필요한지
- 추가 판단이 필요한 사항

결과 반환 자체는 merge/deploy 승인이 아니다.

### 4. 설계 담당의 검토

설계 담당은 구현 결과를 받은 뒤 필요한 범위만 검토한다.

구현 담당이 이미 확인한 정보를 이유 없이 처음부터 다시 조사하지 않는다.

필요에 따라:

- PR HEAD
- merge 가능 여부
- 핵심 diff
- 테스트 결과
- 변경 범위

를 검토한다.

## Queue 규칙

두 세션의 UUID가 확정된 뒤 `codex queue`를 사용해 작업 요청과 결과를 전달한다.

기본 형태:

`codex queue --thread <UUID> --message <TEXT>`

- 설계 담당 → 구현 담당: 승인된 구현 요청
- 구현 담당 → 설계 담당: 구현 및 검증 결과

긴 메시지를 보낼 때는 셸 quoting 문제를 피하기 위해 가능하면 argv 배열 방식으로 실행한다.

Queue 접수 성공과 작업 완료는 서로 다른 상태다.

사용자가 대기를 명시적으로 요청하지 않는 한:

- queue 접수 여부를 불필요하게 반복 조회하지 않는다.
- 상대 세션의 작업 완료를 polling하지 않는다.
- 결과가 반환되기 전까지 완료됐다고 주장하지 않는다.

기존 세션이 이미 알고 있는 역할과 queue 규칙을 매 작업마다 다시 주입하지 않는다.
새로운 규칙이나 행동 변경만 필요한 경우 한 번 전달한다.

## 검증 원칙

변경에 관련된 검증만 수행한다.

필요에 따라:

- Worker tests
- Browser/E2E tests
- Frontend tests
- build
- validate
- diff-check

를 수행한다.

테스트 개수를 늘리는 것 자체가 목적이 아니다.
실제 변경으로 발생할 수 있는 회귀를 검증하는 것이 목적이다.

## 배포 규칙

Frontend만 변경:

- Vercel production deployment 대상
- Worker 재배포는 필요하지 않다.

Worker runtime 변경:

- main merge 후 Cloudflare Worker 재배포가 필요하다.

D1 schema 변경:

- migration 필요성을 별도로 검토한다.
- 운영 migration은 명시적인 단계로 취급한다.

Public Website 변경:

- GitHub Pages 배포를 확인한다.

변경되지 않은 계층을 습관적으로 재배포하지 않는다.

## 데이터 안전

삭제 기능은 특히 보수적으로 처리한다.

기사 삭제의 기본 원칙:

- 선택한 기사만 삭제
- 해당 기사의 revision/feedback 등 종속 D1 데이터만 필요한 범위에서 삭제
- 다른 기사 보존
- 다른 학생 데이터 보존
- 관련 없는 과제 보존
- Google Drive 원본 보존

위험한 삭제 작업에는 명시적인 확인 절차를 둔다.

필요한 경우 프런트 확인뿐 아니라 서버에서도:

- admin 권한
- CSRF
- origin
- confirmation

을 검증한다.

Google Drive 원본은 사용자가 명시적으로 요구하지 않는 한 자동 삭제하지 않는다.

## UI 원칙

PrideDesk 기본 디자인:

- charcoal / near-black navy
- warm gold
- Apple-style Liquid Glass
- `cleanlogo.png`

Brand:

- `PrideDesk`
- `The Lion's Pride Editorial Workspace`

학교/동아리 표현:

- `중동고등학교 영자신문부`
- `The Lion's Pride`

bright cyan / blue / purple 중심 디자인으로 변경하지 않는다.

기존 디자인과 크게 어긋나는 브라우저 기본 UI는 가능한 경우 PrideDesk 스타일 컴포넌트를 사용한다.

## 금지 사항

다음을 하지 않는다.

- 증거 없이 원인을 단정하기
- 문제 해결을 위해 무작정 production 재배포하기
- 작은 버그 때문에 대규모 리팩터링하기
- 요청과 관련 없는 파일 수정하기
- 현재 Vercel frontend 구조를 과거 Worker frontend 구조로 되돌리기
- Classroom article sync를 다시 도입하기
- 필요하지 않은 D1 migration 만들기
- Google Drive 원본을 암묵적으로 삭제하기
- 동일한 PR/diff/API를 특별한 이유 없이 반복 조회하기
- 동일 프로젝트 작업마다 새로운 세션 만들기
- 요청 범위를 임의로 확대하기
- 확인하지 않은 운영 상태를 완료/정상/배포됨이라고 보고하기

## 문맥 관리

이 파일에는 자주 바뀌지 않는 아키텍처와 작업 규칙만 기록한다.

다음과 같이 자주 변하는 상태를 계속 누적하지 않는다.

- 현재 main HEAD
- 최근 PR 번호
- 현재 Worker Version ID
- 일시적인 production 상태
- 진행 중인 버그
- 단기 TODO

이러한 상태는 Git, PR 또는 해당 작업의 결과 메시지를 기준으로 한다.

과거 구현이 필요한 경우 새로 상상해서 만들기 전에 Git history에서 실제 기존 구현을 확인한다.

## 최우선 목표

많은 코드를 작성하는 것이 목표가 아니다.

가장 적은 변경으로 실제 원인을 해결하고,
현재 운영 중인 기능과 데이터를 보존하는 것을 최우선으로 한다.