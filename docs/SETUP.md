# 로그인 없는 팀 공동 작성 설정 (v0.4)

직원마다 같은 회의록에 들어와 내용을 작성하는 방식입니다. 별도 계정이나 로그인 화면은 사용하지 않습니다. **팀 공유 링크를 가진 사람이 읽고 수정할 수 있습니다.** 링크를 사내에만 전달하고, 담당자 이름은 본인 인증이 아닌 작성 편의를 위한 표기로 사용합니다.

## 1. Supabase DB와 비공개 Storage

회사 Supabase 프로젝트의 SQL Editor에서 [`supabase/conference-v2.sql`](../supabase/conference-v2.sql)을 **한 번** 실행합니다. 신규 프로젝트에서도 이 파일만 실행하면 됩니다. 직원 Auth/가입 설정은 필요하지 않습니다.

- `conference_workspace`: 현재 회의·안건·컨펌·업무와 저장 버전
- `conference_history`: 전체 저장 스냅샷
- `conference_ai_usage`: 팀 공통 AI 사용량
- `conference-files`: private Storage bucket, 파일당 20MiB

기존 `schema.sql`로 만든 v0.1 테이블과 파일은 삭제하거나 공개하지 않습니다. 새 화면으로 v0.1 데이터가 자동 변환되지는 않습니다. 기존 운영 데이터가 있으면 DB/Storage 백업 후 별도 이관 작업이 필요합니다. 기존 RLS를 `true`로 바꾸거나 버킷을 public으로 바꾸지 마세요. v0.2는 브라우저의 Supabase API 접근을 허용하지 않고 서버만 접근합니다.

## 2. Vercel 환경변수

Vercel 프로젝트 → Settings → Environment Variables에 Production 기준으로 입력합니다.

