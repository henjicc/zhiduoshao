import type { MapMeta, MapRecord } from "./snapshot.ts";

// 历史记录存在本机 IndexedDB：地图带来源摘要，体积会超出 localStorage 的约 5MB 上限。
// meta 只放列表需要的字段，打开首页时不必读出整张地图。

const DB = "zds-history";
const META = "meta";
const MAPS = "maps";

let opening: Promise<IDBDatabase> | null = null;

function db() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: "id" });
      req.result.createObjectStore(MAPS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listMeta(): Promise<MapMeta[]> {
  const tx = (await db()).transaction(META, "readonly");
  const all = await result(tx.objectStore(META).getAll() as IDBRequest<MapMeta[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMap(id: string): Promise<MapRecord | undefined> {
  const tx = (await db()).transaction(MAPS, "readonly");
  return result(tx.objectStore(MAPS).get(id) as IDBRequest<MapRecord | undefined>);
}

export async function putMap(record: MapRecord, meta: MapMeta) {
  const tx = (await db()).transaction([META, MAPS], "readwrite");
  tx.objectStore(MAPS).put(record);
  tx.objectStore(META).put(meta);
  await done(tx);
}

export async function deleteMap(id: string) {
  const tx = (await db()).transaction([META, MAPS], "readwrite");
  tx.objectStore(MAPS).delete(id);
  tx.objectStore(META).delete(id);
  await done(tx);
}
