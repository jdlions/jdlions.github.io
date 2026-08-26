# The Lion's Pride

중동고 영자신문부 **The Lion's Pride**의 GitHub Pages 공개 사이트와 운영용 편집 시스템입니다.

> 이 저장소는 공개 저장소입니다. Google/Cloudflare 토큰, 학생 이름·원고·사진, 편집자 내부 메모를 커밋하지 마세요.

## 운영 구조

| 영역 | 역할 |
| --- | --- |
| GitHub Pages | 공개 홈페이지, `/login/`, `/student/`, `/admin/` 정적 UI |
| Cloudflare Worker | Google OAuth, Classroom 역할 판별, 서버 세션, 권한 검사, API |
| Google Classroom/Docs | 구성원·과제·제출물과 읽기 전용 기사 원문 |
| Cloudflare D1 | Issue 설정, 별도 편집본, 메모/공개 범위, 검토 상태, 사진 메타데이터 |
| Private Google Drive | 학생 사진 파일과 최종 신문 PDF |
| `data/issues.json` | 공개 Archive의 검토·커밋된 발행 목록 |

운영 API는 `https://lions-pride-editorial-api.editor-936.workers.dev`입니다. 프런트엔드는 항상 이 API를 사용하며 브라우저 `localStorage`/`sessionStorage`의 mock 권한이나 데이터를 사용하지 않습니다. 과거 mock 구현 파일은 개발 참고용으로만 남아 있고 production factory에서 import되지 않습니다.

## 로그인과 권한

1. `/login/`에서 학교 Google 계정으로 로그인합니다.
2. Worker가 Authorization Code + PKCE를 완료하고 설정된 신문부 Classroom의 현재 membership을 확인합니다.
3. Classroom teacher는 `admin`, student는 `student` 세션을 받습니다. 비구성원은 거부됩니다.
4. `/admin/`과 `/student/`는 `GET /api/session` 결과로 분기하며, 세션이 없으면 `/login/`으로 이동합니다.

세션 쿠키는 `Secure`, `HttpOnly`, `SameSite=None`입니다. 변경 요청은 정확한 `FRONTEND_ORIGIN`과 `X-Editorial-CSRF` 헤더가 모두 필요합니다. 학생 기사·사진 조회는 서버 세션에서 얻은 Classroom 학생 ID로 다시 제한하며, 내부 메모는 학생 응답에서 제거합니다.

## 관리자 운영 절차

### 새 Issue와 Classroom 과제 연결

1. Google Classroom에서 기사 유형별 과제를 먼저 만듭니다.
2. `/admin/` → **호 설정**에서 새 Issue 이름, 연도, 시즌을 입력합니다.
3. 설정된 신문부 Classroom을 선택합니다.
4. 실제 courseWork 목록에서 각 기사 유형의 과제를 직접 선택합니다.
5. 저장 후 Issue를 **Set active**로 활성화합니다.

연결은 과제명이 아니라 안정적인 `classroomCourseId`와 각 `courseWorkId`로 저장됩니다. 과제명을 바꾸어도 연결 ID는 유지됩니다. 새 기사 유형을 추가하려면 `articleTypes: [{ id, label, courseWorkId }]` 배열을 확장하세요.

### 기사·사진 편집

- Google Docs 원문은 읽기 전용으로 가져오며 편집본은 D1에 별도로 저장합니다.
- 메모는 기본적으로 `internal`입니다. 학생에게 보여야 할 때만 공개 범위를 명시적으로 변경합니다.
- 학생 사진은 본인의 연결된 제출물에만 업로드할 수 있고, 파일은 비공개 Drive 폴더에 저장됩니다.
- 지원 사진 형식은 JPEG, PNG, WebP이며 파일당 최대 15MB입니다.

### 공개 Archive 발행

관리자 발행 화면은 최종 Drive URL의 **미리보기만** 제공합니다. Worker/D1 저장만으로 GitHub Pages의 `data/issues.json`은 갱신되지 않으므로 브라우저에는 실제 발행 버튼이 없습니다.

정식 발행 절차:

1. 최종 PDF의 공유 범위를 학교 정책에 맞게 확인합니다.
2. 새 브랜치에서 `data/issues.json`에 다음 Issue 번호·표시 날짜·Drive URL을 추가합니다.
3. `python scripts/validate.py`를 실행합니다.
4. PR에서 링크, 번호 순서, 개인정보 부재를 검토한 뒤 merge합니다.

GitHub write token을 프런트엔드나 Worker에 넣지 마세요. 향후 자동화가 필요하면 GitHub Actions의 보호된 환경, 최소 권한 토큰, 승인 단계가 있는 별도 발행 workflow로 구현합니다.

## Worker 설정과 배포

Cloudflare 일반 변수:

| 이름 | 값 |
| --- | --- |
| `FRONTEND_ORIGIN` | `https://jdlions.github.io` |
| `OAUTH_REDIRECT_URI` | `https://lions-pride-editorial-api.editor-936.workers.dev/auth/callback` |
| `NEWSPAPER_CLASSROOM_ID` | 신문부 Classroom의 stable course ID |
| `DRIVE_UPLOAD_FOLDER_ID` | 학교가 관리하는 비공개 Drive 폴더 ID |

Cloudflare secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, 32바이트 이상의 무작위 `SESSION_SECRET`. 값은 저장소, Issue, PR, 스크린샷에 남기지 않습니다. D1 binding 이름은 `DB`를 유지합니다.

```bash
cd worker
npm install
npm run check
npm run db:remote
npm run deploy
```

프런트엔드만 변경한 경우 Worker 재배포는 필요 없습니다. `worker/src`, migration, `wrangler.toml` 또는 Worker 환경 설정을 바꾼 경우 테스트 후 재배포합니다.

## 검증

```bash
python scripts/validate.py
cd worker
npm install
npm run check
```

배포 후에는 미로그인 `GET /api/session`, teacher→admin, student→student, 비구성원 거부, 실제 courseWork 연결, Docs 원문 조회, D1 편집본 저장, 내부 메모 비노출, 본인 제출물 제한, Drive 사진 업로드, 로그아웃/만료 세션을 순서대로 확인합니다.

## 배포와 롤백

- GitHub Pages: 변경 브랜치에서 PR을 만들고 검증 후 `main`에 merge합니다. 직접 push하지 않습니다.
- Worker: 위 명령으로 별도 배포합니다. 기존 운영 변수와 secrets는 그대로 보존합니다.
- 프런트엔드 롤백: 문제 PR의 merge commit을 새 revert PR로 되돌립니다.
- Worker 롤백: Cloudflare Deployments에서 직전 정상 배포를 선택해 rollback한 뒤 원인을 수정한 PR을 만듭니다.
- D1 migration은 적용 전에 백업하고, destructive rollback 대신 forward-fix migration을 사용합니다.

## 보안 원칙

원문과 Google/Drive metadata는 신뢰하지 않습니다. Docs 텍스트는 escape하고 편집 HTML은 Worker allow-list sanitizer를 거칩니다. CORS/CSRF와 현재 Classroom membership 확인을 유지하고, 비공개 자료를 공개 Archive나 로그에 넣지 않습니다. 실제 운영 전반에는 rate limiting, 감사 로그, 보존·삭제 정책과 D1 백업을 별도로 운영하세요.
