import { LocalizedError, message, type DisplayText } from '../i18n';
import { packedAsset, unpackAsset, type AssetProgress, type PartProgress } from './assetPacks';

export function assetLoadMessage(name: DisplayText, loaded: number, total: number, parts?: PartProgress) {
  if (!parts) return message("加载 {0} · {1} / {2} MB", name, (loaded / 1e6).toFixed(1), (total / 1e6).toFixed(1));
  if (parts.fetched === 0)
    return message("从本地缓存还原 {0} · {1} / {2} 块", name, parts.cached, parts.total);
  if (parts.cached === 0)
    return message("获取 {0} · {1} / {2} 块", name, parts.fetched, parts.total);
  return message("加载 {0} · {1} / {2} 块（本地缓存 {3} 块，获取 {4} 块）", name, parts.cached + parts.fetched, parts.total, parts.cached, parts.fetched);
}

// Content-Length describes the wire representation. With transparent compression
// (or an unknown length), let the browser collect the decoded bytes.
export async function downloadBytes(
  url: string,
  onProgress?: AssetProgress,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const packed = packedAsset(url);
  if (packed) {
    try { return await unpackAsset(packed, onProgress, signal); }
    catch { signal?.throwIfAborted(); } // Old tabs and unavailable packs can still use R2.
  }
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new LocalizedError("加载资源失败 ({0}): {1}", response.status, new URL(url, location.href).pathname);
  const size = Number(response.headers.get('content-length'));
  if (
    !response.body ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    response.headers.has('content-encoding') ||
    new URL(url, location.href).origin !== location.origin
  ) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.length, bytes.length);
    return bytes;
  }

  const bytes = new Uint8Array(size);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, offset);
      offset += value.length;
      onProgress?.(offset, size);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== size) throw new LocalizedError("资源下载不完整，请重试。");
  return bytes;
}
