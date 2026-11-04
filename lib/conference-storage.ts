import { mergeBoards } from "./conference-merge";
import {
  boardSchema,
  emptyBoard,
  type Board,
  type Snapshot,
  type StoredBoard,
  type Visual,
} from "./conference";
export type StorageMode = "local" | "shared";
export class SaveConflict extends Error {}
const DB = "azla-conference-v2";
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("state");
      r.result.createObjectStore("files");
      r.result.createObjectStore("history", { keyPath: "version" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        new Error(
          "브라우저 저장소를 열 수 없습니다. 개인정보 보호 모드와 저장 공간을 확인해 주세요.",
        ),
      );
  });
}
async function read<T>(
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const value = await r.json();
  if (!r.ok)
    throw r.status === 409
      ? new SaveConflict(value.error)
      : new Error(value.error || "요청을 처리하지 못했습니다.");
  return value;
}
export async function mode(): Promise<{
  mode: StorageMode;
  accessible: boolean;
  ai: boolean;
}> {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const key = fragment.get("access");
  if (key) {
    history.replaceState(null, "", location.pathname + location.search);
    await api("/api/conference/access", {
      method: "POST",
      body: JSON.stringify({ key }),
    });
  }
  return api("/api/conference/access");
}
export async function loadBoard(mode: StorageMode): Promise<StoredBoard> {
  const stored =
    mode === "shared"
      ? await api<StoredBoard>("/api/conference")
      : ((await read<StoredBoard>("state", "board")) ?? {
          version: 0,
          data: emptyBoard(),
        });
  return { ...stored, data: boardSchema.parse(stored.data) };
}
// Persist completed segments before upload so interrupted uploads can be retried.
export async function cacheRecording(key: string, file: Blob) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, "recovery:" + key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function recordingRecovery(key: string) {
  return read<Blob>("files", "recovery:" + key);
}
export async function clearRecordingRecovery(key: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete("recovery:" + key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function saveBoard(
  mode: StorageMode,
  current: StoredBoard,
): Promise<StoredBoard> {
  const data = boardSchema.parse(current.data);
  if (mode === "shared")
    return api("/api/conference", {
      method: "PUT",
      body: JSON.stringify({ version: current.version, data }),
    });
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["state", "history"], "readwrite");
      const store = tx.objectStore("state");
      const req = store.get("board");
      let saved: StoredBoard;
      req.onsuccess = () => {
        const old = req.result as StoredBoard | undefined;
        if ((old?.version ?? 0) !== current.version) {
          tx.abort();
          return;
        }
        saved = { version: current.version + 1, data };
        store.put(saved, "board");
        tx.objectStore("history").put({
          version: saved.version,
          data,
          created_at: new Date().toISOString(),
        });
      };
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () =>
        reject(new SaveConflict("다른 탭에서 먼저 저장했습니다."));
      tx.onerror = () =>
        reject(
          new Error(
            "저장 공간이 부족하거나 저장에 실패했습니다. 백업 파일을 내보내 주세요.",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export async function saveFile(
  mode: StorageMode,
  id: string,
  file: Blob,
  name: string,
): Promise<string> {
  if (mode === "shared") {
    const signed = await api<{ path: string; url: string }>(
      "/api/conference/files",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          mime: file.type.split(";")[0],
          size: file.size,
        }),
      },
    );
    const r = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": file.type.split(";")[0], "x-upsert": "false" },
      body: file,
    });
    if (!r.ok) throw new Error("파일을 Supabase에 업로드하지 못했습니다.");
    return signed.path;
  }
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            "파일 저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.",
          ),
        );
    });
    return id;
  } finally {
    db.close();
  }
}
export async function fileBlob(
  mode: StorageMode,
  file: Pick<Visual, "path">,
): Promise<Blob> {
  if (mode === "local") {
    const blob = await read<Blob>("files", file.path);
    if (!blob)
      throw new Error(
        "파일을 찾을 수 없습니다. 이미지가 포함된 백업에서 복원해 주세요.",
      );
    return blob;
  }
  const { url } = await api<{ url: string }>(
    `/api/conference/files?path=${encodeURIComponent(file.path)}`,
  );
  const r = await fetch(url);
  if (!r.ok) throw new Error("파일을 열 수 없습니다.");
  return r.blob();
}
export async function revisions(mode: StorageMode): Promise<Snapshot[]> {
  if (mode === "shared") return api("/api/conference?history=1");
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("history").objectStore("history").getAll();
      r.onsuccess = () =>
        resolve(
          (r.result as Snapshot[])
            .sort((a, b) => b.version - a.version)
            .slice(0, 50),
        );
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function saveWithMerge(
  mode: StorageMode,
  current: StoredBoard,
  baseline: Board,
): Promise<StoredBoard> {
  let proposed = current;
  let base = baseline;
  for (let i = 0; i < 3; i++) {
    try {
      return await saveBoard(mode, proposed);
    } catch (e) {
      if (!(e instanceof SaveConflict)) throw e;
      const remote = await loadBoard(mode);
      proposed = {
        version: remote.version,
        data: mergeBoards(base, proposed.data, remote.data),
      };
      base = remote.data;
    }
  }
  throw new Error(
    "동시에 저장하는 요청이 많습니다. 현재 내용은 유지됩니다. 다시 저장해 주세요.",
  );
}
export async function findRecordingRecovery(
  recordingId: string,
): Promise<{ key: string; file: Blob }[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const prefix = "recovery:" + recordingId + "/";
      const result: { key: string; file: Blob }[] = [];
      const req = db
        .transaction("files")
        .objectStore("files")
        .openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          result.push({
            key: String(c.key).slice("recovery:".length),
            file: c.value,
          });
          c.continue();
        } else resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
