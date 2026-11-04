import { NextRequest, NextResponse } from "next/server";
import { serverDB } from "@/lib/supabase-server";
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type");
  if (token && type === "invite") {
    const db = await serverDB();
    const { error } = await db.auth.verifyOtp({
      token_hash: token,
      type: "invite",
    });
    if (!error) return NextResponse.redirect(new URL("/?welcome=1", req.url));
  }
  return NextResponse.redirect(new URL("/login?error=invite", req.url));
}
