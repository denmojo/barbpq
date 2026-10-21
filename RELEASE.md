# Releasing BarBPQ

This file covers building a release bundle, publishing the fork, installing on the gateway, checking it live, and rolling back. Building is safe to run at any time and never contacts a node.

Assumed below:linbpq runs from `/usr/local/bin/linbpq` with the login user's home directory as its working directory, inside the tmux session `linbpq`, started by hand (no systemd unit, no cron). Its web port is 8088. `~/HTML` does not exist yet. Version 6.0.26.1 is installed, and an older backup `~/linbpq-6.0.24.34.bak` exists.

The gateway's address and login stay out of this repository. Set them in the build host's shell before sections 3 and 4:

```bash
GW=user@host                 # the gateway's ssh login
NODE=http://host:8088        # its web port
```

`scripts/fetch-staging-config.sh` reads the same login from `BARBPQ_GATEWAY` or from the untracked file `scripts/gateway.local`.

Never run `linbpq -v` (or any other `linbpq` invocation) on the gateway to check a version: it starts a second node.

## 1. Build the bundle (build host)

```bash
KEEP_DOCKER=1 scripts/release.sh
```

It refuses to run from a tree with uncommitted changes unless `BARBPQ_ALLOW_DIRTY=1` is set. It runs the sanitizer tests, the rollback tests, the C tests (`docker/build.sh test`) and the web UI tests, then builds `out/linbpq` and `overlay/dist/`. Before assembling, it checks that the binary is a 64-bit x86-64 ELF and that `overlay/dist` holds only `.html`, `.js` and `.css` files, none containing `##`, with `index.html` byte-identical to `indexnoaprs.html` and every `ui/*.js` opening with the third-party license banner. It writes the bundle to `out/release/barbpq-<upstream version>-<n>/`, with `<n>` the next unused number:

```
linbpq        the node binary
rollback.sh   run on the gateway to start linbpq, or to undo the install
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

Steps 3.1 and 3.2 change nothing on the gateway. Step 3.3 adds files and changes nothing the node uses. Step 3.4 takes the gateway off the air for the length of a restart.

### 3.1 Copy and verify the bundle

From the build host (`N` is the bundle number):

```bash
ssh "$GW" 'mkdir -p ~/barbpq'
scp -rp out/release/barbpq-6.0.26.1-N "$GW":~/barbpq/
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

Run 3.2 to 3.4 in the same shell: 3.4 uses the `S` and `C` set here.

```bash
B=/usr/local/bin/linbpq

# Can this user write /usr/local/bin? The new binary is moved into place with mv,
# which needs write access to the directory. Sets S for 3.4.
if test -w /usr/local/bin; then S=; echo "no sudo needed for the move"; else S=sudo; echo "sudo needed for the move"; fi
# Does this user own the binary? Giving the staged copy another user's ownership
# needs sudo even in a writable directory. Sets C for 3.4.
if [ "$(stat -c %u $B)" = "$(id -u)" ]; then C=$S; else C=sudo; fi
echo "binary owner $(stat -c %U $B); chown ${C:-without sudo}"
sudo -n true 2>/dev/null && echo "sudo works without a password" || echo "sudo will prompt (or is not allowed)"

# The running node, its arguments, working directory and version, without starting a second one
pgrep -a -x linbpq                                   # exactly one line
P=$(pgrep -x linbpq)
tr '\0' ' ' </proc/$P/cmdline; echo                  # e.g. "/usr/local/bin/linbpq mail"
readlink /proc/$P/cwd                                # the working directory
ls "$(readlink /proc/$P/cwd)"                        # the data files 3.4 snapshots (DIRMES.SYS, linmail.cfg, ...)
curl -s http://127.0.0.1:8088/api/info               # "Version":"6.0.26.1"
grep -a -c '6\.0\.26\.1' $B                          # 1 or more

# How it sits in tmux. A parent that is the tmux server, and a pane whose
# command is linbpq, mean linbpq is the pane's own process: stopping it closes
# the pane, and the session too if that was its only window. rollback.sh --start
# (3.4) handles that; this records what to expect.
ps -o pid=,ppid=,args= -p $P
ps -o pid=,args= -p $(ps -o ppid= -p $P)
tmux list-panes -s -t linbpq -F '#{window_index}.#{pane_index} #{pane_current_command} pid #{pane_pid}'
tmux capture-pane -p -t linbpq | tail -5

# Is the BBS loaded? Note the answer; 4 checks it again after the restart.
curl -s http://127.0.0.1:8088/Node/NodeMenu.html | grep -c 'Mail Mgmt'   # 1: the BBS is loaded
```

