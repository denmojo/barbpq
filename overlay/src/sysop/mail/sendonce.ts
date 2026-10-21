// A mail request that changes the node (kill, delete, a forwarding step, Start Forwarding) is sent
// at most once. withSysop retries a job after a sign-in when the node asked for one; a job whose
// changing post already had a reply of any kind, a sign-in page included, is not run again: the
// retry re-reads the state instead, and the outcome says it was interrupted.
import { postBody } from '../../data/http';
import { assertAuthorized, mailKey, withSysop } from '../../data/session';
import { exclusive } from '../model';

export interface Outcome<T> { value: T; interrupted: boolean }

export type OncePost = (path: string, body: Uint8Array) => Promise<string>;

export function sendOnce<T>(job: (post: OncePost) => Promise<T>, reread: () => Promise<T>): Promise<Outcome<T>> {
  let replied = false;
  const post: OncePost = async (path, body) => {
    const text = await postBody(`/Mail/${path}?${await mailKey()}`, body);
    replied = true;
    return assertAuthorized(text);
  };
  return withSysop(() => exclusive(async () => (
    replied ? { value: await reread(), interrupted: true } : { value: await job(post), interrupted: false }
  )));
}
