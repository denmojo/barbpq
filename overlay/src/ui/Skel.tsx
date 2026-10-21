import type { Poll } from '../data/poll';
import { Unknown } from './Unknown';

/** Placeholder while a value is on its way. */
export const Skel = () => <span class="skel" role="img" aria-label="Loading" />;

/** For a poll with no data yet: the failure as Unknown (reason = the error) once it has failed, else a loading placeholder. */
export function Pending({ poll }: { poll: Poll<unknown> }) {
  return poll.error ? <Unknown reason={poll.error.message} /> : <Skel />;
}