### 3.3 Back up the binary, record the node, install the UI

```bash
cd ~/barbpq/barbpq-6.0.26.1-N

# Keep the current binary. Never overwrite an existing backup.
[ -e ~/linbpq-6.0.26.1.bak ] || cp -p /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak
cmp /usr/local/bin/linbpq ~/linbpq-6.0.26.1.bak && echo "backup matches"

# Record, in ~/barbpq/install-state (shared by every bundle): the HTML directory
# it describes (html=), whether ~/HTML and ~/HTML/ui exist yet, and the running
# node's arguments and working directory. rollback.sh reads it to remove only
# what the install added, and every start reuses the arguments and directory.
# A re-run never turns a recorded html_created=1 or ui_created=1 back into 0.
# Both refuse when BARBPQ_HTML names another directory than html=.
# A record left by an earlier bundle (-3 or before) has no html= line; when it
# says html_created=1 or ui_created=1, both refuse until one is added. Add
# html=<the directory that install copied into> to it by hand, then go on.
./rollback.sh --record-install-state
cat ~/barbpq/install-state       # args= must match the cmdline read in 3.2, less argv[0]

mkdir -p ~/HTML
cp -R HTML/. ~/HTML/
ls -la ~/HTML ~/HTML/ui
```

### 3.4 Replace the binary and restart

The new binary is staged next to the old one and moved over it with `mv -f`, so `/usr/local/bin/linbpq` is never half-written. Staging happens while linbpq still runs; only the move waits for the stop. SIGTERM makes linbpq close its links and exit. Each block ends in a gate line; go on only when it prints the line named.

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
B=/usr/local/bin/linbpq; T=$B.install-tmp
[ -n "$S$C" ] && sudo -v                     # ask for the password now, before anything stops

# Stage and check the copy, with the old file's mode and owner.
$S rm -f "$T" \
  && $S cp linbpq "$T" \
  && cmp linbpq "$T" \
  && $S chmod --reference="$B" "$T" \
  && $C chown --reference="$B" "$T" \
  && echo "STAGED OK" \
  || { echo "STAGING FAILED: stop here"; $S rm -f "$T"; }
```

Go on only on `STAGED OK`. On `STAGING FAILED` linbpq is still running and nothing has changed; the staged file is already removed.

```bash
# Stop gate: SIGTERM, wait, SIGKILL, check again.
pkill -TERM -x linbpq
for i in $(seq 1 30); do pgrep -x linbpq >/dev/null || break; sleep 1; done
if pgrep -x linbpq >/dev/null; then
  pkill -KILL -x linbpq; sleep 3
