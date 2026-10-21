# BarBPQ - LinBPQ Web UI

BarBPQ is a fork of [LinBPQ](https://github.com/g8bpq/linbpq), John Wiseman G8BPQ's packet radio node, BBS and Winlink gateway, with a new web front end for the node's built-in web server. It is based on upstream version 6.0.26.1.

It adds two things:

- A static web UI (in `overlay/`) that the node serves from its `HTML/` directory. Its public pages show the station, ports, links and routes, sessions and the heard list. For the SysOp it covers sign-in, node settings, mail settings, BBS users, forwarding, messages, a console and the log viewer.
- A small read-only JSON API under `/api/ui/` (in `uiapi.c`) that the UI reads: station summary, links, CMS state, counters and the heard list, plus recent events for a signed-in sysop.

Upstream's own pages under `/Node/` and `/Mail/` stay in place and keep working.

<p align="center">
  <img src="docs/screenshots/overview-desktop.png" alt="The public Overview of a live RMS gateway in a desktop browser: Gateway on the air on 145.630 MHz, VARA FM and Dire Wolf ports listening, the recently heard list, session and frame counters" width="100%">
  <br><em>Overview on a live Winlink RMS gateway</em>
</p>

<p align="center">
  <img src="docs/screenshots/overview-phone.png" alt="The same Overview at phone width in the light theme, with the status card, radio ports and recently heard stacked" width="35%">
  <br><em>Phone view, light theme</em>
</p>

BarBPQ is Linux only. Its release bundle holds a 64-bit x86-64 Linux build of `linbpq`. Upstream's Windows and macOS build files are left untouched and are not built or tested.

## Screens

Each port shows its driver, frequency, mode, address and whether its modem is linked. VARA reports its TNC connection, and KISS over TCP reports its socket; other drivers read Unknown, never a guess.

<p align="center">
  <img src="docs/screenshots/ports.png" alt="The Ports table: VARA FM and Direwolf on 145.630 MHz listening, the Telnet server with unknown link state" width="100%">
</p>

For the SysOp, Health gathers the radios, the CMS link, the BBS and the store-and-forward path into one page, with the outage route a held message takes when the CMS is unreachable and the node's recent changes. The shots below come from a staging node with test callsigns, its radios unplugged.

<p align="center">
  <img src="docs/screenshots/health.png" alt="The Health page: VARA FM and Dire Wolf down, Winlink CMS reachable, BBS running, store and forward armed; the outage route from the BBS to CMS via internet, else W6SAR-10 on packet; recent forwarding runs and restarts" width="100%">
</p>

Messages lists everything on the BBS with its status, and a message opens for release, hold or kill. Forwarding edits each partner's schedule and connect script, ELSE fallbacks included, and starts a run on demand.

<p align="center">
  <img src="docs/screenshots/messages.png" alt="The Messages page: held, sent and bounced counts above a message list with type, status, from, to, subject, size and date" width="100%">
</p>

<p align="center">
  <img src="docs/screenshots/forwarding.png" alt="Forwarding for the RMS partner: Start forwarding, the schedule fields, and a connect script of ATTACH 1, NOFALLBACK, C CMS, ELSE, C 2 W6SAR-10" width="100%">
</p>

The console is the node's own command line in the browser, one command at a time with its echo, plus one-click buttons for the common ones.

<p align="center">
  <img src="docs/screenshots/console.png" alt="The Console after PORTS and ROUTES: four ports listed and a route to N0PEER-11" width="100%">
</p>

## Building

Docker builds the binary, so any host with Docker can build it:

```bash
docker/build.sh test     # C tests
docker/build.sh binary   # writes out/linbpq
```

Building the web UI needs Node.js:

```bash
cd overlay && npm ci && npm test && npm run build   # writes overlay/dist/
```

`scripts/release.sh` runs all of the tests, builds both, and assembles a bundle in `out/release/barbpq-<version>-<n>/` holding `linbpq`, `HTML/`, `rollback.sh`, `VERSION` and `SHA256SUMS`. It never contacts a node.

## Installing

These steps assume linbpq runs as an ordinary user from `/usr/local/bin/linbpq`, with the user's home directory as its working directory, inside a tmux session named `linbpq`. Adjust the paths to match your node. `RELEASE.md` has the full procedure with checks.

1. Copy the bundle to the node and check it:

   ```bash
   scp -r out/release/barbpq-6.0.26.1-1 user@node:~/barbpq/
   cd ~/barbpq/barbpq-6.0.26.1-1 && sha256sum -c SHA256SUMS
   ```

2. Keep a copy of the current binary. `rollback.sh` restores from it.

   ```bash
   [ -e ~/linbpq-6.0.26.1.bak ] || cp -p /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak
   ```

3. With linbpq running, record in `~/barbpq/install-state` whether the UI directories already exist, and the running node's arguments and working directory. A rollback reads this record and removes only what the install added, a re-run never erases a recorded "created", and every start through `rollback.sh` reuses the arguments and directory. Name the HTML directory you copy into, so the record describes that one. Then copy the UI in:

   ```bash
   H=~/HTML
   BARBPQ_HTML=$H ./rollback.sh --record-install-state
   mkdir -p "$H" && cp -R HTML/. "$H"/
   ```

   The record names the directory (`html=`). A rollback later needs the same `BARBPQ_HTML` if `H` is not `~/HTML`, and refuses, changing nothing, when the two differ.

4. Replace the binary and restart linbpq in its tmux session. Run this from a shell of its own (an SSH session), never inside the tmux pane that runs linbpq. Moving into `/usr/local/bin` needs write access to the directory; without it, set `S=sudo` (otherwise `S=`). Giving the staged copy the binary's owner needs sudo when that owner is another user, such as root; set `C=sudo` then (otherwise `C=$S`). Run `sudo -v` first if either is set. The new binary is staged beside the old one and moved over it, so the installed file is never half-written. Each block ends in a gate line; go on only when it prints the line named.

   ```bash
   B=/usr/local/bin/linbpq; T=$B.install-tmp
   $S rm -f "$T" && $S cp linbpq "$T" && cmp linbpq "$T" \
     && $S chmod --reference="$B" "$T" && $C chown --reference="$B" "$T" \
     && echo "STAGED OK" || { echo "STAGING FAILED: stop here"; $S rm -f "$T"; }
   ```

   Go on only on `STAGED OK`; on `STAGING FAILED` nothing has changed and linbpq is still running.

   ```bash
   pkill -TERM -x linbpq
   for i in $(seq 1 30); do pgrep -x linbpq >/dev/null || break; sleep 1; done
   if pgrep -x linbpq >/dev/null; then pkill -KILL -x linbpq; sleep 3; fi
   pgrep -a -x linbpq && echo "STILL RUNNING: stop here" || echo STOPPED
   ```

   On `STILL RUNNING`, stop: remove the staged file and move nothing. On `STOPPED`, stop following this README and continue in `RELEASE.md` 3.4 from the paragraph after its stop gate, in the same shell. From there it snapshots the BBS data files before the new build opens them, so a rollback can restore them too, then moves the new binary into place and starts linbpq with `./rollback.sh --start`. This README does not repeat those commands, so that there is one copy of them to keep right.

   `rollback.sh --start` starts linbpq in the `linbpq` tmux session with the recorded working directory and arguments. It creates the session if stopping linbpq closed it (as happens when linbpq is the pane's own command), and uses a new window if the pane is not at a shell prompt.

Once linbpq is back, the new home page answers at the node's web port (for example `http://node:8088/`). Check that the BBS came back too: `curl -s http://node:8088/Node/NodeMenu.html | grep -c 'Mail Mgmt'` prints 1 when it is loaded.

## Rolling back

Run `rollback.sh` on the node from the bundle directory, again from a shell of its own. Its default paths are under the home directory of the user running it (`~/HTML`, `~/linbpq-6.0.26.1.bak`); set the `BARBPQ_*` variables listed by `./rollback.sh --help` for any other layout.

```bash
cd ~/barbpq/barbpq-6.0.26.1-1
./rollback.sh --dry-run   # show what it would do
./rollback.sh
```

It removes `index.html` and `indexnoaprs.html` from `~/HTML`. It also removes the `ui/` directory when the install created it. Then it stages the backup beside the binary, stops linbpq, moves the backup into place, and starts linbpq again as `--start` does. Running it a second time is safe. It always tries to leave linbpq running, even when a step fails or it is interrupted. It restores the binary only; `RELEASE.md` 5.2 restores the data snapshot if the old build cannot read what the new one wrote. A browser that loaded the new UI may need a hard reload (Ctrl+Shift+R) to show the old menu.

## License

G8BPQ's code is under the GNU General Public License version 3 or later. Bundled third-party code keeps its own notices. BarBPQ's web UI and `uiapi.c`/`uiapi.h` are Copyright (C) 2026 Dennis Mojado, also under GPL-3.0-or-later. See `LICENSE`.
