// What the public and sysop layouts share: the public screens by route, and the page title.
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Route } from '../app/router';
import type { Info } from '../data/api';
import type { Poll } from '../data/poll';
import { nodeVersion } from './Footer';
import { Overview } from './Overview';
import { Ports } from './Ports';
import { Heard } from './Heard';
import { LinksRoutes } from './LinksRoutes';
import { Sessions } from './Sessions';

export const PUBLIC_NAME = 'BarBPQ - LinBPQ Web UI';

export const PUBLIC_SCREENS: Partial<Record<Route, FunctionComponent>> = {
  overview: Overview, ports: Ports, heard: Heard, links: LinksRoutes, sessions: Sessions,
};

/** Title "<node call> · BarBPQ - LinBPQ Web UI" from /api/info; also records the node version for footers. */
export function useDocTitle(info: Poll<Info>): void {
  const call = info.data?.NodeCall;
  useEffect(() => {
    document.title = call ? `${call} · ${PUBLIC_NAME}` : PUBLIC_NAME;
  }, [call]);
  useEffect(() => {
    if (info.data) nodeVersion.value = info.data.Version;
  }, [info.data]);
}
