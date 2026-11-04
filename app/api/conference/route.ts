import { boardSchema } from "@/lib/conference";
import {
  apiFailure,
  sameOrigin,
  workspaceAccess,
} from "@/lib/conference-server";
export async function GET(req: Request) {
  try {
    const db = await workspaceAccess();
    if (new URL(req.url).searchParams.get("history") === "1") {
      const { data, error } = await db
        .from("conference_history")
        .select("version,data,created_at")
        .order("version", { ascending: false })
        .limit(50);
      if (error) throw error;
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }
    const { data, error } = await db
      .from("conference_workspace")
      .select("version,data")
      .eq("id", "azla")
      .single();
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiFailure(e);
  }
}
export async function PUT(req: Request) {
  try {
    if (!sameOrigin(req))
      return Response.json(
        { error: "허용되지 않은 요청입니다." },
        { status: 403 },
      );
    const db = await workspaceAccess();
    if (Number(req.headers.get("content-length")) > 3 * 1024 * 1024)
      throw new Error("Invalid");
    const raw = await req.text();
    if (raw.length > 2 * 1024 * 1024) throw new Error("Invalid");
    const body = JSON.parse(raw);
    const data = boardSchema.parse(body.data);
    if (!Number.isSafeInteger(body.version) || body.version < 0)
      throw new Error("Invalid");
    const r = await db.rpc("save_conference", {
      p_version: body.version,
      p_data: data,
    });
    if (r.error?.message.includes("VERSION_CONFLICT"))
      return Response.json(
        {
          error:
            "다른 직원이 먼저 저장했습니다. 현재 내용을 백업한 뒤 최신 자료를 불러와 주세요.",
        },
        { status: 409 },
      );
    if (r.error) throw r.error;
    return Response.json({ version: r.data, data });
  } catch (e) {
    return apiFailure(e);
  }
}
