import { getUsers } from '../data/api';
import { usePoll } from '../data/poll';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorNote } from '../ui/ErrorNote';
import { OfflineBanner } from '../ui/OfflineBanner';
import { Footer } from './Footer';
import { useUpdated } from './useUpdated';

export function Sessions() {
  const users = usePoll(getUsers, 10_000);
  const updated = useUpdated(users.data);
  return (
    <>
      <OfflineBanner show={users.stale} since={updated} />
      <div class="grid">
        <Card title="Who's connected" span={12}>
          {users.error && !users.data && <ErrorNote error={users.error} />}
          {users.data && (users.data.length ? (
            <ul class="heard">
              {users.data.map((u) => <li><span class="call">{u.Call}</span></li>)}
            </ul>
          ) : <EmptyState icon="📡" title="Nobody is connected right now." hint="Sessions show here live as stations connect." />)}
        </Card>
      </div>
      <Footer updated={updated} />
    </>
  );
}
