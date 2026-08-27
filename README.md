# The Lion's Pride

중동고 영자신문부 **The Lion's Pride**의 GitHub Pages 공개 사이트와 운영용 편집 시스템입니다.

> 이 저장소는 공개 저장소입니다. Google/Cloudflare 토큰, 학생 이름·원고·사진, 편집자 내부 메모를 커밋하지 마세요.

## 운영 구조

| 영역 | 역할 |
| --- | --- |
| GitHub Pages | 공개 홈페이지, Archive, 공개 네비게이션 |
| Cloudflare Worker | `/editorial/*` 내부 UI, Google OAuth, Classroom 역할 판별, 서버 세션, 권한 검사, API |
| Google Classroom/Drive/Docs | 구성원·과제·제출물과 읽기 전용 기사 원문 |
| Cloudflare D1 | Issue 설정, 별도 편집본, 메모/공개 범위, 검토 상태, 사진 메타데이터 |
| Private Google Drive | 학생 사진 파일과 최종 신문 PDF |
| `data/issues.json` | 공개 Archive의 검토·커밋된 발행 목록 |

정식 로그인 URL은 `https://lions-pride-editorial-api.editor-936.workers.dev/editorial/login/`입니다. 공개 사이트의 LOGIN 링크만 이 주소로 이동하며, 내부 UI와 API/OAuth/session cookie는 모두 같은 Worker origin을 사용합니다. 프런트엔드 API base는 빈 문자열이고 `/api/...` 상대 경로만 사용합니다. 브라우저 `localStorage`/`sessionStorage`의 mock 권한이나 데이터를 사용하지 않으며, 과거 mock 구현 파일은 개발 참고용으로만 남아 있고 production factory에서 import되지 않습니다.

## 로그인과 권한

1. Worker의 `/editorial/login/`에서 학교 Google 계정으로 로그인합니다.
2. Worker가 Authorization Code + PKCE를 완료하고 설정된 신문부 Classroom의 현재 membership을 확인합니다.
3. Classroom teacher는 `admin`, student는 `student` 세션을 받습니다. 비구성원은 거부됩니다.
4. `/editorial/admin/`과 `/editorial/student/`는 same-origin `GET /api/session` 결과로 분기하며, 세션이 없으면 `/editorial/login/`으로 이동합니다.

세션과 OAuth state 쿠키는 `__Host-` 이름, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`를 사용합니다. 변경 요청은 요청 URL과 같은 `Origin` 및 `X-Editorial-CSRF` 헤더가 모두 필요합니다. 초기 session 조회가 401/403 또는 네트워크 오류로 실패해도 로그인 화면은 미인증 상태로 열려 새 Google 로그인을 시작할 수 있습니다. 학생 기사·사진 조회는 서버 세션에서 얻은 Classroom 학생 ID로 다시 제한하며, 내부 메모는 학생 응답에서 제거합니다.

## 관리자 운영 절차

### 새 Issue와 Classroom 과제 연결

1. Google Classroom에서 기사 유형별 과제를 먼저 만듭니다.
2. `/editorial/admin/` → **호 설정**에서 새 Issue 이름, 연도, 시즌을 입력합니다.
3. 설정된 신문부 Classroom을 선택합니다.
4. 실제 courseWork 목록에서 각 기사 유형의 과제를 직접 선택합니다.
5. 저장 후 Issue를 **Set active**로 활성화합니다.

연결은 과제명이 아니라 안정적인 `classroomCourseId`와 각 `courseWorkId`로 저장됩니다. 과제명을 바꾸어도 연결 ID는 유지됩니다. 새 기사 유형을 추가하려면 `articleTypes: [{ id, label, courseWorkId }]` 배열을 확장하세요.

### 기사·사진 편집

- 기사 원문은 Classroom 짧은 답변, Google Docs, DOCX 제출을 지원하며 읽기 전용으로 가져옵니다. 편집본은 D1에 별도로 저장합니다.
- 권장 배부 방식은 Classroom `ASSIGNMENT`에서 Word 기사 양식을 학생별로 배부하고, 학생이 완성한 `.docx`를 제출하게 하는 방식입니다. DOCX 양식의 학번, 이름, 기사 제목(한글), 기사 제목(English), Article Body는 가능한 경우 구조화하며, 양식이 달라도 전체 텍스트를 표시합니다.
- DOCX는 최대 8 MB까지 처리합니다. 손상되었거나 너무 큰 파일, 읽기 권한이 없는 파일은 해당 기사에만 오류를 표시하고 원본 Drive 링크를 제공합니다. 여러 첨부가 있으면 파일명과 MIME 형식으로 기사 DOCX를 우선 선택하며 첫 첨부를 임의로 사용하지 않습니다.
- 메모는 기본적으로 `internal`입니다. 학생에게 보여야 할 때만 공개 범위를 명시적으로 변경합니다.
- 학생 사진은 본인의 연결된 제출물에만 업로드할 수 있고, 파일은 비공개 Drive 폴더에 저장됩니다.
- 지원 사진 형식은 JPEG, PNG, WebP이며 파일당 최대 15MB입니다.

### 사진 제출 Drive 폴더 권한

사진 업로드는 로그인한 학생의 OAuth 토큰으로 실행됩니다. 따라서 `DRIVE_UPLOAD_FOLDER_ID`만 설정해서는 충분하지 않으며, **각 학생 계정이 대상 폴더에서 파일을 추가할 수 있어야 합니다**. Worker는 업로드 전에 학생 토큰으로 `files.get(fields=id,name,mimeType,driveId,capabilities&supportsAllDrives=true)`를 호출하고 `capabilities.canAddChildren`을 확인합니다. 폴더가 보이지 않거나 이 값이 `false`이면 코드로 우회하지 않고 제출을 거부합니다.

권장 운영 설정은 다음 중 하나입니다. 공개 링크(`anyone`) 공유는 사용하지 마세요.

1. 권장: 학교 Workspace에서 사진 제출 전용 Shared Drive 또는 그 안의 전용 폴더를 만듭니다.
2. 영자신문부 학생 Google Group(또는 실제 제출 학생 계정)을 Shared Drive 구성원으로 추가하고 파일 추가가 가능한 `Contributor` 이상 권한을 부여합니다. 폴더 제한 정책이 있다면 해당 폴더에도 파일 추가가 허용되는지 확인합니다.
3. 대안: 학교 관리자의 My Drive에 비공개 전용 폴더를 만들고 같은 그룹/학생을 `Editor`로 공유합니다. `Viewer`/`Commenter`는 파일을 추가할 수 없습니다.
4. 폴더 ID를 Cloudflare의 `DRIVE_UPLOAD_FOLDER_ID`에 설정합니다. 학생이 개인 Drive 바로가기만 추가하는 것은 권한 부여가 아닙니다.
5. 실제 학생 계정으로 다시 로그인한 뒤 제출을 확인합니다. 기존 OAuth 동의에 `drive.file`이 있고 대상 폴더 메타데이터 조회에 필요한 읽기 scope가 유지되어야 합니다. `drive.file`은 앱이 새 파일을 만드는 데 사용할 수 있지만, 임의의 기존 중앙 폴더 접근 권한을 새로 부여하지 않습니다.

배포 후 관리자는 같은 Worker origin에서 로그인한 상태로 `GET /api/photos/folder-status`를 호출해 자신의 현재 토큰 기준 `accessible`, `canAddChildren`, `storage`(`my_drive` 또는 `shared_drive`)만 확인할 수 있습니다. 응답은 폴더 ID와 폴더 이름을 노출하지 않습니다. 학생에게는 이 진단 endpoint가 허용되지 않습니다. 실제 학생 권한은 반드시 학생 계정으로 제출하거나 학생 토큰의 preflight로 확인해야 합니다.

Drive 업로드가 성공한 뒤에만 D1 사진 metadata를 생성합니다. D1 저장이 실패하면 Worker가 방금 만든 Drive 파일을 즉시 삭제하며, 삭제도 실패한 경우에는 토큰·파일 내용·이메일·Google 원문 오류 없이 안정적인 `drive_orphan_cleanup_failed` 코드와 status만 로그에 남깁니다.

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
| `EDITORIAL_ORIGIN` | `https://lions-pride-editorial-api.editor-936.workers.dev` |
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

