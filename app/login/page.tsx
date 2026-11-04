"use client";
import { useState } from "react";
import { browserDB, configured } from "@/lib/supabase-browser";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand">
          AZLA<span>WORKSPACE</span>
        </div>
        <p className="eyebrow">WEEKLY CONFERENCE</p>
        <h1>
          기록에서 시작하는
          <br />더 나은 다음.
        </h1>
        <p className="muted">초대받은 AZLA 직원 계정으로 로그인해 주세요.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const { error } = await browserDB().auth.signInWithPassword({
                email,
                password,
              });
              if (error) throw error;
              window.location.assign("/");
            } catch {
              setMessage(
                "로그인에 실패했습니다. 계정 정보와 환경 설정을 확인해 주세요.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            이메일
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || !configured()}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
        {message && <p role="alert">{message}</p>}
        {!configured() && (
          <p className="notice">
            Supabase 환경 설정이 필요합니다. <a href="/">프로그램 미리보기</a>
          </p>
        )}
        <small>
          외부 회원가입은 제공하지 않습니다. 계정은 관리자에게 요청하세요.
        </small>
      </div>
    </main>
  );
}
