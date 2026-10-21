// The fork's /api/ui endpoints. Values the node does not know are null.
import { getJson, HttpError } from './http';
import { NotAuthorizedError, sysop } from './session';

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
  /** null when the node does not know its start time */
  uptimeSec: number | null;
  telnetPort: number | null;
  ports: StationPort[];
}
/** evidence, for a linked port, is what the node saw: a link it observed (VARA, KISS TCP), only a
 *  device held open (serial KISS), or AXIP sockets open. null otherwise; absent from an older node. */
export type LinkEvidence = 'link' | 'device' | 'socket';
export interface LinkState {
  number: number; state: 'linked' | 'down' | 'unknown'; detail: string; evidence?: LinkEvidence | null;
}
export interface CmsState { lastAttempt: string | null; lastSuccess: string | null; ok: boolean | null }
export interface Counts { windowStart: string | null; full: boolean; sessions: number; messages: number; frames: number }
export interface Heard { call: string; packets: number; lastHeard: string | null; via: string[] }
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
/** Sysop only: the node answers 401 without a live sysop session, which reads as signed out. */
export async function getEvents(limit?: number): Promise<UiEvent[]> {
  try {
    return await getJson<UiEvent[]>(limit === undefined ? '/api/ui/events' : `/api/ui/events?limit=${limit}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      sysop.value = 'out';
      throw new NotAuthorizedError();
    }
    throw e;
  }
}
