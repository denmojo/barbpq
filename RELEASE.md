# Releasing BarBPQ

This file covers building a release bundle, publishing the fork, installing on the gateway, checking it live, and rolling back. Building is safe to run at any time and never contacts a node.

Assumed below:user `<user>` on `<gateway-host>`; linbpq runs from `/usr/local/bin/linbpq` with working directory `/home/<user>`, inside the tmux session `linbpq`, started by hand (no systemd unit, no cron). Its web port is 8088. `/home/<user>/HTML` does not exist yet. Version 6.0.26.1 is installed, and an older backup `~/linbpq-6.0.24.34.bak` exists.

Never run `linbpq -v` (or any other `linbpq` invocation) on the gateway to check a version: it starts a second node.

## 1. Build the bundle (build host)

```bash
KEEP_DOCKER=1 scripts/release.sh
```

It refuses to run from a tree with uncommitted changes unless `BARBPQ_ALLOW_DIRTY=1` is set. It runs the sanitizer tests, the rollback tests, the C tests (`docker/build.sh test`) and the web UI tests, then builds `out/linbpq` and `overlay/dist/`. Before assembling, it checks that the binary is a 64-bit x86-64 ELF and that `overlay/dist` holds only `.html`, `.js` and `.css` files, none containing `##`, with `index.html` byte-identical to `indexnoaprs.html` and every `ui/*.js` opening with the third-party license banner. It writes the bundle to `out/release/barbpq-<upstream version>-<n>/`, with `<n>` the next unused number:

```
linbpq        the node binary
rollback.sh   run on the gateway to undo the install
HTML/         index.html, indexnoaprs.html, ui/*.js, ui/*.css
VERSION       the commit the bundle was built from (with -dirty if forced)
SHA256SUMS    one line per file above
```

Nothing in it contacts the gateway. With `KEEP_DOCKER=1` Docker Desktop stays up afterwards.

## 2. Publish the fork

Check all of this before running any of it:

```bash
# creates github.com/<his account>/linbpq; adds no remote and clones nothing
gh repo fork g8bpq/linbpq --clone=false

# the remote it then needs
git remote add origin https://github.com/<his account>/linbpq.git

# what would be pushed
git log --oneline upstream/master..ui

# commit messages must carry no tool attribution trailers
git log --format=%B upstream/master..ui | grep -i -E 'co-authored-by|generated with'
```

Push only after his explicit yes:

```bash
git push -u origin ui
```

## 3. Install on the gateway

Steps 3.1 and 3.2 change nothing on the gateway.

### 3.1 Copy and verify the bundle

From the build host (`N` is the bundle number):

```bash
ssh <user>@<gateway-host> 'mkdir -p ~/barbpq'
scp -rp out/release/barbpq-6.0.26.1-N <user>@<gateway-host>:~/barbpq/
```

On the gateway:

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
sha256sum -c SHA256SUMS                     # every line OK
uname -m                                    # x86_64
ldd ./linbpq | grep 'not found'             # prints nothing (ldd only loads, it does not run linbpq)
```

Run everything from here on in an SSH shell of its own, never inside the tmux pane that runs linbpq: stopping linbpq there would leave the procedure without a shell.

### 3.2 Checks before changing anything

```bash
# Can this user write /usr/local/bin? The new binary is moved into place with mv,
# which needs write access to the directory. Sets S for 3.4.
if test -w /usr/local/bin; then S=; echo "no sudo needed"; else S=sudo; echo "sudo needed"; fi
sudo -n true 2>/dev/null && echo "sudo works without a password" || echo "sudo will prompt (or is not allowed)"

# The running node and its version, without starting a second one
pgrep -a -x linbpq
curl -s http://127.0.0.1:8088/api/info      # "Version":"6.0.26.1"
grep -a -c '6\.0\.26\.1' /usr/local/bin/linbpq   # 1 or more

# What the tmux pane is doing
tmux capture-pane -p -t linbpq | tail -5
```

### 3.3 Back up the binary and install the UI

```bash
cd ~/barbpq/barbpq-6.0.26.1-N

# Keep the current binary. Never overwrite an existing backup.
[ -e ~/linbpq-6.0.26.1.bak ] || cp -p /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak
cmp /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak && echo "backup matches"

# Record what exists now in ~/barbpq/install-state, shared by every bundle.
# rollback.sh reads it to remove only what the install added. A re-run never
# turns a recorded html_created=1 or ui_created=1 back into 0.
./rollback.sh --record-install-state

