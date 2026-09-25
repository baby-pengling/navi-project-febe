# Navi 온보딩/연동 설정 체크리스트

코드 수정만으로 해결할 수 없는 Supabase와 Google Cloud 설정입니다.

## 1. Supabase 마이그레이션 적용

다음 순서로 마이그레이션을 적용합니다.

```bash
supabase db push
```

이번 변경에는 이메일 가입 직후 `public.users`, `public.auth_status`,
`public.notification_settings`를 생성하는 `auth.users` 트리거가 포함되어 있습니다.
Google 연결 전에도 이메일/비밀번호 사용자 프로필이 존재하도록 `google_email`과
`google_subject`는 nullable로 변경됩니다.

## 2. Supabase Auth 이메일 설정

- Authentication → Providers → Email을 활성화합니다.
- 개발 환경에서 이메일 인증 없이 바로 테스트하려면 Confirm email을 끕니다.
- 이메일 인증을 유지하려면 SMTP를 설정하고 아래 Redirect URL을 허용 목록에 추가합니다.

```text
navi://auth-callback
```

현재 프로젝트는 이메일 발송 제한(`over_email_send_rate_limit`) 상태도 확인되었습니다.
반복 테스트 전에는 제한이 풀릴 때까지 기다리거나 SMTP/이메일 발송 한도를 확인해야 합니다.

## 3. Supabase Google provider 설정

Authentication → Providers → Google에서 다음을 설정합니다.

이메일 계정에 Google 계정을 연결하는 현재 앱 흐름은 Supabase의 manual linking 기능을
사용하므로, Authentication → Sign In / Providers의 User Signups에서
`Allow manual linking`도 켜야 합니다.

- Google Client ID
- Google Client Secret
- Gmail API와 Google Calendar API 활성화
- Supabase callback URL을 Google Cloud OAuth Client의 Authorized redirect URI에 등록

Supabase callback URL 형식:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

앱의 최종 callback은 다음과 같습니다.

```text
navi://auth-callback
```

Google 동의 화면에는 최소한 다음 read-only scope가 필요합니다.

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
```

## 4. 실제 검증 순서

1. 새 이메일로 회원가입
2. 이메일 인증 링크 클릭 또는 Confirm email 비활성 환경에서 바로 로그인
3. 관심사 입력 후 다음 단계 이동
4. Gmail 또는 Google Calendar 연결
5. 두 서비스 상태가 표시되는지 확인
6. 온보딩 완료 후 앱을 재실행
7. Dashboard로 복귀하고 `public.users`와 `public.auth_status`에 레코드가 생성됐는지 확인

앱 코드에는 인증 제한/미인증/Google provider 비활성 오류를 구분해 안내하고,
인증 메일 재전송 버튼을 제공하도록 반영되어 있습니다.
