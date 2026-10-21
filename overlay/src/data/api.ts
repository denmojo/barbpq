// The node's existing JSON API. Field names follow the node's own output.
import { getJson } from './http';

export interface Info { NodeCall: string; Alias: string; Locator: string; Version: string }
export interface Port { ID: string; Driver: string; Number: number; State: string }
/** /api/users lists only the call of each L4 user. */
export interface Session { Call: string }
export interface Link { farCall: string; ourCall: string; port: string; state: string; linkType: string; ax25Version: string }
export interface NodeRoute { Call: string; Port: number; Quality: number }
export interface NodeEntry { Call: string; Alias: string; Routes: NodeRoute[] }

async function list<T>(path: string, key: string): Promise<T[]> {
  const body = await getJson<Record<string, T[] | undefined>>(path);
  return body[key] ?? [];
}

export async function getInfo(): Promise<Info> {
  return (await getJson<{ info: Info }>('/api/info')).info;
}
export const getPorts = (): Promise<Port[]> => list<Port>('/api/ports', 'ports');
export const getUsers = (): Promise<Session[]> => list<Session>('/api/users', 'users');
export const getLinks = (): Promise<Link[]> => list<Link>('/api/links', 'links');
export const getNodes = (): Promise<NodeEntry[]> => list<NodeEntry>('/api/nodes', 'nodes');
