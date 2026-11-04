import { cookies } from "next/headers";
import {
  accessConfigured,
  apiFailure,
  equalSecret,
  sameOrigin,
  sessionToken,
  sharedConfigured,
  workspaceAccess,
} from "@/lib/conference-server";
export async function GET() {
  if (!sharedConfigured())
    return Response.json(
      { mode: "local", accessible: true, ai: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    await workspaceAccess();
    return Response.json(
      { mode: "shared", accessible: true, ai: !!process.env.OPENAI_API_KEY },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { mode: "shared", accessible: false, ai: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req))
      return Response.json(
        { error: "허용되지 않은 요청입니다." },
        { status: 403 },
      );
    if (!accessConfigured()) throw new Error("ACCESS_NOT_CONFIGURED");
    if (Number(req.headers.get("content-length")) > 2000)
      throw new Error("Invalid");
    const { key } = await req.json();
    if (
      typeof key !== "string" ||
      key.length > 512 ||
      !equalSecret(key, process.env.WORKSPACE_ACCESS_KEY!)
    )
      return Response.json(
        { error: "공유 링크가 올바르지 않거나 변경되었습니다." },
        { status: 403 },
      );
    (await cookies()).set("azla-workspace", sessionToken(), {
      httpOnly: true,
      secure: new URL(req.url).protocol === "https:",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return apiFailure(e);
  }
}
