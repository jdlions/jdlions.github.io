# PR 59 실계정 검색 전용 Preview

## 분리 구성

- 고정 프런트: `https://pridedesk-git-feature-member-academic-year-the-lion-s-pride.vercel.app`
- 전용 Worker: `https://lions-pride-editorial-api-preview.editor-936.workers.dev`
- 전용 D1: `editorial-member-search-preview`, `90d03fac-c04f-4476-a595-470444abcb99`
- Worker config: `worker/wrangler.preview.toml`. 운영 `wrangler.toml`과 별도이다.
- 기존 migrations 0001–0010으로 빈 테스트 DB를 초기화했다. 기본 교사 1명, 학생 0명, 기사/과제 0건이며 운영 데이터는 복사하지 않았다.
- 테스트 SESSION_SECRET은 새 난수로 생성하여 전용 Worker에만 저장했다. 값은 출력하거나 파일에 저장하지 않았다.

기존 Preview는 API/auth를 운영 Worker로 rewrite했다. 변경 후 운영 호스트만 운영 Worker로, 위 고정 브랜치 호스트만 테스트 Worker로 연결된다. 임시 hash Preview URL에는 API rewrite가 없으므로 로그인 테스트에 사용하지 않는다. Host/Forwarded로 Worker OAuth origin을 임의 선택하지 않으며 기존 정확한 origin 검사를 유지한다.

`PREVIEW_MODE=member-search`에서는 session/login/logout, dashboard/회원 목록 읽기, Google 검색/연결만 허용한다. 회원 저장·수정, 기사·사진·Drive 업로드·편집 lock·Slack·과제 배정·발행은 API 진입 전에 거부한다. OAuth 첫 로그인에 따른 테스트 관리자 Google sub 연결만 기존 로그인 흐름에서 수행된다. 로그인 이메일도 `editor@joongdong.hs.kr`로 제한한다. 보통의 운영 모드에는 이 제한을 적용하지 않는다.

## 사용자가 직접 설정할 것

1. Cloudflare에서 **이름이 `lions-pride-editorial-api-preview`인 Worker**의 Settings → Variables and Secrets를 연다:
   `https://dash.cloudflare.com/9363832313953fdf927d0e0fa9bc1a84/workers/services/view/lions-pride-editorial-api-preview/production/settings`
   같은 기존 Google OAuth 웹 클라이언트의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 저장한다. 두 값 모두 Secret(암호화) 항목으로 저장한다. SESSION_SECRET은 이미 설정됐으므로 변경하지 않는다. 운영 Worker 설정은 건드리지 않는다. client secret을 채팅·Git·로그로 전달하지 않는다.
2. Google Cloud Console → `The Lions Pride Editorial` 프로젝트 → Google Auth Platform → Clients → 기존 웹 클라이언트를 연다:
   `https://console.cloud.google.com/auth/clients`
   Authorized redirect URIs에 아래 한 줄을 **추가**하고 기존 주소를 보존한다:
   `https://pridedesk-git-feature-member-academic-year-the-lion-s-pride.vercel.app/auth/callback`
   Worker의 내부 `/pridedesk/auth/callback`이나 임시 hash Preview 주소를 등록하지 않는다. JS origin 추가나 새 OAuth client는 필요 없다.
3. People API 활성화와 Data Access의 `https://www.googleapis.com/auth/directory.readonly` 등록은 사용자가 완료했다고 알린 상태다. 학교 Workspace 정책이 앱의 추가 동의를 막으면 학교 관리자가 이 client와 해당 읽기 scope를 승인해야 한다. 도메인 전체 위임은 사용하지 않는다.

## 실제 Google 로그인 단계 — 사용자 직접 진행

새 PR Preview가 고정 주소에 반영되고 위 secrets/URI가 확인된 뒤 수행한다.

1. 위 **고정 프런트 주소**를 일반 브라우저에서 연다. Vercel 접근 보호 화면이면 프로젝트 접근 권한이 있는 계정으로 먼저 로그인한다. 보호를 해제하거나 우회하지 않는다.
2. PrideDesk에서 `editor@joongdong.hs.kr`로 로그인한다. 학생·다른 학교 계정은 테스트 관리자로 등록하지 않는다.
3. 회원 관리 → 회원 등록 → 학교 디렉터리 → Google 검색 연결을 누른다.
4. 같은 학교 관리자 계정으로 추가 동의를 직접 승인한다. 일반 로그인 scope는 기존 그대로이며, 이 연결에서만 `directory.readonly`를 추가 요청한다. OAuth grant는 같은 client/Google 계정의 동의이지만 기존 운영 세션 쿠키·DB·Worker는 변경하지 않는다.
5. 회원 등록 화면을 다시 열어 `유현승`, 이름 일부, 이메일 일부를 각각 검색한다. 실제 결과가 나타났을 때만 선택 후 이름·이메일·현재 학번을 확인한다. 후보는 최대 10개다. 이메일에서 현재 학번을 추정하지 않는다. **저장 버튼은 누르지 않는다.**
6. 성공/실패 여부와 오류 종류만 보고한다. 연락처 목록, token, 쿠키, client secret, OAuth code/state가 들어간 callback URL을 복사하지 않는다.

## 실패 분류

- `redirect_uri_mismatch`: 위 exact callback 등록과 현재 접속 호스트를 확인한다.
- Vercel 로그인 화면/302: 같은 브라우저에서 고정 주소 접근 보호 인증을 먼저 완료한다.
- `configuration_error` 503: 테스트 Worker의 Google client 두 값이 아직 없거나 origin 설정이 잘못됐다.
- `authentication_required` 401: 테스트 세션이 없거나 만료됐다. 운영 세션을 옮기지 않는다.
- `csrf_rejected` 403: 고정 프런트의 동일 origin, 기존 CSRF header/cookie 흐름을 확인한다.
- Google 연결 후 권한 오류: scope 실제 동의 여부, People API, Workspace 앱 접근/디렉터리 공개 정책을 확인한다. 실패를 우회하지 않는다.
- 200 빈 결과: Google prefix 검색과 실제 디렉터리 프로필 필드/공개 범위를 확인한다. Gmail 후보와 같다고 간주하거나 가짜 결과를 만들지 않는다.
- `preview_read_only` 403: 의도적인 테스트 쓰기/다른 기능 차단이다. 실제 회원 저장은 테스트 범위가 아니다.

## 재배포/확인

사용자 승인된 이 테스트 리소스에만 아래 명시적 설정을 사용한다:

```sh
node worker/node_modules/wrangler/bin/wrangler.js deploy --config worker/wrangler.preview.toml --keep-vars --tag git-<PR_HEAD>
node worker/node_modules/wrangler/bin/wrangler.js secret list --config worker/wrangler.preview.toml
```

실제 검색 전에는 `/api/session` 비로그인 응답, 검색 401, 회원 저장·업로드 403, no-store, DB binding/교사 수만 확인한다. 운영 D1 쿼리·마이그레이션·복사·복구는 하지 않는다. Cloudflare 리소스는 사용자 승인으로 생성했으며 저장/요청량에 따라 계정 요금제의 포함량을 사용한다. 리소스를 임의 삭제하거나 다른 유료 서비스를 만들지 않는다.