`npm run deploy`는 한글 Liquid Glass UI의 production 의존 파일만 `worker/.static/editorial/`에 생성한 뒤 Worker static assets와 코드를 함께 배포합니다. `.static`은 생성물이라 커밋하지 않습니다. 내부 UI, `worker/src`, migration, `wrangler.toml` 또는 Worker 환경 설정을 바꾼 경우 테스트 후 Worker를 재배포해야 합니다. 공개 홈페이지만 변경한 경우에는 Worker 재배포가 필요 없습니다.

## 검증

```bash
python scripts/validate.py
cd worker
npm install
npm run check
```

배포 후에는 미로그인 `GET /api/session`, teacher→admin, student→student, 비구성원 거부, 실제 courseWork 연결, DOCX/Google Docs/짧은 답변 원문 조회, D1 편집본 저장, 내부 메모 비노출, 본인 제출물 제한, Drive 사진 업로드, 로그아웃/만료 세션을 순서대로 확인합니다.

## 배포와 롤백

- GitHub Pages: 변경 브랜치에서 PR을 만들고 검증 후 `main`에 merge합니다. 직접 push하지 않습니다. 기존 `/login/`, `/admin/`, `/student/`는 session 실패를 미인증으로 처리하고 Worker 정식 로그인으로 안전하게 넘깁니다.
- Worker: 위 명령으로 내부 UI와 API를 함께 배포합니다. 기존 운영 변수와 secrets는 그대로 보존합니다. Google OAuth console의 authorized redirect URI는 위 `OAUTH_REDIRECT_URI`와 정확히 일치해야 합니다.
- 공개 사이트 롤백: 문제 PR의 merge commit을 새 revert PR로 되돌립니다.
- Worker 롤백: Cloudflare Deployments에서 UI와 API가 함께 들어 있는 직전 정상 배포를 선택해 rollback한 뒤 원인을 수정한 PR을 만듭니다. 롤백 시 LOGIN 링크와 Worker 배포 버전의 호환성도 확인합니다.
- D1 migration은 적용 전에 백업하고, destructive rollback 대신 forward-fix migration을 사용합니다.

## 보안 원칙

원문과 Google/Drive metadata는 신뢰하지 않습니다. Docs 텍스트는 escape하고 편집 HTML은 Worker allow-list sanitizer를 거칩니다. CORS/CSRF와 현재 Classroom membership 확인을 유지하고, 비공개 자료를 공개 Archive나 로그에 넣지 않습니다. 실제 운영 전반에는 rate limiting, 감사 로그, 보존·삭제 정책과 D1 백업을 별도로 운영하세요.
