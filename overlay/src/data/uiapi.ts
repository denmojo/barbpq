// The fork's /api/ui endpoints. Values the node does not know are null.
import { getJson } from './http';

export interface StationPort {
  number: number;
  id: string;
  driver: string;
  freqHz: number | null;
  modes: string[];
  addr: string | null;
  txtailMs: number | null;
}
export interface Station {
  call: string;
  alias: string;
  locator: string;
  version: string;
  uptimeSec: number;
  telnetPort: number;
  ports: StationPort[];
}
export interface LinkState { number: number; state: 'linked' | 'down' | 'unknown'; detail: string }
export interface CmsState { lastAttempt: string | null; lastSuccess: string | null; ok: boolean | null }
export interface Counts { windowStart: string; full: boolean; sessions: number; messages: number; frames: number }
export interface Heard { call: string; packets: number; lastHeard: string; via: string[] }
export interface UiEvent {
  t: string;
  kind: 'restart' | 'cfgsave' | 'mailsave' | 'forward';
  detail: Record<string, unknown>;
}

export const getStation = (): Promise<Station> => getJson<Station>('/api/ui/station');
export async function getLinkStates(): Promise<LinkState[]> {
  return (await getJson<{ ports: LinkState[] }>('/api/ui/links')).ports;
}
export const getCms = (): Promise<CmsState> => getJson<CmsState>('/api/ui/cms');
export const getCounts = (): Promise<Counts> => getJson<Counts>('/api/ui/counts');
export const getHeard = (port: number): Promise<Heard[]> => getJson<Heard[]>(`/api/ui/mheard/${port}`);
export const getEvents = (limit?: number): Promise<UiEvent[]> =>
  getJson<UiEvent[]>(limit === undefined ? '/api/ui/events' : `/api/ui/events?limit=${limit}`);
