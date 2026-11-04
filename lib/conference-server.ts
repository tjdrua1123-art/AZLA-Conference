import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
export const sharedConfigured = () =>
  !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export function accessConfigured() {
  return (process.env.WORKSPACE_ACCESS_KEY?.length ?? 0) >= 32;
}
export function sessionToken() {
  return createHash("sha256")
    .update("azla-workspace-v2:" + process.env.WORKSPACE_ACCESS_KEY)
    .digest("hex");
}
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function serviceDB() {
  if (!sharedConfigured()) throw new Error("SHARED_NOT_CONFIGURED");
  return createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function workspaceAccess() {
  if (!sharedConfigured()) throw new Error("SHARED_NOT_CONFIGURED");
  if (!accessConfigured()) throw new Error("ACCESS_NOT_CONFIGURED");
  const token = (await cookies()).get("azla-workspace")?.value;
  if (!token || !equalSecret(token, sessionToken()))
    throw new Error("SHARED_ACCESS_REQUIRED");
  return serviceDB();
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(req.url).origin;
  return origin === expected;
}
export function apiFailure(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  const status =
    code === "SHARED_ACCESS_REQUIRED"
      ? 403
      : code === "ACCESS_NOT_CONFIGURED" || code === "SHARED_NOT_CONFIGURED"
        ? 503
        : 400;
  const error =
    code === "SHARED_ACCESS_REQUIRED"
      ? "팀 공유 링크로 이 워크스페이스를 열어 주세요."
      : code === "ACCESS_NOT_CONFIGURED"
        ? "서버에 32자 이상의 WORKSPACE_ACCESS_KEY를 설정해 주세요."
        : code === "SHARED_NOT_CONFIGURED"
          ? "Supabase 공유 저장소가 설정되지 않았습니다."
          : "처리에 실패했습니다. 입력값과 Supabase 설정을 확인해 주세요.";
  return Response.json({ error }, { status });
}
