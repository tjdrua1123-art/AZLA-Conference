# Supabase Pro 연결 및 배포 준비

## 1. Supabase

사용자 승인 후 회사 소유 Supabase 프로젝트를 준비합니다. 사내 데이터 보관 지역과 비용을 먼저 결정하세요. 새 프로젝트의 SQL Editor에서 `supabase/schema.sql`을 **한 번** 실행합니다. 실행은 트랜잭션이므로 실패하면 원인을 해결하고 다시 실행합니다. 기존 DB에 반복 실행하는 마이그레이션 파일이 아닙니다. 운영 스키마 변경은 별도 버전 마이그레이션과 백업을 통해 진행하세요.

테이블: `profiles`, `meetings`, `meeting_revisions`, `tasks`, `task_revisions`, `meeting_tasks`, `attachments`, `ai_usage`. Storage bucket: `meeting-files`(private). 업무는 하나의 ID를 여러 회의에서 공유합니다. 회의 생성 시 그 날짜보다 앞선 회의에 연결된 모든 미완료 업무를 연결하므로 지난주 회의가 없더라도 누락을 줄입니다. 작업 이월 후 상태를 바꾸면 이전 회의도 현재 업무 상태를 표시하며 과거 상태는 `task_revisions`에 남습니다.

## 2. 직원 로그인

- Auth → Providers/Sign In 설정에서 **Allow new users to sign up을 끕니다.** UI에 가입 버튼이 없는 것만으로는 충분하지 않습니다.
- Auth → URL Configuration에서 Site URL 및 허용 Redirect URL을 실제 사이트의 origin으로 설정합니다. 로컬 개발은 `http://localhost:3000`도 추가합니다. 운영에 불필요한 광범위 와일드카드는 추가하지 마세요.
- Invite User 이메일 템플릿 링크를 다음과 같이 설정합니다. 앱은 `type=invite`만 처리하며 임의 리다이렉트 경로를 받지 않습니다.

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite"
  >AZLA 초대 수락</a
>
```

- 첫 관리자는 대시보드 Auth → Users에서 회사 이메일과 임시 비밀번호로 생성합니다(또는 Invite로 생성한 뒤 비밀번호 설정). 생성된 **실제 User UUID**로 아래 SQL을 실행합니다. 다음 값은 자리표시자이며 실제 UUID로 교체해야 합니다.

```sql
insert into public.profiles (id, name, role)
values ('실제-Auth-User-UUID', '관리자 이름', 'admin');
```

- 관리자가 로그인하고 직원 관리에서 후속 직원을 초대합니다. 초대는 이메일 전송을 동반하므로 실제 사내 수신 계정에 대해서만 수행하세요. 운영 전 Supabase SMTP와 발신 도메인을 설정하고 전송 제한/스팸함을 확인합니다.
- 초대 메일 → `/auth/confirm` → 홈 화면 비밀번호 설정 순서입니다. 초대 토큰이 로그나 외부 분석 서비스에 남지 않도록 합니다. 공유 PC에서는 사용 후 로그아웃합니다. 비밀번호 재설정 UI는 현재 제공하지 않으므로 관리자 Auth 관리 절차를 마련하세요.

## 3. 환경변수

| 이름                                   | 설정 위치 / 용도                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase Project URL. 브라우저에 공개됩니다.                                                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key(또는 프로젝트의 legacy anon key). 공개를 전제로 설계된 식별 키이며 RLS로 데이터를 보호합니다. |
| `SUPABASE_SERVICE_ROLE_KEY`            | **서버 전용** legacy service-role key. 직원 초대 및 AI 사용 결과 기록만을 위해 사용합니다. RLS를 우회하므로 노출 금지. |
| `OPENAI_API_KEY`                       | **서버 전용** 회사 OpenAI 프로젝트 API 키.                                                                             |
| `OPENAI_SUMMARY_MODEL`                 | 기본 `gpt-4o-mini`. Structured Outputs 지원 모델이어야 합니다.                                                         |
| `OPENAI_TRANSCRIPTION_MODEL`           | 기본 `gpt-4o-mini-transcribe`.                                                                                         |
| `APP_URL`                              | 사이트 origin. 로컬 `http://localhost:3000`, 운영 `https://회사도메인`.                                                |

클라이언트가 접속하려면 Supabase URL과 publishable key만 공개되어야 합니다. OpenAI/서비스 역할 키에 `NEXT_PUBLIC_`를 절대 붙이지 마세요. 로컬 키는 무시되는 `.env.local`, 배포 키는 Vercel 프로젝트 환경변수에만 저장합니다. 환경변수 변경 후 다시 빌드/배포해야 클라이언트 값이 반영됩니다. 설정이 하나만 입력된 경우도 샘플 화면이므로, 운영 시 샘플 표시 여부를 반드시 점검하세요.

## 4. Vercel (승인 후 사용자가 배포)

- 저장소의 `vercel.json`이 프레임워크를 `nextjs`, 출력 폴더를 `.next`로 명시합니다. 기존 프로젝트가 일반 정적 사이트로 인식되어 `public` 폴더를 찾는 오류를 방지하기 위한 설정입니다. 이 파일이 추가된 **최신 커밋의 배포**를 확인하세요. 이전 커밋을 Redeploy하면 새 파일이 포함되지 않습니다.

- GitHub 저장소를 Import하고 Framework를 Next.js로 선택합니다. Root Directory는 프로젝트 루트입니다.
- Node.js 24(또는 22 이상), Install `npm ci`, Build `npm run build`, Output은 Next.js 기본값을 사용합니다.
- Production 환경변수와 Supabase Site URL/redirect를 일치시킵니다. Preview 배포에는 운영 데이터 접근 키를 공유하지 않고 별도 테스트 Supabase 프로젝트를 권장합니다.
- 서버 AI 경로는 `maxDuration=120`입니다. 선택 플랜의 실행 시간 한도가 충분한지 확인합니다. 녹음은 브라우저에서 Storage로 직접 업로드하고 서버에는 attachment ID만 전달하므로 Vercel 요청 본문에 큰 파일을 싣지 않습니다.
- 공개 배포 전 Auth 가입 차단, RLS, private bucket과 API 접근 검사를 완료하세요. Supabase 기본 `*.supabase.co` 도메인이 CSP에 허용되어 있습니다. 커스텀 Supabase 도메인을 쓰면 `next.config.ts` CSP에 해당 origin을 명시적으로 추가해야 합니다.

## 5. 클라우드 개발 환경

기존 `/workspace/AZLA-Conference` 체크아웃을 그대로 사용하며 새 worktree는 필요하지 않습니다. 새 인스턴스에서는 `npm ci`, 환경변수 설정 후 `npm run dev`로 시작합니다. 이전 인스턴스 프로세스가 유지된다고 가정하지 마세요. 설치 대상 네트워크는 npm registry, 실제 서비스 사용에는 해당 Supabase 프로젝트 호스트와 `api.openai.com`이 필요합니다. 클라우드에서 접근 차단이 확인되면 환경 설정에 그 호스트만 추가합니다. TLS나 검증을 해제하지 않습니다.