| 이름                        | 값                                                      |
| --------------------------- | ------------------------------------------------------- |
| `SUPABASE_URL`              | Supabase Project URL (`https://프로젝트ID.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase의 legacy `service_role` 키. 서버 전용.         |
| `WORKSPACE_ACCESS_KEY`      | 임의로 생성한 32자 이상 공유 비밀 키. 서버 전용.        |
| `APP_URL`                   | `https://azlaconference.vercel.app`                     |
| `OPENAI_API_KEY`            | AI를 사용할 때만 회사 OpenAI 프로젝트 키                |

기존 `NEXT_PUBLIC_SUPABASE_URL`도 서버 URL 대체값으로 지원하지만 새 설정에는 `SUPABASE_URL`을 권장합니다. publishable/anon key는 새 화면에서 필요하지 않습니다. 비밀 키에 `NEXT_PUBLIC_`를 붙이지 마세요. 키 값은 Git이나 채팅에 올리지 말고 Vercel의 비밀 환경변수에 직접 입력합니다. Preview 환경은 별도 Supabase/공유 키/해당 preview origin을 사용하세요.

`WORKSPACE_ACCESS_KEY`는 비밀번호 관리자 등에서 임의의 긴 문자열로 생성합니다. 터미널을 사용할 경우 아래 명령은 새 값을 로컬 화면에 출력하므로 다른 사람이 보는 로그에 기록하지 않습니다.

```bash
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

필수 값을 모두 저장한 뒤 **최신 코드가 있는 커밋을 재배포**합니다. `SUPABASE_URL`과 관리자 키가 없으면 로컬 저장 모드로 실행됩니다. 두 값이 있는데 공유 키가 없거나 짧으면 공유 데이터는 열리지 않습니다. 연결 실패를 로컬 데이터로 조용히 대체하지 않습니다.

## 3. 팀 공유 링크 만들기

다음 형태에서 `생성한키`를 `WORKSPACE_ACCESS_KEY` 값으로 교체하고 담당자들에게 사내 채널로 전달합니다. 실제 키를 이 문서나 저장소에 저장하지 마세요.

```text
https://azlaconference.vercel.app/#access=생성한키
```

- 각 직원은 최초 한 번 공유 링크로 들어옵니다. 로그인 절차는 없습니다.
- 앱이 링크의 fragment를 주소창/방문 기록에서 제거하고 동일 사이트 API로 확인한 뒤 HttpOnly·SameSite Strict 쿠키를 설정합니다(7일).
- 공유 키는 서버 요청 URL/리퍼러에 포함되지 않지만 링크 자체와 전달 채널에는 남으므로 외부에 전달하지 않습니다. 직접 입력하는 이름을 권한으로 사용하지 않습니다.
- 쿠키가 만료되거나 다른 브라우저를 쓰면 같은 공유 링크로 다시 열면 됩니다. 키를 바꾸고 재배포하면 기존 링크와 쿠키가 모두 무효화됩니다. 이때 새 링크를 팀에 다시 전달합니다.
- 정상 연결되면 오른쪽 위에 **‘팀 공유 저장소’**가 표시됩니다. ‘이 브라우저에 저장’이면 공동 작성 상태가 아닙니다.

## 4. 회의자료 입력과 진행

공유 링크로 들어온 뒤 여섯 분류 탭에서 ‘안건 등록 / 디자인 등록’으로 내용을 입력합니다. 작성자 이름은 받거나 표시하지 않습니다. 직접 작성한 보고는 자동 요약과 별도로 보관하며, 내용 작성 모드의 표 안에서도 수정할 수 있습니다. 같은 필드가 동시에 변경되면 충돌을 알리고 입력을 유지합니다.

회의 시작은 동의와 마이크 권한을 확인한 뒤 전체 회의를 녹음합니다. 탭 이동으로는 녹음이 끊기지 않으며 회의 종료 시 원본 저장 → 전사 → 요약 취합 → 자동 저장을 수행합니다. 기존 버전의 기타/협력업체 안건은 분류 확인 안내에서 원하는 새 분류로 변경합니다.

## 5. AI / Vercel

AI는 공유 링크 접근권, 저장된 회의와 팀 일일 한도를 확인한 뒤 OpenAI를 호출합니다. API 키가 없으면 녹음·메모는 저장하고 AI 처리 버튼만 사용할 수 없습니다. 선택 모델은 `.env.example` 기본값을 참고하세요. 녹음은 먼저 private Storage에 업로드한 뒤 서버가 내려받아 전사하므로 Vercel 요청 본문에 큰 오디오를 싣지 않습니다.

`vercel.json`은 Next.js와 `.next` 출력을 명시합니다. Root Directory는 저장소 루트, Node는 22 이상(검증은 24), AI 경로 실행 한도는 120초입니다. Supabase 기본 `*.supabase.co` 호스트를 사용하며 커스텀 호스트를 사용하면 CSP를 명시적으로 조정해야 합니다.

## 6. 개발 환경

`/workspace/AZLA-Conference` 체크아웃을 사용합니다. 작업은 이미 격리돼 있으므로 별도 worktree를 만들 필요가 없습니다. `npm ci`, `npm run typecheck`, `npm test`, `npm run build`로 검사하고 `npm run dev`로 시작합니다. 새 인스턴스에서는 프로세스를 다시 시작합니다. 공개 키 없는 로컬 화면도 실제 쓰기·파일·백업 테스트가 가능합니다. 공유 모드의 로컬 개발은 `APP_URL=http://localhost:3000`처럼 실행 origin과 일치시킵니다. 외부 네트워크 접근에는 기존 프록시/CA를 유지하며 필요 시 Node 24 `NODE_USE_ENV_PROXY=1`을 프로세스에 설정합니다.

## v0.3 적용 사항

기존 v0.2 DB를 초기화하거나 SQL을 다시 실행하지 않습니다. 원본 녹음은 `conference-files`에 저장하며, 녹음별 구간 목록·전사·취합 요약과 처리 상태는 기존 `conference_workspace` JSON 및 저장 이력에 보관합니다. 변경된 클라이언트와 서버가 같은 커밋으로 배포되어야 합니다.

자동 요약을 위해서는 기존 공유 설정과 `OPENAI_API_KEY`가 모두 필요합니다. 상단 회의 시작·종료 버튼을 사용하며, 탭 이동으로는 마이크를 종료하지 않습니다. 녹음 원본 저장 후 전사와 요약을 자동으로 처리합니다. 브라우저 모드나 AI 미설정 시에는 원본을 보관하고 연결 필요 상태를 표시합니다.

## v0.4 적용 사항

전주에서 이어 쓰기·삭제/복원은 기존 워크스페이스 JSON의 선택 필드를 사용합니다. 기존 `conference-v2.sql`을 적용한 환경이라면 DB 초기화나 추가 SQL 실행 없이 앱만 업데이트합니다. 업데이트 전 전체 백업을 권장합니다. 파일 원본을 다시 업로드하지 않으며, 예전 저장 데이터도 읽을 수 있습니다.
