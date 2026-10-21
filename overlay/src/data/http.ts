// Low-level fetch helpers. All requests are same-origin with the session cookie.

/** The node drops any request over this many bytes. */
export const MAX_REQUEST_BYTES = 100_000;

export class HttpError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url} answered ${status}`);
    this.name = 'HttpError';
  }
}

/** A page or reply did not have the shape the parser expects. Names the page and the missing field. */
export class ParseError extends Error {
  constructor(readonly page: string, readonly field: string) {
    super(`Could not read ${field} from ${page}`);
    this.name = 'ParseError';
  }
}

/** Old node pages are ISO-8859-1: one byte is one character. */
export function decodeLatin1(buf: ArrayBuffer): string {
  return new TextDecoder('iso-8859-1').decode(buf);
}

/**
 * The node's JSON writers leave trailing commas, and an empty node list comes out as
 * `{"nodes":\r\n]}`. Repair both before JSON.parse; strings are skipped so content is untouched.
 */
export function parseLooseJson(text: string): unknown {
  const fixed = text
    .replace(/("(?:[^"\\]|\\.)*")|,(\s*[\]}])/g, (_m, str: string | undefined, close: string | undefined) =>
      str ?? close ?? '')
    .replace(/("(?:[^"\\]|\\.)*")|:(\s*)\]/g, (_m, str: string | undefined, ws: string | undefined) =>
      str ?? `:[${ws ?? ''}]`);
  return JSON.parse(fixed);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw new HttpError(url, res.status);
  return res;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await request(url, {});
  return parseLooseJson(await res.text()) as T;
}

/** GET an old page; the body is decoded as ISO-8859-1. */
export async function getText(url: string): Promise<string> {
  const res = await request(url, {});
  return decodeLatin1(await res.arrayBuffer());
}

/** POST a pre-encoded form body and return the reply decoded as ISO-8859-1. */
export async function postBody(url: string, body: Uint8Array): Promise<string> {
  if (body.length > MAX_REQUEST_BYTES) {
    throw new Error(`Request body is ${body.length} bytes; the node drops anything over ${MAX_REQUEST_BYTES}`);
  }
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body as BodyInit,
  });
  return decodeLatin1(await res.arrayBuffer());
}

/**
 * Percent-encode text the way the node's decoder reads it: uppercase %XX, space as +,
 * one byte per character (ISO-8859-1). Characters above U+00FF have no byte and become '?'.
 */
export function encodeLatin1Form(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ch = text[i] as string;
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (code === 0x20) out += '+';
    else out += '%' + (code > 0xff ? 0x3f : code).toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