fi
pgrep -a -x linbpq && echo "STILL RUNNING: stop here" || echo STOPPED
```

Go on only on `STOPPED`. On `STILL RUNNING`, remove the staged file (`$S rm -f "$T"`) and move nothing.

With the node stopped its data files are at rest. Snapshot them before the new build first opens them, so a rollback can bring back what the old build wrote (see 5.2). Never overwrite an existing snapshot: a second install would replace it with files the new build has written.

```bash
WD=$(grep '^workdir=' ~/barbpq/install-state | cut -d= -f2-); WD=${WD:-$HOME}
SNAP=~/barbpq/data-before-install.tgz
CORE="DIRMES.SYS WFBID.SYS linmail.cfg bpq32.cfg"
MORE="WP.SYS WP.cfg BPQBBSUsers.dat BADWORDS.SYS UserList.csv chatconfig.cfg BPQNODES.dat MHSave.txt"
F=$(cd "$WD" && ls -d $CORE $MORE 2>/dev/null)
if [ -e "$SNAP" ]; then echo "SNAPSHOT KEPT (from an earlier install)";
elif tar czf "$SNAP" -C "$WD" $F && L=$(tar tzf "$SNAP"); then
  echo "$L"; MISS=
  for n in $CORE; do printf '%s\n' "$L" | grep -qxF "$n" || MISS="$MISS $n"; done
  for n in $MORE; do printf '%s\n' "$L" | grep -qxF "$n" || echo "not in $WD: $n"; done
  if [ -z "$MISS" ]; then echo "SNAPSHOT OK";
  else rm -f "$SNAP"; echo "SNAPSHOT INCOMPLETE, missing:$MISS: stop here"; fi
else rm -f "$SNAP"; echo "SNAPSHOT FAILED: stop here"; fi
```

The block lists the archived names and checks them against the two lists. Every node with a BBS has the four in `CORE` in its data directory. A `not in` line for a name in `MORE` is expected when the node has no such file (no chat, no bad-words list, no white pages yet); compare those lines with the `ls` from 3.2 and go on.

Go on only on `SNAPSHOT OK` or `SNAPSHOT KEPT`. On `SNAPSHOT INCOMPLETE`, the data sits somewhere other than the recorded working directory (a node started with `-c <dir>`, or a BBS base directory set in the config): the archive has been removed, so run `./rollback.sh --start` to bring the node back as it was, remove the staged file, find the directory that holds the named files, and snapshot from there (set `WD` to it) before trying again. On `SNAPSHOT FAILED` the old binary is still in place: do the same, and sort out the snapshot before trying again. The snapshot leaves out `Mail/` (message text, which the new build does not rewrite) and the logs.

```bash
$S mv -f "$T" "$B" && cmp linbpq "$B" && echo "NEW BINARY IN PLACE"

# Start linbpq in its tmux session with the recorded working directory and
# arguments. It creates the session if stopping linbpq closed it, and uses a
# new window if the pane is not at a shell prompt.
./rollback.sh --start
tr '\0' ' ' </proc/$(pgrep -x linbpq)/cmdline; echo   # the same arguments as in 3.2
```

`rollback.sh --start` prints the pid and command line of the node it started, and exits 1 if linbpq is not running 15 seconds later. Should the new binary fail to start, run `./rollback.sh` from the bundle directory right away (see section 5).

## 4. Live checks

From the build host:

```bash
curl -s "$NODE/api/ui/station"                              # JSON answer
curl -s "$NODE/" | head -5                                  # the new home page (index.html)
curl -s -o /dev/null -w '%{http_code}\n' "$NODE/Node/NodeIndex.html"
curl -s -o /dev/null -w '%{http_code}\n' "$NODE/Mail/Header"
curl -s "$NODE/Node/NodeMenu.html" | grep -c 'Mail Mgmt'    # 1: the BBS is loaded
curl -s -o /dev/null -w '%{http_code}\n' "$NODE/api/ui/events"   # 401: sysop only
```

Expected:

- `/api/ui/station` and the new home page answer on port 8088.
- The node menu still offers Mail Mgmt, as it did in 3.2. The node adds that link only when the BBS was loaded at start, by the `mail` argument or by the config.
- Signed in on the new UI, Health shows the BBS card reading Running, with the BBS call and its user count.
- On a Winlink RMS gateway, a session from a Winlink client reaches the CMS as it did before.
- The old `/Node/` and `/Mail/` pages still answer.
- `/api/ui/events` refuses a caller without a sysop session.

Any failure here is a reason to roll back.

## 5. Roll back

### 5.1 The binary and the UI

On the gateway, from the bundle directory, in an SSH shell of its own (not the linbpq tmux pane):

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
./rollback.sh --dry-run     # prints every step, changes nothing
./rollback.sh
```

