# Staging: a test node with a peer

Staging runs the BarBPQ build in Docker on the build host, on a copy of a node's config with every secret replaced and every outside link cut. `docker/staging.sh up --peer` adds a second linbpq and a stand-in CMS, so the screens carry data a node produces itself: a neighbour, heard stations, sessions, forwarding, CMS checks. Nothing in staging reaches the internet or a radio.

## Getting a config

Staging reads its config from `staging/` (ignored by git). `scripts/fetch-staging-config.sh` fills it from a node you run, over ssh:

```
echo 'user@host' >scripts/gateway.local     # or set BARBPQ_GATEWAY=user@host
scripts/fetch-staging-config.sh
```

It writes nothing on the node. `scripts/sanitize.py` runs there over stdin, and only sanitized text comes back: every USER line replaced by the test sysop login `sysop` / `staging`, other passwords replaced, the CMS turned off, and the Winlink, APRS-IS, map-server, relay and MQTT hosts pointed at 127.0.0.1. Modem endpoints point at ports nothing serves, so no port can key a radio. The leak check aborts the fetch, printing only the class of key it found, if anything secret survives.

## Start and stop

```
docker/staging.sh up --peer
(cd overlay && npm run build)
scripts/install-staging.sh          # copies overlay/dist into staging/HTML
```

Then open http://127.0.0.1:18088/ and sign in as `sysop` / `staging`.

`docker/staging.sh down` removes all three containers and the network. A plain `docker/staging.sh up` takes the peer patch back out of `staging/` and runs the staging node alone. On macOS the script starts Docker Desktop if it is not running and quits it again on `down`; set `KEEP_DOCKER=1` to leave it running.

## What runs

| Container | Address on bpq-staging-net | What it is |
|---|---|---|
| bpq-staging | 172.30.249.2 | the staging node, `staging/` as cwd; web UI on 127.0.0.1:18088, Telnet on 127.0.0.1:18010 |
| bpq-peer | 172.30.249.3 | a second linbpq, `staging-peer/` as cwd; node N0PEER-11, alias PEER, BBS N0PEER |
| bpq-fakecms | 172.30.249.4 | `docker/fakecms.pl`: accepts TCP on 8772, sends one line, closes |

bpq-staging-net is an internal Docker network: the peer and the stand-in CMS have no route out at all. For its published ports the staging node also sits on Docker's usual bridge, with the outside hosts pointed at 127.0.0.1 as above. N0PEER is a call no licensing authority issues.

`scripts/staging_peer.py apply` runs inside `up --peer` while the node is stopped. It changes only local files:

- `staging/bpq32.cfg`: an AXIP port (`DRIVER=BPQAXIP`, UDP 10093, `MAP N0PEER-11 172.30.249.3 UDP 10093 B`, NODES and ID broadcasts, QUALITY 192) before the APPLICATION lines. On the Telnet port it sets `CMS=1` with `CMSSERVER=172.30.249.4`. Every added line carries `;staging-peer`; the old `CMS=0` line stays in place, commented out. Because CMSSERVER is an address, the node resolves no CMS host name. Inside the staging container 127.0.0.1:8772 is taken (`RELAYAPPL` makes the node itself listen on 8772), so the stand-in CMS has its own address.
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

If the copied BBS config holds mail from new users, as many gateways do, the message `mail` posts as N0CALL on the staging BBS appears in Messages as Held. Release it there, then press Start forwarding on the N0PEER partner (or wait for the 300 s poll), and it goes to the peer. The peer holds nothing; its message reaches the staging BBS within about 30 s.

## What each screen shows

- Overview: the peer under Recently heard; Who's connected lists N0CALL twice while a session is open; the CMS line reads reachable after the first CMS check.
- Ports: port 4 "AXIP peer link", driver BPQAXIP.
- Heard: N0PEER-11 on port 4.
- Links & routes: N0PEER-11 as a neighbour on port 4, quality 192, link Up, and PEER under Nodes. While a session is open, an Active node-node link to N0PEER-11.
- Sessions: the two N0CALL entries of an open session.
- Messages: the test messages; the one from the peer as New, the one for the peer as Held until released, then Forwarded.
- Forwarding: N0PEER and RMS beside whatever partners the copied config had. Start forwarding on N0PEER runs at once.
- Health: Winlink CMS Reachable or Unreachable; Recent changes logs each forward run.

## The stand-in CMS and the store-and-forward states

```
docker/staging.sh cms off       # listener closed: connects are refused at once
docker/staging.sh cms on        # listener open again
```

- Reachable: with the listener open, `docker/staging.sh rms` reads `ok: true` on `/api/ui/cms`. Health shows Winlink CMS Reachable.
- Unreachable: `cms off`, then `rms`. Refused at 172.30.249.4, the node records the CMS as down.
- Fallback: with the listener closed and the node not yet aware of it, a forwarding run to RMS fails its CMS attempt. Health then shows "Forwarded via RMS via port 1 while CMS was unreachable", and Store and forward shows "Last used". To queue one, post a message to an internet address on the staging BBS (`nc 127.0.0.1 18010`, sysop, staging, `BBS`, `SP test@winlink.org`). Release it in Messages and press Start forwarding on RMS. If the RMS connect script has an ELSE line for a packet partner, the node tries it next; no modem sits behind staging's ports, so nothing goes on the air.
- Unknown: after a failed attempt the node marks the CMS down and makes no further attempt until its next check. A second RMS run then gets "CMS Not Available" and no CMS result. That run is logged with the result unknown, and the Store and forward card shows Unknown with that reason. An ELSE line starts a run of its own, also logged unknown, so a fallback run is soon followed by an unknown one and the card moves from "Last used" to Unknown.
- Back to reachable: `cms on`, then `rms` twice. The first still meets the node's down mark and starts a recheck; the second connects.

## Logs

`docker/staging.sh logs`, `logs peer`, `logs cms`. BBS logs: `staging/logs/log_<date>_BBS.txt` and `staging-peer/logs/log_<date>_BBS.txt`.
