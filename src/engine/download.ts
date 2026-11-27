// Content-Length describes the wire representation. With transparent compression
// (or an unknown length), let the browser collect the decoded bytes.
export async function downloadBytes(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      `加载资源失败 (${response.status}): ${new URL(url, location.href).pathname}`,
    );
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
  if (offset !== size) throw new Error('资源下载不完整，请重试。');
  return bytes;
}
