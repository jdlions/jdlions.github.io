# Affinity 편집 파일 버전 관리

## 운영 구조와 사용 흐름

기존 PR #37의 private Drive 저장, 프로젝트별 버전, 1 GiB/2 MiB 분할 업로드와 재시도를 유지한다. 관리자 `편집 파일`에서 `편집자 설정`을 열어 편집장/부편집장의 이름과 Slack **멤버 ID**를 등록한다. 현재 작업자를 선택하고 `편집 시작`을 누르면 서버 잠금 획득 후 최신본을 다운로드한다. 파일을 수정한 뒤 메모(선택)와 Affinity 원본 하나만 업로드한다. 별도 PDF/JPG/미리보기는 없다.

기존 Classroom admin 판정이 접근 권한이다. 역할 선택은 공용 editor 계정에서 작업자를 구분하는 자기신고이며 개인 신원을 인증하지 않는다. admin은 두 역할을 선택할 수 있다. 서명·암호화된 Secure/HttpOnly/SameSite=Lax 쿠키는 선택 역할만 기억한다. 잠금은 쿠키나 탭이 아니라 D1에 있으므로 재로그인/다른 기기에서 같은 Google 계정과 역할을 선택하면 복원된다. 다른 Google 계정은 소유자 업로드/취소를 할 수 없고, 관리자 강제 종료 절차를 이용한다.

프로젝트 키는 기존 발행 정보와 같은 연도 + Summer/Winter. 파일명 `2026_Winter_v001.afpub` → `2026_Winter_v002.af`. `.af`, `.afpub`, `.afdesign`, `.afphoto`를 지원하며 확장자가 바뀌어도 번호는 하나로 이어진다. 원본 파일명은 metadata로 보존한다. Affinity 바이너리를 파싱하지 않으므로 새 checkout 후 잘못된 옛 로컬 파일을 직접 선택한 것까지 판별할 수는 없다.

## 잠금·버전·경합

- `editorial_locks`의 프로젝트별 active partial UNIQUE index가 동시 checkout을 하나로 제한한다. base_version/역할/이름/시작 시각과 Slack 수신자 ID를 checkout 시 snapshot한다. 이름이나 담당자가 바뀌어도 진행 중 작업의 귀속과 과거 버전은 바뀌지 않는다. 이후 checkout부터 새 설정을 사용한다.
- 업로드 예약/완료마다 소유 계정·역할·active lock·현재 latest=base를 재검증한다. Drive 파일 검증 후 D1 batch에서 버전 확정, latest 갱신, 잠금 종료, audit 생성을 원자적으로 처리한다. 동시 finish는 같은 결과를 반환하며 번호/audit/알림을 중복 생성하지 않는다.
- 소유자 취소/다른 작업자 강제 종료는 확인창과 서버 확인 문자열을 요구한다. audit에 행위자 계정/역할/이름, 소유자 역할/이름, base, 시각을 보존한다. 프런트 목록에는 계정 ID와 Slack ID를 노출하지 않는다.
- 강제 종료와 finish가 경합하면 먼저 확정된 D1 결과 하나만 유효하다. 종료된 업로드는 latest가 될 수 없다. 전송 중 Google 요청까지 원자적으로 중지할 수는 없으므로 미완료 private 파일이 남을 수 있지만 자동 삭제하지 않는다.
- 잠금은 자동 만료하지 않는다. 취소/강제 종료는 기존 완료 버전이나 Drive 원본을 지우지 않는다. 업로드 중복 클릭·내부 화면 전환 방지와 창 닫기 경고를 유지한다.

## Drive 및 재시도

프로젝트 생성자의 My Drive에 `PrideDesk Editorial — 2026_Winter` 전용 private 폴더를 생성한다. 기존 사진/기사 폴더를 변경하지 않는다. 다른 Google 계정을 쓸 경우 폴더 권한은 담당자가 따로 부여해야 한다. permissions API, 기존 파일 PATCH/DELETE는 호출하지 않는다.

