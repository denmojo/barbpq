# Staging preview with a peer node

Run plain (`docker/staging.sh up`), staging carries the gateway's sanitized config with every link down. Most screens are empty there. `up --peer` adds a second linbpq and a fake CMS, so the screens carry data the node itself produces. Nothing here touches the gateway. Nothing leaves the Mac.

## Start and stop

```
KEEP_DOCKER=1 docker/staging.sh up --peer
scripts/install-staging.sh          # if overlay/dist is newer than staging/HTML
```

Then open http://127.0.0.1:18088/ and sign in as `sysop` / `staging` (the sanitized config's test login).

`docker/staging.sh down` removes all three containers and the network. It quits Docker Desktop unless `KEEP_DOCKER=1` is set. A plain `docker/staging.sh up` takes the peer patch back out of `staging/` and runs the staging node alone, as before.

## What runs

| Container | Address on bpq-staging-net | What it is |
|---|---|---|
| bpq-staging | 172.30.249.2 | the staging node, `staging/` as cwd; web UI on 127.0.0.1:18088, Telnet on 127.0.0.1:18010 |
| bpq-peer | 172.30.249.3 | a second linbpq, `staging-peer/` as cwd; node N0PEER-11, alias PEER, BBS N0PEER |
| bpq-fakecms | 172.30.249.4 | `docker/fakecms.pl`: accepts TCP on 8772, sends one line, closes |

bpq-staging-net is an internal Docker network: the peer and the fake CMS have no route out at all. For the published ports, the staging node keeps its usual bridge, with the Winlink, APRS-IS, map and update hosts pointed at 127.0.0.1 as before. N0PEER is a call no licensing authority issues.

`scripts/staging_peer.py apply` runs inside `up --peer` while the node is stopped. It changes only local files:

- `staging/bpq32.cfg`: an AXIP port (`DRIVER=BPQAXIP`, UDP 10093, `MAP N0PEER-11 172.30.249.3 UDP 10093 B`, NODES and ID broadcasts, QUALITY 192) before the APPLICATION lines. On the Telnet port it sets `CMS=1` with `CMSSERVER=172.30.249.4`. Every added line carries `;staging-peer`; the old `CMS=0` line stays in place, commented out. Because CMSSERVER is an address, the node resolves no CMS host name. In the staging container 127.0.0.1:8772 is taken: `RELAYAPPL` makes the node itself listen on 8772, so the fake CMS sits on its own address.
- `staging/linmail.cfg`: a BBS user N0PEER (BBS flag, the lowest free BBS number) and a forwarding record N0PEER. Its script is `C 4 N0PEER-11` / `BBS`, with send-new-at-once and no reverse polling. A poll would start runs with nothing queued, and a run still waiting for its CMS result when the node stops is logged at shutdown, which breaks the restart check in `tests/uiapi_endpoints.sh`.
- `staging-peer/`: written fresh each time. Its `linmail.cfg` is built from the staging node's Main and Housekeeping groups with the peer's calls. It has one forwarding record, for the staging BBS, and the test user N0CALL preset so a scripted login meets no new-user questions.

`scripts/staging_peer.py revert` takes all of it back out of `staging/`; plain `up` runs it.

## Traffic

```
docker/staging.sh mail          # one message on each BBS, addressed to the other
docker/staging.sh session 300   # an L4 circuit from the staging node to PEER for 300 s
docker/staging.sh rms           # one CMS attempt through the RMS application
nc 127.0.0.1 18010              # by hand: sysop, staging, then C PEER, BBS, B
```

Mail from N0CALL is held on the staging BBS. Gateway settings hold mail from new users, and N0CALL was new on staging. So the message `mail` posts on the staging BBS appears in Messages as Held. Release it there, then press Start forwarding on the N0PEER partner (or wait for the 300 s poll), and it goes to the peer. On the peer side nothing is held; its message reaches the staging BBS within about 30 s.

## What each screen shows

- **Overview**: the peer under Recently heard; Who's connected lists N0CALL twice while a session is open; the CMS line reads reachable after the first CMS check.
- **Ports**: port 4 "AXIP peer link", driver BPQAXIP. Its Link reads Unknown, because the node reports no link state for AXIP ports.
- **Heard**: N0PEER-11 on port 4.
- **Links & routes**: N0PEER-11 as a neighbour on port 4, quality 192, link Up, and PEER under Nodes. While a session is open, an Active node-node link to N0PEER-11.
- **Sessions**: the two N0CALL entries of an open session.
- **Messages**: the test messages; the one from the peer as New, the one for the peer as Held until released, then Forwarded.
- **Forwarding**: three partners, AD6DM, N0PEER and RMS. Start forwarding on N0PEER runs at once.
- **Health**: Winlink CMS Reachable or Unreachable; Recent changes logs each forward run.

## The fake CMS and the store-and-forward states

```
docker/staging.sh cms off       # listener closed: connects are refused at once
docker/staging.sh cms on        # listener open again
```

- **Reachable**: with the listener open, `docker/staging.sh rms` reads `ok: true` on `/api/ui/cms`. Health shows Winlink CMS Reachable.
- **Unreachable**: `cms off`, then `rms`. Refused at 172.30.249.4, the node records the CMS as down.
- **Fallback**: with the listener closed and the node not yet aware of it, a forwarding run to RMS fails its CMS attempt. Health then shows "Forwarded via RMS via port 1 while CMS was unreachable", and Store and forward shows "Last used". To queue one, post a message to an internet address on the staging BBS (`nc 127.0.0.1 18010`, sysop, staging, `BBS`, `SP test@winlink.org`). Release it in Messages and press Start forwarding on RMS. Its connect script's ELSE line tries `C 2 W6SAR-10` on the Direwolf port. On staging no modem sits behind that port, so nothing goes on the air.
- **Unknown**: after a failed attempt the node marks the CMS down and makes no further attempt until its next check. A second RMS run then gets "CMS Not Available" and no CMS result. That run is logged with the result unknown, and the Store and forward card shows Unknown with that reason. The ELSE line starts a run of its own, also logged unknown, so a fallback run is soon followed by an unknown one and the card moves from "Last used" to Unknown.
- Back to reachable: `cms on`, then `rms` twice. Of those, the first still meets the node's down mark and starts a recheck; the second connects.

## Logs

`docker/staging.sh logs`, `logs peer`, `logs cms`. BBS logs: `staging/logs/log_<date>_BBS.txt` and `staging-peer/logs/log_<date>_BBS.txt`.
