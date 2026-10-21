import { Lock } from 'lucide-preact';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';

/** Stands in for the SysOp sign-in screen until it is built. */
export function SignInPending() {
  return (
    <div class="grid">
      <Card title="SysOp sign in" span={12}>
        <EmptyState icon={<Lock aria-hidden="true" />} title="SysOp sign-in is not built yet." hint="The public screens are in the tabs above." />
      </Card>
    </div>
  );
}
