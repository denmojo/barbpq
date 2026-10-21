import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fixtures are raw node output: ISO-8859-1 bytes, read back one byte per character. */
export function fixture(name: string): string {
  return readFileSync(join(__dirname, '..', '__fixtures__', name)).toString('latin1');
}

export function bytesOf(s: string): ArrayBuffer {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b.buffer;
}

/** Stub fetch with a route table; later entries win. Records every call. */
export function stubFetch(routes: Record<string, string | ((init?: RequestInit) => string)>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = routes[url];
    if (hit === undefined) return new Response('nope', { status: 404 });
    const text = typeof hit === 'function' ? hit(init) : hit;
    return new Response(bytesOf(text), { status: 200 });
  });
  return calls;
}