원본 상한 1 GiB, 조각 2 MiB. 브라우저 → 기존 동일 origin 프록시 → Worker → Drive resumable upload. OAuth token/resumable URL은 프런트로 보내지 않는다. 각 요청에 기존 인증/admin/Origin/CSRF를 적용한다. Google 조각·metadata 120초, 클라이언트 조각 180초, 다운로드 스트림 최대 30분.

확인값은 `SHA-256(ordered SHA-256(2 MiB chunk) digests)`이며 일반 파일 SHA-256과 다르다. 재전송 조각의 바이트 혼합을 차단하고 완료 시 Drive ID/name/size/parent/trashed 및 hash를 검증한다. Drive MD5도 기록한다. 동일 파일·메모로 재시도하면 같은 예약/Drive ID와 수신 위치를 사용한다. 부분 acknowledgement와 최종 응답 유실을 처리한다. 재접속 시 로컬 파일을 다시 선택해야 하며, 만료된 Drive 세션은 편집 취소 후 최신본에서 다시 시작한다.

완료 버전만 인증된 attachment 스트림으로 다운로드하며 `private, no-store`, `nosniff`를 유지한다. 버전 기록은 50개씩 가져온다.

## Slack 설정과 실패 처리

Slack은 실제 D1 이벤트에서만 발송한다. 임의 수신자/본문을 보내는 API는 없다.

- 강제 종료: checkout 당시 소유자의 Slack ID로 DM. 담당자 설정 변경 후에도 원래 작업자에게 간다.
- 버전 확정: 설정된 `#pridedesk-알림`의 채널 ID로 프로젝트/버전/역할/이름/메모/시각을 알린다. private 파일/Drive ID/다운로드 URL은 첨부하지 않는다.
- 기본 DM/채널 알림은 OFF. 토큰은 Worker secret `SLACK_BOT_TOKEN`만 사용한다. 이름/사용자 ID/채널 ID와 ON/OFF는 D1 설정에 보관한다.
- 공식 API 최소 bot scopes: `chat:write`, `im:write`. 멤버 ID를 직접 입력하므로 사용자 목록/이메일/history scope는 필요 없다. bot을 채널에 초대하므로 `chat:write.public`도 불필요하다.
- D1 확정 후 발송. 실패/timeout은 저장·잠금 종료를 rollback하지 않는다. audit의 notification_status와 UI 경고로 구분한다. 성공(sent), 명확한 거절(failed), 결과 불명(unknown), 설정 누락(not_configured/skipped_unlinked), OFF(skipped_off), 제한(rate_limited)을 기록한다.
- 한 audit 이벤트당 원자적으로 발송권을 한 번만 획득한다. DM은 역할당 시간당 3회, 업로드 채널 알림은 시간당 60회. timeout은 실제 전달됐을 수도 있어 자동 재발송하지 않는다. 프로세스가 발송 도중 종료된 pending/sending 상태도 결과 미확인으로 남기며 자동 재전송하지 않는다. 메시지 전달을 보장하는 durable queue는 도입하지 않았다.
- 고정 Slack API host만 사용, 각 요청 10초 timeout, redirect 차단. 텍스트 자동 mention/링크 펼침을 비활성화한다. 원문 오류나 bot token은 응답/로그에 남기지 않는다.

관리자가 할 일:

1. 편집부 Slack workspace에 앱을 설치하고 Bot Token Scopes `chat:write`, `im:write`를 부여한다. scope 변경 시 재설치한다.
2. bot을 기존 `#pridedesk-알림`에 초대하고 채널 ID를 복사한다.
3. 두 편집자의 Slack 프로필에서 멤버 ID를 복사한다. 표시 이름/이메일을 입력하지 않는다.
4. Worker `lions-pride-editorial-api`의 secret에 `SLACK_BOT_TOKEN`을 등록한다. 저장소·D1·브라우저에 token을 넣지 않는다.
5. 배포 후 편집자 설정에 이름/멤버 ID/채널 ID를 저장하고 원하는 알림을 켠다. 이 PR 작업에서는 실제 Slack 메시지를 보내지 않았다.

