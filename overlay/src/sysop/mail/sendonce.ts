// A mail request that changes the node (kill, delete, a forwarding step, Start Forwarding) is sent
// at most once. withSysop retries a job after a sign-in when the node asked for one; a job whose
// changing post already had a reply of any kind, a sign-in page included, is not run again: the
// retry re-reads the state instead, and the outcome says it was interrupted. A lost mail session
// aborts the job (MailJobAbortedError) and is never retried on a fresh key.
import { postBody } from '../../data/http';
import { withSysop } from '../../data/session';
import { exclusive, type MailJob } from '../model';

export interface Outcome<T> { value: T; interrupted: boolean }

export type OncePost = (path: string, body: Uint8Array) => Promise<string>;

export function sendOnce<T>(
  job: (j: MailJob, post: OncePost) => Promise<T>, reread: (j: MailJob) => Promise<T>, what: string,
): Promise<Outcome<T>> {
  let replied = false;
  return withSysop(() => exclusive(async (j) => {
    if (replied) return { value: await reread(j), interrupted: true };
    const post: OncePost = async (path, body) => {
      j.check();
      const text = await postBody(`/Mail/${path}?${j.key}`, body);
      replied = true;
      return j.accept(text);
    };
    return { value: await job(j, post), interrupted: false };
  }, what));
}
