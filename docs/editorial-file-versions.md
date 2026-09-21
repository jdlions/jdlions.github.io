# Affinity 편집 파일 버전 관리

## 범위와 운영 전제

별도 관리자 메뉴 `편집 파일`. 기존 Classroom에서 판별하는 admin 권한을 그대로 사용한다. 공용 `editor` 계정도 admin으로 판별되어야 한다. 로그인 이름은 작성자 표시로 사용하지 않으며, 매 업로드에 입력한 수정자를 별도 기록한다. 입력 이름 자체를 본인 인증하지는 않는다.

기존 저장소에는 Affinity 파일/기존 버전 관리 기능이 없었다. 실제 운영 계정의 private Drive 파일을 열람하거나 임의 생성하지 않았다. `.af`, `.afpub`, `.afdesign`, `.afphoto`를 허용한다. 새 Affinity `.af` 형식은 https://www.affinity.studio/ 공식 안내에서 확인했다. 확장자는 저장 형식 선택 기준이며 독점 바이너리 포맷을 파싱/변환하지 않는다. 새 확장자로 올려도 프로젝트와 번호는 이어진다. PDF/JPG 업로드나 미리보기는 없다.

기존 발행 데이터의 `year` + `Summer/Winter`를 프로젝트 키로 사용한다. 최초 한 번 연도/계절로 프로젝트를 만든다. 발행된 호수를 수정하거나 현재 작업 호수를 추측하지 않는다. 예: `2026_Winter_v001.afpub` → `2026_Winter_v002.af`. 사용자 파일명은 메타데이터로만 보존한다.

## 저장 및 전송

- Drive: 프로젝트 생성자가 사용하는 Google 계정 My Drive에 `PrideDesk Editorial — 2026_Winter` 전용 폴더를 새로 생성. 기존 사진 폴더를 부모로 쓰거나 이동/수정하지 않는다. permissions API를 호출하지 않는다. 공용 계정은 같은 저장소를 사용한다. 다른 관리자 Google 계정이 사용할 경우 담당자가 그 계정에 폴더 권한을 별도로 부여해야 한다. 공개 공유는 필요 없다.
- D1 migration `0006_editorial_files.sql`: `editorial_projects`, `editorial_versions`, `editorial_edit_sessions`, `editorial_upload_chunks` 신설. 기존 migration/table 변경 없음.
- 원본 1 GiB 상한, 2 MiB 조각. 브라우저 → 같은 origin API → Worker → Drive resumable upload. OAuth token과 resumable URL은 브라우저로 보내지 않는다. 큰 파일 전체를 Worker 메모리에 적재하지 않는다. 요청마다 기존 세션·admin·Origin·CSRF 검사. Google metadata/조각 요청 120초, 조각 전송 클라이언트 180초, 큰 파일 다운로드 스트림은 최대 30분. Google resumable protocol: https://developers.google.com/workspace/drive/api/guides/manage-uploads#resumable
- 파일 ID를 서버에서 사전 발급해 새 파일 POST에 지정. 기존 파일 PATCH/DELETE 없음. 정상 업로드 재시도는 같은 예약/파일 ID를 사용한다.
- 브라우저와 서버에서 각각 `SHA-256(ordered SHA-256(2MiB chunk) digests)` 계산. `content_hash`는 이 조각 기반 확인값이며 일반 파일 SHA-256과는 다르다. 각 조각 확인값을 전송 전에 D1에 기록해 재시도에서 다른 바이트를 섞을 수 없게 한다. 완료 시 Drive ID/name/size/parent/trashed 상태와 전체 조각 확인값을 검증하고 Drive의 MD5도 기록한다.
- 다운로드는 인증된 서버 스트림, attachment 표준 파일명, `private, no-store`, `nosniff`. 원본/썸네일 공개 URL 없음. 버전 기록은 50개씩 추가 조회한다.

## 충돌과 복구

최신본 다운로드를 누를 때 서버가 별도 편집 ticket과 기준 버전을 발급한다. 브라우저 **탭별 sessionStorage**에 보존하며 목록 새로고침으로 갱신하지 않는다. 같은 공용 계정의 별도 탭/기기도 각 ticket으로 구분한다. 탭을 닫으면 기준 정보가 사라지므로 최신본부터 다시 시작해야 한다. 브라우저 탭을 복제하거나 다른 사람과 같은 탭을 공유하지 않는다.

