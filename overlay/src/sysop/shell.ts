// Polls the sysop shell runs once and shares with its screens (sidebar counts, Health).
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { getUsers, type Session } from '../data/api';
import { usePoll, type Poll } from '../data/poll';
import { getStation, type Station } from '../data/uiapi';
import { fetchForwarding, fetchMailStatus, type Forwarding, type MailStatus } from './model';

export interface ShellData {
  station: Poll<Station>;
  status: Poll<MailStatus>;
  fwd: Poll<Forwarding>;
  users: Poll<Session[]>;
}

export const SHELL_POLL_MS = { station: 60_000, status: 30_000, fwd: 60_000, users: 30_000 } as const;

export function useShellPolls(): ShellData {
  return {
    station: usePoll(getStation, SHELL_POLL_MS.station),
    status: usePoll(fetchMailStatus, SHELL_POLL_MS.status),
    fwd: usePoll(fetchForwarding, SHELL_POLL_MS.fwd),
    users: usePoll(getUsers, SHELL_POLL_MS.users),
  };
}

const empty: Poll<never> = { data: undefined, error: undefined, stale: false };
export const ShellContext = createContext<ShellData>({ station: empty, status: empty, fwd: empty, users: empty });
export const useShell = (): ShellData => useContext(ShellContext);
