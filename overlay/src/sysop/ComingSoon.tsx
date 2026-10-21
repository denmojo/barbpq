import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import type { Route } from '../app/router';
import { labelOf, NAV_ITEMS } from './nav';

/** Stands in for a sysop screen that a later part of this release builds. */
export function ComingSoon({ route }: { route: Route }) {
  const label = labelOf(route);
  const Icon = NAV_ITEMS.find((i) => i.route === route)?.icon;
  return (
    <>
      <div class="titlebar"><h1>{label}</h1></div>
      <div class="grid">
        <Card title={label} span={12}>
          <EmptyState
            icon={Icon ? <Icon /> : undefined}
            title="Coming in this release."
            hint={`The ${label} screen is still being built. Health and the Network screens work now.`}
          />
        </Card>
      </div>
    </>
  );
}