공식 근거: [conversations.open](https://docs.slack.dev/reference/methods/conversations.open/), [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/), [im:write](https://docs.slack.dev/reference/scopes/im.write/).

## API (모두 admin 전용)

- GET/PUT `/api/editorial-files/settings`: 편집자와 Slack 설정
- GET `/editors`: 표시 이름/선택 역할 (이하 같은 prefix)
- POST `/operator`: 선택 역할의 보호된 쿠키
- GET/POST `/projects`: 프로젝트 목록/생성
- GET `/projects/:id?before=N`: latest/lock/완료 기록/audit
- POST `/projects/:id/checkout`: 단일 잠금 + 최신본 다운로드 정보
- POST `/projects/:id/upload`: lockId, 파일 metadata, 선택 메모
- POST `/uploads/:id/status`, PUT `/uploads/:id/chunk`, POST `/uploads/:id/finish`: 기존 조각 전송/확정
- POST `/locks/:id/cancel` 또는 `/force`: `편집 취소` 또는 `강제 종료` 확인 문자열
- GET `/projects/:id/versions/:number/download`: 완료 원본

이전 `/begin`, `/uploads/:id/cancel`, 탭 ticket은 제거했다. 모든 mutation은 기존 Origin/CSRF 경계를 통과하고 응답은 private/no-store다.

## Migration 및 배포 순서

이미 commit된 `0006_editorial_files.sql`은 변경하지 않는다. 추가 `0007_editorial_checkout.sql`은 editors/settings/locks/audit, active UNIQUE index, version.editor_role을 추가한다. 0006의 완료 기록은 그대로 유지하며 역할 미상으로 표시한다. 이전 탭 기반 미완료 예약만 cancelled 처리하고 pending을 해제한다. Drive 객체/완료 원본은 삭제하지 않는다. 기존 0006 preview를 사용했다면 진행 중 업로드를 멈춘 뒤 적용해야 한다.

승인된 merge 이후 **D1 적용 상태 확인 → 미적용 0006 → 0007 → Worker(secret 포함) → Vercel frontend**. Git 자동 frontend 배포가 앞서지 않도록 조율한다. 다른 미적용 migration을 묶어서 실행하지 않는다. GitHub Pages 재배포는 불필요하다. Worker를 migration보다 먼저 배포하면 새 모듈에서 schema 오류가 난다.

이번 작업에서 원격 migration 목록 확인은 Cloudflare 7403(계정/권한) 오류로 확인하지 못했다. 실제 적용 여부는 배포 담당자가 올바른 계정으로 확인해야 한다. production migration/배포/merge는 실행하지 않는다.

## 검증과 운영 확인 범위

실제 Worker 코드와 격리 SQLite D1 adapter에서 전체 migration, 버전/lock/force 경합, snapshot, 안전한 업그레이드, 권한, 파일 무결성, Slack 성공/실패/중복/제한을 검증한다. Slack/Drive는 mock만 사용한다. 브라우저에서는 390/820/1440px, v14 다운로드 후 탭 종료/새 context에서 v15 저장, 작업자 전환, 설정, 강제 종료 확인/경고, 전송 실패/재시도를 검사한다.

운영 후 별도 확인: 공용 editor의 admin 권한, 전용 Drive 폴더 접근/용량, 실제 Affinity 파일 열기, 실제 대용량 파일의 프록시 통과, Slack 앱 권한/워크스페이스 정책. 격리 테스트는 실제 1 GiB 전송이나 Slack 전달을 대체하지 않는다.

최종 검증: Worker 186 / PrideDesk 3 / Chrome 63, 총 252개 통과. build, validate, diff-check 통과. 운영 Slack/Drive 전송과 production migration은 실행하지 않았다.
