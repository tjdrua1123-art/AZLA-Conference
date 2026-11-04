import JSZip from "jszip";
import {
  boardSchema,
  meetingFiles,
  newAgenda,
  type Agenda,
  type Board,
  type Visual,
} from "./conference";
import { fileBlob, saveFile, type StorageMode } from "./conference-storage";
export type ImportedSlide = {
  number: number;
  agenda: Agenda;
  files: { visual: Visual; blob: Blob }[];
};
const ns = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};
function nodes(e: Document | Element, namespace: string, name: string) {
  return Array.from(e.getElementsByTagNameNS(namespace, name));
}
function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("지원하지 않는 XML 형식입니다.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("PPT XML을 읽을 수 없습니다.");
  return doc;
}
function paragraphs(e: Document | Element) {
  return nodes(e, ns.a, "p")
    .map((p) =>
      nodes(p, ns.a, "t")
        .map((t) => t.textContent || "")
        .join(""),
    )
    .filter((s) => s.trim())
    .join("\n");
}
async function safeZip(file: Blob) {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("가져올 파일은 100MB 이하여야 합니다.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    total += size;
    if (total > 200 * 1024 * 1024 || size > 40 * 1024 * 1024)
      throw new Error(
        "압축 해제된 자료가 너무 큽니다. 파일을 나누어 가져와 주세요.",
      );
  }
  if (Object.keys(zip.files).length > 5000)
    throw new Error("파일 개수가 너무 많습니다.");
  return zip;
}
function resolveTarget(base: string, target: string) {
  const path = target.startsWith("/") ? target.slice(1) : base + target;
  const parts: string[] = [];
  for (const p of path.split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}
export async function readPresentation(file: File): Promise<ImportedSlide[]> {
  const zip = await safeZip(file);
  const pres = zip.file("ppt/presentation.xml");
  const rels = zip.file("ppt/_rels/presentation.xml.rels");
  if (!pres || !rels) throw new Error("PowerPoint .pptx 파일을 선택해 주세요.");
  const relDoc = xml(await rels.async("string"));
  const map = new Map(
    Array.from(relDoc.getElementsByTagName("Relationship"))
      .filter((n) => n.getAttribute("TargetMode") !== "External")
      .map((n) => [
        n.getAttribute("Id"),
        resolveTarget("ppt/", n.getAttribute("Target") || ""),
      ]),
  );
  const order = nodes(xml(await pres.async("string")), ns.p, "sldId")
    .map((n) => map.get(n.getAttributeNS(ns.r, "id")))
    .filter((s): s is string => !!s);
  if (order.length > 150)
    throw new Error("PPT는 150장 이하로 나누어 가져와 주세요.");
  const slides: ImportedSlide[] = [];
  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    const entry = zip.file(path);
    if (!entry) continue;
    const doc = xml(await entry.async("string"));
    const all = paragraphs(doc);
    const numbered = all.split("\n").find((s) => /^\d+[.\)]\s/.test(s));
    const first = all
      .split("\n")
      .find(
        (s) =>
          s.trim() &&
          !/작성일자|회의록|회 의 록|업\s*무\s*보\s*고|업\s*무\s*계\s*획/.test(
            s,
          ),
      );
    const agenda = newAgenda(
      (numbered || first || `슬라이드 ${i + 1}`).slice(0, 150),
    );
    agenda.source = `${file.name} · ${i + 1}페이지`;
    agenda.report = all.slice(0, 60000);
    for (const table of nodes(doc, ns.a, "tbl")) {
      const rows = nodes(table, ns.a, "tr");
      const header = rows[0]
        ? nodes(rows[0], ns.a, "tc").map((c) =>
            paragraphs(c).replace(/\s/g, ""),
          )
        : [];
      if (header[0] === "업무보고" && header[1] === "업무계획") {
        const body = rows
          .slice(1)
          .map((r) => nodes(r, ns.a, "tc").map(paragraphs));
        agenda.report = body.map((r) => r[0] || "").join("\n");
        agenda.plan = body.map((r) => r[1] || "").join("\n");
        agenda.title = (agenda.report.split("\n")[0] || agenda.title).slice(
          0,
          150,
        );
      }
    }
    agenda.category = /Pending Project/i.test(all)
      ? "pending"
      : /중국 협력업체/.test(all)
        ? "partner"
        : /양산품 Update/.test(all)
          ? "production"
          : "development";
    const relationshipPath = path.replace(/([^/]+)$/, "_rels/$1.rels");
    const relationFile = zip.file(relationshipPath);
    const images: { visual: Visual; blob: Blob }[] = [];
    if (relationFile) {
      const relationships = xml(await relationFile.async("string"));
      const imageMap = new Map(
        Array.from(relationships.getElementsByTagName("Relationship"))
          .filter(
            (r) =>
              r.getAttribute("TargetMode") !== "External" &&
              r.getAttribute("Type")?.endsWith("/image"),
          )
          .map((r) => [
            r.getAttribute("Id"),
            resolveTarget(
              path.slice(0, path.lastIndexOf("/") + 1),
              r.getAttribute("Target") || "",
            ),
          ]),
      );
      const used = new Set<string>();
      for (const pic of nodes(doc, ns.p, "pic")) {
        const ref = nodes(pic, ns.a, "blip")[0]?.getAttributeNS(ns.r, "embed");
        const target = ref ? imageMap.get(ref) : undefined;
        if (!target || used.has(target)) continue;
        used.add(target);
        const e = zip.file(target);
        if (!e) continue;
        const ext = target.split(".").pop()?.toLowerCase();
        const mime =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "webp"
                ? "image/webp"
                : null;
        if (!mime) continue;
        const blob = new Blob([await e.async("arraybuffer")], { type: mime });
        if (blob.size > 20 * 1024 * 1024)
          throw new Error(`${i + 1}페이지 이미지가 20MB를 초과합니다.`);
        const v: Visual = {
          id: crypto.randomUUID(),
          path: "",
          name: `슬라이드${i + 1}-${target.split("/").pop()}`,
          mime,
          size: blob.size,
          label: `시안 ${images.length + 1}`,
          status: "pending",
          comment: "",
          reviewer: "",
          reviewedAt: "",
          history: [],
        };
        images.push({ visual: v, blob });
      }
    }
    agenda.visuals = images.map((f) => f.visual);
    slides.push({ number: i + 1, agenda, files: images });
  }
  return slides;
}
export async function materializeSlides(
  mode: StorageMode,
  slides: ImportedSlide[],
): Promise<Agenda[]> {
  const result: Agenda[] = [];
  for (const s of slides) {
    const visuals: Visual[] = [];
    for (const f of s.files) {
      const path = await saveFile(mode, f.visual.id, f.blob, f.visual.name);
      visuals.push({ ...f.visual, path });
    }
    result.push({ ...s.agenda, visuals });
  }
  return result;
}
export async function exportBackup(mode: StorageMode, data: Board) {
  const zip = new JSZip();
  zip.file("conference.json", JSON.stringify(data, null, 2));
  const seen = new Set<string>();
  for (const m of data.meetings)
    for (const v of meetingFiles(m)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      zip.file(`files/${v.id}`, await (await fileBlob(mode, v)).arrayBuffer());
    }
  return zip.generateAsync({ type: "blob" });
}
export async function restoreBackup(
  mode: StorageMode,
  file: File,
): Promise<Board> {
  const zip = await safeZip(file);
  const manifest = zip.file("conference.json");
  if (!manifest) throw new Error("AZLA 백업 파일이 아닙니다.");
  const board = boardSchema.parse(JSON.parse(await manifest.async("string")));
  const paths = new Map<string, string>();
  for (const m of board.meetings)
    for (const v of meetingFiles(m)) {
      let path = paths.get(v.id);
      if (!path) {
        const e = zip.file(`files/${v.id}`);
        if (!e) throw new Error(`백업에서 ${v.name} 파일을 찾을 수 없습니다.`);
        const blob = new Blob([await e.async("arraybuffer")], {
          type: v.mime,
        });
        if (blob.size !== v.size)
          throw new Error("백업 파일 크기가 원본 정보와 다릅니다.");
        path = await saveFile(mode, v.id, blob, v.name);
        paths.set(v.id, path);
      }
      v.path = path;
    }
  return board;
}

export function presentationDate(slides: ImportedSlide[]): string | undefined {
  for (const slide of slides) {
    const match = slide.agenda.report.match(
      /(20\d{2})[.\/\s-]+(\d{1,2})[.\/\s-]+(\d{1,2})/,
    );
    if (match) {
      const result = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      const date = new Date(result + "T12:00:00Z");
      if (
        !Number.isNaN(date.valueOf()) &&
        date.toISOString().startsWith(result)
      )
        return result;
    }
  }
}
