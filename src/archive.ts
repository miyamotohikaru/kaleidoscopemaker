// 鑑定書を端末の中（IndexedDB）にしまう。サーバーには送らない。

export interface Cert {
  id: string;
  name: string;
  rankName: string;
  rank: number;
  line: string;
  date: number;
  code: string; // 万華鏡の中身（share.ts の形式）
  card: Blob; // 鑑定書（JPEG）
  thumb: Blob; // 一覧用の小さい版
  thumbW?: number; // 一覧用の幅（古い小さいものは開いたときに作り直す）
}

const DB = 'kaleidoscope-maker';
const STORE = 'certs';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const q = f(t.objectStore(STORE));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function putCert(c: Cert) {
  // 消されにくくしてもらう（Safari は 7 日使わないと消すことがある）
  navigator.storage?.persist?.().catch(() => {});
  await tx('readwrite', (s) => s.put(c));
}

export async function listCerts(): Promise<Cert[]> {
  try {
    const all = await tx<Cert[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

export async function deleteCert(id: string) {
  await tx('readwrite', (s) => s.delete(id));
}

export function toBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.9): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), type, q));
}

// 一覧のカードはスマホで幅 250px ほど（3 倍の画面で 750px）、パソコンで最大 448px（2 倍で 896px）。どちらでもぼやけない幅にする
export const THUMB_W = 900;
export function thumbOf(card: HTMLCanvasElement | ImageBitmap, w = THUMB_W) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((card.height / card.width) * w);
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(card, 0, 0, c.width, c.height);
  return toBlob(c, 'image/jpeg', 0.9);
}

// 前の版でしまった鑑定書は一覧の絵が小さい（360px）。原寸の鑑定書から作り直して置き換える
export async function upgradeThumbs(list: Cert[]) {
  for (const c of list) {
    if ((c.thumbW ?? 0) >= THUMB_W) continue;
    try {
      const bmp = await createImageBitmap(c.card);
      c.thumb = await thumbOf(bmp);
      c.thumbW = THUMB_W;
      bmp.close();
      await putCert(c);
    } catch {
      // 作り直せなければ前の絵のまま
    }
  }
}

export function fmtDate(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
