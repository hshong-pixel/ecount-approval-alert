# ecount-approval-alert

이카운트 그룹웨어(그룹웨어 > 전자결재 > 기안서통합관리 > 진행중 탭)에서
결재자가 `ECOUNT_APPROVER_NAME`(기본값: 김대희)인 미결재 문서 목록을 수집해,
카카오톡 "나에게 보내기"로 전송합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm start
```

## 환경변수

| 변수 | 설명 |
|---|---|
| `ECOUNT_LOGIN_URL` | 이카운트 로그인 URL (기본 `https://login.ecount.com`) |
| `ECOUNT_COM_CODE` | 회사코드 |
| `ECOUNT_ID` | 아이디 |
| `ECOUNT_PASSWORD` | 비밀번호 |
| `ECOUNT_APPROVER_NAME` | 필터링할 결재자 이름 (기본 `김대희`) |
| `KAKAO_REST_API_KEY` | 카카오 앱 REST API 키 |
| `KAKAO_REFRESH_TOKEN` | 카카오 OAuth refresh token |
| `KAKAO_CLIENT_SECRET` | (선택) Client Secret 사용 설정 시에만 |

## 동작 요약

1. Playwright(headless chromium)로 로그인 → 그룹웨어 > 전자결재 > 기안서통합관리 > 진행중 탭 이동
2. 목록 테이블에서 결재자 = `ECOUNT_APPROVER_NAME` 인 행만 추출 (기안일자/제목/기안자)
3. 카카오 refresh_token으로 access_token 매번 갱신 후 "나에게 보내기"로 전송 (길면 여러 건으로 분할)
4. 로그인 실패 / 테이블 못 찾음 / 카카오 전송 실패 시 에러 로그 남기고 종료 코드 1로 종료. 미결재 0건은 정상 처리(안내 메시지 전송, 종료 코드 0).

## 매일 자동 실행 (GitHub Actions)

`.github/workflows/daily-ecount-alert.yml` 이 평일(월~금) 07:47(KST, cron `47 22 * * 0-4` UTC)에
저장소를 checkout해 `npm ci && npm start`를 실행합니다. 수동 테스트는 저장소의
Actions 탭 → "Ecount 미결재 카카오 알림" → "Run workflow" 로 가능합니다(`workflow_dispatch`).

> GitHub Actions의 예약 실행(`schedule`)은 정확한 시각을 보장하지 않습니다. 특히 정각(00분)은
> 전 세계적으로 요청이 몰려 지연이 더 심한 편이라, 실제 8시까지 도착하도록 07:47으로 당겨뒀습니다.
> 그래도 부하 상황에 따라 몇 분~몇십 분 지연될 수 있습니다.

### GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions → New repository secret** 에서
아래 이름으로 등록하세요 (값은 GitHub에 암호화 저장되고, 워크플로 로그에도 자동 마스킹됩니다):

- `ECOUNT_COM_CODE`
- `ECOUNT_ID`
- `ECOUNT_PASSWORD`
- `KAKAO_REST_API_KEY`
- `KAKAO_REFRESH_TOKEN`
- (선택) `ECOUNT_APPROVER_NAME` — 기본값 `김대희`, 다른 결재자를 필터링하려는 경우에만
- (선택) `KAKAO_CLIENT_SECRET` — 카카오 앱에서 Client Secret 사용을 켠 경우에만

## 알려진 제한사항 / 확인 필요 사항

- **날짜 필터**: 기안서통합관리 화면에는 자체 날짜 범위 필터(예: 2026/07/01~2026/08/30)가 있습니다. 이 스크립트는 화면에 보이는 현재 필터 상태를 그대로 사용합니다. 만약 그 범위보다 오래된 미결재 문서가 있다면 누락될 수 있으니, 실제 계정으로 한 번 값 없이 접속해 기본 필터 범위가 충분히 넓은지 확인해주세요.
- **메뉴/컬럼 텍스트 변경**: 그룹웨어 화면 구조(그룹웨어/전자결재/기안서통합관리/진행중 텍스트, 기안자/제목/결재자 컬럼명)가 바뀌면 스크립트가 실패합니다. 실패 시 로그에 어느 단계에서 멈췄는지 남습니다.
- **카카오 refresh_token 갱신**: 카카오가 드물게 새 refresh_token을 내려줄 수 있습니다(만료 임박 시). 이 경우 Actions 실행 로그에 `NEW_REFRESH_TOKEN=...` 이 출력되니, 이 값으로 `KAKAO_REFRESH_TOKEN` 시크릿(Settings → Secrets and variables → Actions)을 수동으로 갱신해야 합니다. GitHub Actions 러너도 매 실행마다 새 환경이라 자동으로 값을 영속 저장할 방법은 없습니다.