사용자가 다른 로컬 파일을 선택하거나 최신본 재다운로드 이후 옛 파일을 선택한 사실까지 Affinity 내부에서 추적할 수는 없다. 다운로드한 파일을 실제로 편집하는 운영 규칙이 필요하다. 이 기능은 자동 병합이나 편집 파일 내용의 계보 검증이 아니다.

예약: D1 원자적 batch에서 `latest_version=base AND pending_id IS NULL` 조건으로 잠금을 획득한 경우에만 버전 행 생성. 다른 업로드/오래된 기준은 409. 완료: Drive 검증 후 원자적 batch로 complete와 최신 포인터를 동시에 갱신. 중간 실패 시 이전 최신본 유지. 중복 finish는 같은 버전 반환.

전송 실패는 입력을 유지하고 같은 파일/수정자/메모로 재시도하면 Drive 수신 위치에서 계속한다. 시작 응답 유실도 같은 ticket으로 조회한다. 마지막 Drive 응답이 유실되거나 완료 세션이 만료된 경우 metadata를 재확인해 D1 완료를 재시도할 수 있다. Google 세션(통상 1주) 만료나 복구 불가능한 예약은 원래 계정에서 `중단`을 입력해 미완료 예약만 해제하고 최신본부터 다시 시작한다. 업로드 진행 중 내부 메뉴 이동 및 중복 제출을 막고 창 닫기 경고를 제공한다.

중단/DB 장애/동시 프로젝트 생성으로 private Drive에 미완료 파일이나 빈 폴더가 남을 수 있다. 안전상 자동 삭제하지 않는다. 이들은 완료 버전/최신본에 포함되지 않으며, 관리자가 별도 확인하기 전 삭제하지 않는다. 자동 잠금 만료로 진행 중인 업로드를 탈취하지 않는다.

검증 결과: Worker 178 / PrideDesk 3 / Chrome 62개, 총 243개. validate 및 diff-check 통과. 새 기능의 서버 테스트 13개와 브라우저 6개를 포함한다.

## API

모두 `/api/editorial-files` 아래 admin 전용:

- GET/POST `/projects`: 프로젝트 목록/생성
- GET `/projects/:id?before=N`: 최신본/완료 기록
- POST `/projects/:id/begin`: 탭 편집 기준 발급
- POST `/projects/:id/upload`: 파일 정보 검증·예약·Drive 세션 준비
- POST `/uploads/:id/status`: Drive 수신 위치 조회(Drive 상태 요청이므로 CSRF 적용)
- PUT `/uploads/:id/chunk`: 2 MiB 이하 조각; `X-Upload-Offset`
- POST `/uploads/:id/finish`: 무결성 검증·최신본 확정
- POST `/uploads/:id/cancel`: 확인 문자열 `중단`; 원본 계정만 예약 해제
- GET `/projects/:id/versions/:number/download`: 완료된 최신/과거 버전 스트림

## 테스트 및 적용 순서

실제 Worker 모듈 + 모든 migration을 적용한 격리 SQLite/D1 adapter로 버전 증가, 동시 CAS, stale, 이름 필수, 형식/크기, 메타데이터, hash, 복구, 취소, 다운로드 및 권한을 검사한다. Google Drive는 테스트 저장소/HTTP mock으로 검증하며 운영 Drive 파일을 생성하지 않는다. Chrome에서 390/820/1440px 업로드·히스토리·기준 보존·stale 오류와 기존 전체 회귀를 검사한다.

merge 후: **production D1에 0006만 적용 확인 → 기존 설정 유지한 Worker 배포 → Vercel frontend 반영**. migration은 추가 테이블만 만들므로 이전 Worker와 호환된다. Vercel Git 자동 배포가 Worker보다 앞서면 새 메뉴는 오류/재시도 상태가 되므로 배포 조율이 필요하다. GitHub Pages의 기존 공개 archive는 변경하지 않는다.

최종 운영 확인: 공용 editor 계정 admin 여부, 전용 폴더 생성 권한/충분한 Drive 용량, 실제 Affinity 파일을 열 수 있는지, 실제 대용량 업로드/다운로드의 Vercel 프록시 통과, 두 기기의 stale 차단을 비운영 파일로 확인. 이번 PR에서는 merge/production 배포/production migration을 수행하지 않는다.
