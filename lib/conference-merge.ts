import { boardSchema, type Board } from "./conference";
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (record(a) && record(b)) {
    const x = Object.keys(a)
        .filter((k) => a[k] !== undefined)
        .sort(),
      y = Object.keys(b)
        .filter((k) => b[k] !== undefined)
        .sort();
    return (
      x.length === y.length &&
      x.every((k, i) => k === y[i] && equal(a[k], b[k]))
    );
  }
  return false;
}
export class MergeConflict extends Error {
  constructor(public field: string) {
    super(
      `같은 항목이 다른 곳에서도 수정되었습니다 (${field}). 현재 내용을 백업한 뒤 최신 회의를 불러와 비교해 주세요.`,
    );
  }
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function identified(v: unknown[]): v is { id: string }[] {
  return v.every((x) => record(x) && typeof x.id === "string");
}
function merge(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
): unknown {
  if (equal(local, remote) || equal(remote, base)) return local;
  if (equal(local, base)) return remote;
  if (record(base) && record(local) && record(remote)) {
    if (
      typeof base.report === "string" &&
      Array.isArray(base.visuals) &&
      local.deletedAt !== remote.deletedAt &&
      (local.deletedAt !== base.deletedAt ||
        remote.deletedAt !== base.deletedAt)
    )
      throw new MergeConflict(path + " · 삭제/복원과 내용 수정");
    const out: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]))
      out[key] = merge(base[key], local[key], remote[key], `${path}.${key}`);
    return out;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if (identified(base) && identified(local) && identified(remote)) {
      const b = new Map(base.map((x) => [x.id, x])),
        l = new Map(local.map((x) => [x.id, x])),
        r = new Map(remote.map((x) => [x.id, x]));
      const ids = [
        ...new Set([...local.map((x) => x.id), ...remote.map((x) => x.id)]),
      ];
      return ids
        .map((id) => merge(b.get(id), l.get(id), r.get(id), `${path}[${id}]`))
        .filter((x) => x !== undefined);
    }
    if (
      path.endsWith(".meetingIds") &&
      [...base, ...local, ...remote].every((x) => typeof x === "string")
    )
      return [...new Set([...local, ...remote])];
  }
  throw new MergeConflict(path);
}
export function mergeBoards(base: Board, local: Board, remote: Board): Board {
  return boardSchema.parse(merge(base, local, remote, "회의록"));
}
