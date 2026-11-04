import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorized } from "@/lib/supabase-server";
import { z } from "zod";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    email: z.email(),
    name: z.string().min(1).max(100),
    role: z.enum(["admin", "editor", "viewer"]),
  }),
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    role: z.enum(["admin", "editor", "viewer"]),
    active: z.boolean(),
  }),
]);
export async function POST(req: NextRequest) {
  try {
    const { db: sessionDB, profile, user } = await authorized();
    if (profile.role !== "admin")
      return NextResponse.json(
        { error: "관리자만 사용할 수 있습니다." },
        { status: 403 },
      );
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return NextResponse.json(
        { error: "서버 관리자 키를 설정해 주세요." },
        { status: 503 },
      );
    const body = input.parse(await req.json());
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (body.action === "invite") {
      const url = process.env.APP_URL;
      if (!url) throw new Error("Missing APP_URL");
      const { data, error } = await db.auth.admin.inviteUserByEmail(
        body.email,
        { redirectTo: url },
      );
      if (error || !data.user) throw error;
      const saved = await db
        .from("profiles")
        .insert({ id: data.user.id, name: body.name, role: body.role });
      if (saved.error) {
        await db.auth.admin.deleteUser(data.user.id);
        throw saved.error;
      }
    } else {
      if (body.id === user.id)
        return NextResponse.json(
          {
            error: "본인의 권한과 활성 상태는 이 화면에서 변경할 수 없습니다.",
          },
          { status: 400 },
        );
      const { error } = await sessionDB.rpc("manage_employee", {
        p_id: body.id,
        p_role: body.role,
        p_active: body.active,
      });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.message === "UNAUTHORIZED"
            ? "로그인이 필요합니다."
            : "직원 관리에 실패했습니다. 관리자 권한, 이메일 및 서버 설정을 확인해 주세요.",
      },
      { status: 400 },
    );
  }
}
