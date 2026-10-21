# Releasing BarBPQ

This file covers building a release bundle, publishing the fork, installing on the gateway, checking it live, and rolling back. Building is safe to run at any time and never contacts a node.

Assumed below:user `<user>` on `<gateway-host>`; linbpq runs from `/usr/local/bin/linbpq` with working directory `/home/<user>`, inside the tmux session `linbpq`, started by hand (no systemd unit, no cron). Its web port is 8088. `/home/<user>/HTML` does not exist yet. Version 6.0.26.1 is installed, and an older backup `~/linbpq-6.0.24.34.bak` exists.

Never run `linbpq -v` (or any other `linbpq` invocation) on the gateway to check a version: it starts a second node.

## 1. Build the bundle (build host)

```bash
KEEP_DOCKER=1 scripts/release.sh
```

It runs the sanitizer tests, the rollback tests, the C tests (`docker/build.sh test`) and the web UI tests, then builds `out/linbpq` and `overlay/dist/`. Before assembling, it checks that the binary is a 64-bit x86-64 ELF and that `overlay/dist` holds only `.html`, `.js` and `.css` files, none containing `##`, with `index.html` byte-identical to `indexnoaprs.html`. It writes the bundle to `out/release/barbpq-<upstream version>-<n>/`, with `<n>` the next unused number:

```
linbpq        the node binary
rollback.sh   run on the gateway to undo the install
HTML/         index.html, indexnoaprs.html, ui/*.js, ui/*.css
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

### 3.2 Checks before changing anything

```bash
# Is the binary writable without sudo? Decides whether the cp in 3.4 needs sudo.
test -w /usr/local/bin/linbpq && echo "writable: no sudo" || echo "not writable: use sudo"
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

# Record what exists now; rollback.sh reads this file to remove only what the install added.
{ [ -d /home/<user>/HTML ] && echo html_created=0 || echo html_created=1
  [ -d /home/<user>/HTML/ui ] && echo ui_created=0 || echo ui_created=1; } > install-state
cat install-state

mkdir -p /home/<user>/HTML
cp -R HTML/. /home/<user>/HTML/
ls -la /home/<user>/HTML /home/<user>/HTML/ui
```

### 3.4 Replace the binary and restart

A running binary cannot be overwritten (`Text file busy`), so linbpq stops first. SIGTERM makes it close its links and exit.

```bash
pkill -TERM -x linbpq
for i in $(seq 1 30); do pgrep -x linbpq >/dev/null || break; sleep 1; done
pgrep -x linbpq || echo stopped

# cp, not install: /usr/local/bin is root-owned and cp keeps the file's owner and mode.
# Prefix with sudo if 3.2 said "not writable".
cp ~/barbpq/barbpq-6.0.26.1-N/linbpq /usr/local/bin/linbpq
cmp ~/barbpq/barbpq-6.0.26.1-N/linbpq /usr/local/bin/linbpq && echo "new binary in place"

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

On the gateway, from the bundle directory:

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
./rollback.sh --dry-run     # prints every step, changes nothing
./rollback.sh
```

In order, it:

1. Removes `/home/<user>/HTML/index.html` and `indexnoaprs.html`. It removes `/home/<user>/HTML/ui/` only when `install-state` says the install created it; otherwise only the `ui/` files this bundle shipped. If the install created `/home/<user>/HTML` and it is now empty, that goes too. Nothing else in `HTML/` is touched.
2. If `/usr/local/bin/linbpq` differs from `~/linbpq-6.0.26.1.bak`, stops linbpq (SIGTERM, then SIGKILL after 30 s) and copies the backup over it with `cp`, using sudo when the binary is not writable.
3. On every exit, failure or interruption included, starts linbpq in the tmux session `linbpq` if it is not running (creating the session if it is gone), then reports the pid.

It prints each action and exits 1 if any step failed. Running it again is harmless: each step checks first. The backup is kept.

Every path is an environment variable (`./rollback.sh --help`). `scripts/test_rollback.sh` uses them to run it against a throwaway tree with a fake linbpq and a private tmux server.