In order, it:

1. Removes `~/HTML/index.html` and `indexnoaprs.html`. It removes `~/HTML/ui/` only when `~/barbpq/install-state` says the install created it; otherwise only the `ui/` files this bundle shipped. If the install created `~/HTML` and it is now empty, that goes too. Nothing else in `HTML/` is touched.
2. If `/usr/local/bin/linbpq` differs from `~/linbpq-6.0.26.1.bak`, copies the backup to `/usr/local/bin/linbpq.rollback-tmp` and checks it with `cmp` while linbpq still runs, giving it the installed file's mode and owner. Then it stops linbpq (SIGTERM, then SIGKILL after 30 s) and moves the copy over the binary with `mv -f`. When `/usr/local/bin` is not writable it uses sudo for the copy and the move; when the binary belongs to another user it uses sudo for the chown; either way it runs `sudo -v` before anything stops. A failed or interrupted copy leaves `/usr/local/bin/linbpq` untouched and the temp file removed.
3. On every exit, failure or interruption included, it first finishes a stop already begun (sending the SIGTERM if an interruption came before it went out, waiting for the old process to exit, with SIGKILL as the last step), then starts linbpq as `rollback.sh --start` does: in the tmux session `linbpq`, with the recorded working directory and arguments, creating the session if it is gone. It reports the pid.

It prints each action and exits 1 if any step failed. Running it again is harmless: each step checks first. The backup is kept.

A browser that loaded the new UI may keep `index.html` in its cache for a while after the rollback and show a blank page. Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac) to get the old node menu.

### 5.2 The data files, only if the old build cannot read them

The rollback restores the binary only. If the old build then misreads the BBS data the new build wrote (messages or users missing or garbled, the BBS failing to start), put back the snapshot from 3.4. This discards every message, user and setting change since the install.

```bash
cd ~/barbpq/barbpq-6.0.26.1-N
pkill -TERM -x linbpq
for i in $(seq 1 30); do pgrep -x linbpq >/dev/null || break; sleep 1; done
pgrep -a -x linbpq && echo "STILL RUNNING: stop here" || echo STOPPED
```

Go on only on `STOPPED`:

```bash
WD=$(grep '^workdir=' ~/barbpq/install-state | cut -d= -f2-); WD=${WD:-$HOME}
A=~/barbpq/data-after-install-$(date +%Y%m%d-%H%M%S)
pgrep -a -x linbpq && echo "STILL RUNNING: stop here" || {
  mkdir "$A" \
  && tar tzf ~/barbpq/data-before-install.tgz | while read -r f; do
       [ ! -e "$WD/$f" ] || cp -p "$WD/$f" "$A"/ || exit 1; done \
  && tar xzf ~/barbpq/data-before-install.tgz -C "$WD" \
  && echo "DATA RESTORED; the new build's files are in $A" \
  || echo "RESTORE FAILED: stop here"; }
```

The block checks again that linbpq is stopped before it touches anything. Each run keeps the files the new build wrote in a directory of its own, named for the time it ran, and refuses when that directory already exists, so a second run never overwrites the copies an earlier run kept.

On `DATA RESTORED`, start the node:

```bash
./rollback.sh --start
```

On `STILL RUNNING`, run the stop block above again. On `RESTORE FAILED`, look at the message above it: a failure before the `tar xzf` line has changed nothing in `$WD`, and `./rollback.sh --start` brings the node back on the data as it was; a failure in `tar xzf` may have restored some files and not others, so copy the saved files back from `$A` (`cp -p "$A"/* "$WD"/`) before starting the node.

Every path `rollback.sh` uses is an environment variable (`./rollback.sh --help`). `scripts/test_rollback.sh` uses them to run it against a throwaway tree with a fake linbpq and a private tmux server.
