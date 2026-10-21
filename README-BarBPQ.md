# BarBPQ - LinBPQ Web UI

BarBPQ is a fork of [LinBPQ](https://github.com/g8bpq/linbpq), John Wiseman G8BPQ's packet radio node, BBS and Winlink gateway, with a new web front end for the node's built-in web server. It is based on upstream version 6.0.26.1.

It adds two things:

- A static web UI (in `overlay/`) that the node serves from its `HTML/` directory. Its public pages show the station, ports, links and routes, sessions and the heard list. For the SysOp it covers sign-in, node settings, mail settings, BBS users, forwarding, messages, a console and the log viewer.
- A small read-only JSON API under `/api/ui/` (in `uiapi.c`) that the UI reads: station summary, links, CMS state, counters, the heard list and recent events.

Upstream's own pages under `/Node/` and `/Mail/` stay in place and keep working.

BarBPQ is Linux only. Its release bundle holds a 64-bit x86-64 Linux build of `linbpq`. Upstream's Windows and macOS build files are left untouched and are not built or tested.

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

`scripts/release.sh` runs all of the tests, builds both, and assembles a bundle in `out/release/barbpq-<version>-<n>/` holding `linbpq`, `HTML/`, `rollback.sh` and `SHA256SUMS`. It never contacts a node.

## Installing

These steps assume linbpq runs as an ordinary user from `/usr/local/bin/linbpq`, with the user's home directory as its working directory, inside a tmux session named `linbpq`. Adjust the paths to match your node. `RELEASE.md` has the full procedure with checks.

1. Copy the bundle to the node and check it:

   ```bash
   scp -r out/release/barbpq-6.0.26.1-1 user@node:~/barbpq/
   cd ~/barbpq/barbpq-6.0.26.1-1 && sha256sum -c SHA256SUMS
   ```

2. Keep a copy of the current binary. `rollback.sh` restores from it.

   ```bash
   cp -p /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak
   ```

3. Record whether the UI directories already exist. A rollback reads this record and removes only what the install added. Then copy the UI in:

   ```bash
   { [ -d ~/HTML ] && echo html_created=0 || echo html_created=1
     [ -d ~/HTML/ui ] && echo ui_created=0 || echo ui_created=1; } > install-state
   mkdir -p ~/HTML && cp -R HTML/. ~/HTML/
   ```

4. Stop linbpq, replace the binary, and start it again in its tmux session. A running binary cannot be overwritten. If `/usr/local/bin` is not writable by the node's user, the `cp` needs `sudo`.

   ```bash
   pkill -TERM -x linbpq        # wait until `pgrep -x linbpq` prints nothing
   cp linbpq /usr/local/bin/linbpq
   tmux send-keys -t linbpq 'cd ~ && /usr/local/bin/linbpq' Enter
   ```

Once linbpq is back, the new home page answers at the node's web port (for example `http://node:8088/`).

## Rolling back

Run `rollback.sh` on the node from the bundle directory:

```bash
cd ~/barbpq/barbpq-6.0.26.1-1
./rollback.sh --dry-run   # show what it would do
./rollback.sh
```

It removes `index.html` and `indexnoaprs.html` from `~/HTML`. It also removes the `ui/` directory when the install created it. Then it stops linbpq, puts the backup binary back, and starts linbpq again in the `linbpq` tmux session. Running it a second time is safe. It always tries to leave linbpq running, even when a step fails. Environment variables can change the paths; `./rollback.sh --help` lists them.

## License

G8BPQ's code is under the GNU General Public License version 3 or later. Bundled third-party code keeps its own notices. BarBPQ's web UI and `uiapi.c`/`uiapi.h` are also GPL-3.0-or-later. See `LICENSE`.
