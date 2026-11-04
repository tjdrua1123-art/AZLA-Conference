import { z } from "zod";
import { fileMimes } from "@/lib/conference";
import {
  apiFailure,
  sameOrigin,
  workspaceAccess,
} from "@/lib/conference-server";
const info = z.object({
  name: z.string().min(1).max(500),
  mime: z.string().refine((s) => fileMimes.includes(s)),
  size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
});
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req))
      return Response.json(
        { error: "허용되지 않은 요청입니다." },
        { status: 403 },
      );
    const db = await workspaceAccess();
    const b = info.parse(await req.json());
    const ext: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "audio/webm": "webm",
      "video/webm": "webm",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/ogg": "ogg",
    };
    const path = `azla/${crypto.randomUUID()}.${ext[b.mime]}`;
    const { data, error } = await db.storage
      .from("conference-files")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return Response.json({ path, url: data.signedUrl });
  } catch (e) {
    return apiFailure(e);
  }
}
export async function GET(req: Request) {
  try {
    const db = await workspaceAccess();
    const path = new URL(req.url).searchParams.get("path") || "";
    if (!/^azla\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(path))
      throw new Error("Invalid");
    const { data, error } = await db.storage
      .from("conference-files")
      .createSignedUrl(path, 60);
    if (error) throw error;
    return Response.json(
      { url: data.signedUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