mkdir -p /home/<user>/HTML
cp -R HTML/. /home/<user>/HTML/
ls -la /home/<user>/HTML /home/<user>/HTML/ui
```

### 3.4 Replace the binary and restart

The new binary is staged next to the old one and moved over it with `mv -f`, so `/usr/local/bin/linbpq` is never half-written. Staging happens while linbpq still runs; only the move waits for the stop. SIGTERM makes linbpq close its links and exit.

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
[ -n "$S" ] && sudo -v                       # ask for the password now, before anything stops

# Stage and check the copy, with the old file's mode and owner.
$S cp linbpq /usr/local/bin/linbpq.install-tmp
cmp linbpq /usr/local/bin/linbpq.install-tmp && echo "staged copy matches"
$S chmod --reference=/usr/local/bin/linbpq /usr/local/bin/linbpq.install-tmp
$S chown --reference=/usr/local/bin/linbpq /usr/local/bin/linbpq.install-tmp

# Stop gate: SIGTERM, wait, SIGKILL, check again.
pkill -TERM -x linbpq
for i in $(seq 1 30); do pgrep -x linbpq >/dev/null || break; sleep 1; done
if pgrep -x linbpq >/dev/null; then
  pkill -KILL -x linbpq; sleep 3
fi
pgrep -a -x linbpq && echo "STILL RUNNING: stop here" || echo stopped
```

If that last line prints `STILL RUNNING`, stop the procedure: remove the staged file (`$S rm -f /usr/local/bin/linbpq.install-tmp`) and do not move anything. Otherwise:

```bash
$S mv -f /usr/local/bin/linbpq.install-tmp /usr/local/bin/linbpq
cmp linbpq /usr/local/bin/linbpq && echo "new binary in place"

tmux send-keys -t linbpq 'cd /home/<user> && /usr/local/bin/linbpq' Enter
sleep 5; pgrep -a -x linbpq
```

If the tmux pane is not at a shell prompt, attach with `tmux attach -t linbpq` and start it by hand. Should the binary fail to start, run `./rollback.sh` from the bundle directory right away (see section 5).

## 4. Live checks

```bash
curl -s http://<gateway-host>:8088/api/ui/station         # JSON answer
curl -s http://<gateway-host>:8088/ | head -5             # the new home page (index.html)
curl -s -o /dev/null -w '%{http_code}\n' http://<gateway-host>:8088/Node/NodeIndex.html
curl -s -o /dev/null -w '%{http_code}\n' http://<gateway-host>:8088/Mail/Header
```

Expected:

- `/api/ui/station` and the new home page answer on port 8088.
- On a Winlink RMS gateway, a session from a Winlink client reaches the CMS as it did before.
- The old `/Node/` and `/Mail/` pages still answer.

Any failure here is a reason to roll back.

## 5. Roll back

On the gateway, from the bundle directory, in an SSH shell of its own (not the linbpq tmux pane):

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
./rollback.sh --dry-run     # prints every step, changes nothing
./rollback.sh
```

In order, it:

1. Removes `/home/<user>/HTML/index.html` and `indexnoaprs.html`. It removes `/home/<user>/HTML/ui/` only when `~/barbpq/install-state` says the install created it; otherwise only the `ui/` files this bundle shipped. If the install created `/home/<user>/HTML` and it is now empty, that goes too. Nothing else in `HTML/` is touched.
2. If `/usr/local/bin/linbpq` differs from `~/linbpq-6.0.26.1.bak`, copies the backup to `/usr/local/bin/linbpq.rollback-tmp` and checks it with `cmp` while linbpq still runs. Then it stops linbpq (SIGTERM, then SIGKILL after 30 s) and moves the copy over the binary with `mv -f`. When `/usr/local/bin` is not writable it runs `sudo -v` before anything else, then uses sudo for the copy and the move. A failed or interrupted copy leaves `/usr/local/bin/linbpq` untouched and the temp file removed.
3. On every exit, failure or interruption included, it first finishes a stop already begun (waiting for the old process to exit, with SIGKILL as the last step), then starts linbpq in the tmux session `linbpq` if it is not running (creating the session if it is gone), and reports the pid.

It prints each action and exits 1 if any step failed. Running it again is harmless: each step checks first. The backup is kept.

Every path is an environment variable (`./rollback.sh --help`). `scripts/test_rollback.sh` uses them to run it against a throwaway tree with a fake linbpq and a private tmux server.
