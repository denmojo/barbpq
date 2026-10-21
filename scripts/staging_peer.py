#!/usr/bin/env python3
"""Staging peer node, fake CMS and test traffic for docker/staging.sh --peer.

Local only: this reads and writes staging/ and staging-peer/ on this Mac and
talks to the staging node's telnet port on 127.0.0.1. It never runs on the
gateway and is not part of scripts/sanitize.py, so nothing here can reach it.

  apply      patch staging/bpq32.cfg and staging/linmail.cfg for the peer
             (AXIP port, CMS on with CMSSERVER at the fake CMS, BBS user and
             forwarding record for the peer) and write staging-peer/
  revert     take the peer patch back out of staging/
  mail       post one test message on each BBS addressed to the other
  session S  hold an L4 circuit from the staging node to the peer for S seconds
  rms        make one CMS attempt through the staging node's RMS application

The node must be stopped for apply and revert: linbpq rewrites linmail.cfg.
Every added bpq32.cfg line carries MARK; linmail.cfg loses comments when the
node saves it, so its additions are found by the peer's call instead.

Test callsigns only. The peer is N0PEER (node N0PEER-11, alias PEER), a call
no licensing authority issues. The staging node keeps the call the sanitized
gateway config gives it; the AXIP link and the fake CMS sit on a private
Docker network (NET) that the Mac publishes nothing from.
"""
import os
import re
import shutil
import socket
import sys
import time

MARK = ";staging-peer"
NET = "172.30.249.0/24"
MAIN_IP = "172.30.249.2"
PEER_IP = "172.30.249.3"
CMS_IP = "172.30.249.4"
AXIP_UDP = 10093
PEER_CALL = "N0PEER"
PEER_NODE = "N0PEER-11"
PEER_ALIAS = "PEER"
TELNET = ("127.0.0.1", 18010)
# The sanitized staging config's made-up sysop login (scripts/sanitize.py).
LOGIN = ("sysop", "staging")
USER_CALL = "N0CALL"

_STATS = "," * 25 + "^" + "," * 25


def _user_rec(name, home, flags, bbsno):
    """A BBSUsers value: Name^Address^HomeBBS^QRA^pass^ZIP^CMSPass^lastmsg^
    flags^PageLen^BBSNumber^RMSSSIDBits^WebSeqNo^TimeLastConnected^stats."""
    return "%s^^%s^^^^^0^%d^0^%d^0^0^0^%s" % (name, home, flags, bbsno, _STATS)


F_BBS = 0x10


def _fwd_group(call, script, indent="  "):
    """A BBSForwarding record: forwards new mail at once, no reverse polling.
    A poll would start runs with nothing queued, and a run still waiting for
    its CMS result when the node stops is logged at shutdown, which breaks
    tests/uiapi_endpoints.sh's restart check."""
    i2 = indent + "  "
    rows = [("TOCalls", '""'), ("ConnectScript", '"%s"' % script),
            ("ATCalls", '""'), ("HRoutes", '""'), ("HRoutesP", '""'),
            ("FWDTimes", '""'), ("Enabled", "1"),
            ("RequestReverse", "0"),
            ("AllowBlocked", "1"), ("AllowCompressed", "1"),
            ("UseB1Protocol", "0"), ("UseB2Protocol", "1"), ("SendCTRLZ", "0"),
            ("FWDPersonalsOnly", "0"), ("FWDNewImmediately", "1"),
            ("FwdInterval", "300"), ("RevFWDInterval", "0"),
            ("MaxFBBBlock", "10000"), ("ConTimeout", "120"), ("BBSHA", '""')]
    body = "".join("%s%s = %s;\n" % (i2, k, v) for k, v in rows)
    return "%s%s : \n%s{\n%s%s};\n" % (indent, call, indent, body, indent)


# ---------------------------------------------------------------- bpq32.cfg

def _axip_port(portnum, peer_call, peer_ip):
    lines = [
        "; staging-peer begin: AXIP link to the staging peer, private Docker network only",
        "PORT",
        " PORTNUM=%d" % portnum,
        # No "staging" in the ID: tests/uiapi_endpoints.sh fails any
        # /api/ui/station body that holds the test password's text.
        " ID=AXIP peer link",
        " DRIVER=BPQAXIP",
        " QUALITY=192",
        " MINQUAL=150",
        " CONFIG",
        " MHEARD",
        " UDP %d" % AXIP_UDP,
        " BROADCAST NODES",
        " BROADCAST ID",
        " MAP %s %s UDP %d B" % (peer_call, peer_ip, AXIP_UDP),
        "ENDPORT",
        "; staging-peer end",
    ]
    return "\n".join(lines) + "\n"


def _portnums(text):
    return [int(n) for n in re.findall(r"^\s*PORTNUM\s*=\s*(\d+)", text, re.I | re.M)]


def axip_portnum(text):
    """The port number the patch gives (or gave) the AXIP port."""
    m = re.search(r"^; staging-peer begin.*?^\s*PORTNUM\s*=\s*(\d+)", text, re.M | re.S)
    if m:
        return int(m.group(1))
    return max(_portnums(text) or [0]) + 1


def revert_bpq(text):
    text = re.sub(r"^; staging-peer begin.*?^; staging-peer end\n", "", text,
                  flags=re.M | re.S)
    text = re.sub(r"^.*" + re.escape(MARK) + r"\s*\n", "", text, flags=re.M)
    text = re.sub(r"^" + re.escape(MARK) + r"; ?", "", text, flags=re.M)
    return text


def patch_bpq(text):
    """Add the AXIP port and turn the Telnet port's CMS on at the fake CMS.

    CMSSERVER is an address, so the node never resolves a CMS host name. The
    fake CMS cannot sit on 127.0.0.1:8772 in the staging container: RELAYAPPL
    makes the node itself listen on 0.0.0.0:8772 for relay sessions.
    """
    text = revert_bpq(text)
    portnum = max(_portnums(text) or [0]) + 1

    def telnet_block(m):
        block = m.group(0)
        if not re.search(r"^\s*DRIVER\s*=\s*TELNET\b", block, re.I | re.M):
            return block
        out = []
        for line in block.split("\n"):
            if re.match(r"^\s*(CMS|CMSSERVER)\s*=", line, re.I):
                out.append(MARK + "; " + line)
                if re.match(r"^\s*CMS\s*=", line, re.I):
                    out.append(" CMS=1 " + MARK)
                    out.append(" CMSSERVER=%s %s" % (CMS_IP, MARK))
            else:
                out.append(line)
        return "\n".join(out)

    text = re.sub(r"^\s*PORT\s*$.*?^\s*ENDPORT\s*$", telnet_block, text,
                  flags=re.I | re.M | re.S)
    port = _axip_port(portnum, PEER_NODE, PEER_IP)
    m = re.search(r"^[ \t]*APPLICATION\b", text, re.I | re.M)
    at = m.start() if m else len(text)
    if at and text[at - 1] != "\n":
        port = "\n" + port
    return text[:at] + port + text[at:]


def peer_bpq(main_node):
    return """; Staging peer node. Test callsigns only; private Docker network only.
SIMPLE
LINMAIL
NODECALL=%(node)s
NODEALIAS=%(alias)s
LOCATOR=NONE
IDINTERVAL=5
NODESINTERVAL=5
IDMSG:
%(node)s staging peer (test node, not on the air)
***
INFOMSG:
BarBPQ staging peer
***

PORT
 PORTNUM=1
 ID=AXIP staging node
 DRIVER=BPQAXIP
 QUALITY=192
 MINQUAL=150
 CONFIG
 MHEARD
 UDP %(udp)d
 BROADCAST NODES
 BROADCAST ID
 MAP %(main_node)s %(main_ip)s UDP %(udp)d B
ENDPORT

APPLICATION 1,BBS
""" % {"node": PEER_NODE, "alias": PEER_ALIAS, "udp": AXIP_UDP,
       "main_node": main_node, "main_ip": MAIN_IP}


def node_call(bpq_text):
    m = re.search(r"^\s*NODECALL\s*=\s*([A-Z0-9-]+)", bpq_text, re.I | re.M)
    if not m:
        raise SystemExit("staging/bpq32.cfg has no NODECALL")
    return m.group(1).upper()


# -------------------------------------------------------------- linmail.cfg

def _group_span(text, name, start=0, end=None):
    """(open, close) of `name : { ... };` within text[start:end]: the index of
    its first character and the index just past its `};` line."""
    end = len(text) if end is None else end
    m = re.compile(r"^[ \t]*" + re.escape(name) + r"[ \t]*:[ \t]*\n?[ \t]*\{",
                   re.M | re.I).search(text, start, end)
    if not m:
        return None
    depth, i = 0, m.end() - 1
    while i < end:
        c = text[i]
        if c == '"':
            i += 1
            while i < end and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                close = text.index("\n", i) + 1 if "\n" in text[i:end] else end
                return m.start(), close
        i += 1
    raise SystemExit("linmail.cfg: group %s is not closed" % name)


def bbs_main_call(lm_text):
    m = re.search(r'^\s*BBSName\s*=\s*"([^"]*)"', lm_text, re.M | re.I)
    if not m:
        raise SystemExit("staging/linmail.cfg has no BBSName")
    return m.group(1).upper()


def revert_linmail(text, call=PEER_CALL):
    fwd = _group_span(text, "BBSForwarding")
    if fwd:
        sub = _group_span(text, call, fwd[0] + 1, fwd[1])
        if sub:
            text = text[:sub[0]] + text[sub[1]:]
    users = _group_span(text, "BBSUsers")
    if users:
        body = text[users[0]:users[1]]
        body = re.sub(r"^[ \t]*\*?" + re.escape(call) + r"[ \t]*=.*\n", "", body, flags=re.M)
        text = text[:users[0]] + body + text[users[1]:]
    return text


def _insert_before_close(text, span, chunk):
    close = text.rindex("}", span[0], span[1])
    line = text.rindex("\n", 0, close) + 1
    return text[:line] + chunk + text[line:]


def _bbs_numbers(text):
    users = _group_span(text, "BBSUsers")
    nums = set()
    if users:
        for v in re.findall(r'=\s*"([^"]*)"', text[users[0]:users[1]]):
            f = v.split("^")
            if len(f) > 10 and f[10].isdigit():
                nums.add(int(f[10]))
    return nums


def patch_linmail(text, axip_port):
    """Add the peer as a BBS user and a forwarding record that reaches it."""
    text = revert_linmail(text)
    used = _bbs_numbers(text)
    bbsno = next(n for n in range(1, 161) if n not in used)
    users = _group_span(text, "BBSUsers")
    rec = '  %s = "%s";\n' % (PEER_CALL, _user_rec("Staging peer", "", F_BBS, bbsno))
    if users:
        text = _insert_before_close(text, users, rec)
    else:
        text += "BBSUsers : \n{\n" + rec + "};\n"
    fwd = _group_span(text, "BBSForwarding")
    group = _fwd_group(PEER_CALL, "C %d %s|BBS" % (axip_port, PEER_NODE))
    if fwd:
        text = _insert_before_close(text, fwd, group)
    else:
        text += "BBSForwarding : \n{\n" + group + "};\n"
    return text


def peer_linmail(main_lm, main_bbs, main_node):
    """The staging node's Main and Housekeeping groups with the peer's calls,
    forwarding to the staging BBS only, and its users preset so a scripted
    login meets no new-user questions."""
    out = []
    for name in ("Main", "Housekeeping"):
        span = _group_span(main_lm, name)
        if not span:
            raise SystemExit("staging/linmail.cfg has no %s group" % name)
        out.append(main_lm[span[0]:span[1]])
    text = "".join(out)
    text = re.sub(r"\b" + re.escape(main_bbs) + r"\b", PEER_CALL, text, flags=re.I)
    text = re.sub(r"^(\s*BBSApplNum\s*=\s*)\d+", r"\g<1>1", text, flags=re.M)
    text = re.sub(r"^(\s*LastHouseKeepingTime\s*=\s*)\d+L?", r"\g<1>0L", text, flags=re.M)
    text += "BBSForwarding : \n{\n" + _fwd_group(main_bbs, "C 1 %s|BBS" % main_node) + "};\n"
    text += "BBSUsers : \n{\n"
    text += '  %s = "%s";\n' % (main_bbs, _user_rec("Staging node", "", F_BBS, 2))
    text += '  %s = "%s";\n' % (USER_CALL, _user_rec("Staging test", PEER_CALL, 0, 0))
    text += "};\n"
    return text


# ------------------------------------------------------------------ files

def _read(path):
    with open(path, encoding="latin-1", newline="") as f:
        return f.read()


def _write(path, text):
    with open(path, "w", encoding="latin-1", newline="") as f:
        f.write(text)


def apply(root):
    st, pr = os.path.join(root, "staging"), os.path.join(root, "staging-peer")
    bpq = _read(os.path.join(st, "bpq32.cfg"))
    lm = _read(os.path.join(st, "linmail.cfg"))
    main_node, main_bbs = node_call(bpq), bbs_main_call(lm)
    if PEER_CALL in (main_bbs, main_node.split("-")[0]):
        raise SystemExit("staging node already uses the peer's call")
    bpq = patch_bpq(bpq)
    _write(os.path.join(st, "bpq32.cfg"), bpq)
    _write(os.path.join(st, "linmail.cfg"), patch_linmail(lm, axip_portnum(bpq)))
    # The peer's node and BBS state is throwaway: start it clean each time.
    shutil.rmtree(pr, ignore_errors=True)
    os.makedirs(pr)
    _write(os.path.join(pr, "bpq32.cfg"), peer_bpq(main_node))
    _write(os.path.join(pr, "linmail.cfg"), peer_linmail(lm, main_bbs, main_node))
    print("staging-peer: staging/ patched (AXIP port %d, CMSSERVER %s), staging-peer/ written"
          % (axip_portnum(bpq), CMS_IP))


def revert(root):
    st = os.path.join(root, "staging")
    p = os.path.join(st, "bpq32.cfg")
    _write(p, revert_bpq(_read(p)))
    p = os.path.join(st, "linmail.cfg")
    _write(p, revert_linmail(_read(p)))
    print("staging-peer: peer patch taken out of staging/")


# ---------------------------------------------------------------- telnet

class Telnet:
    """Line-mode client for the node's telnet port. Strips IAC sequences."""

    def __init__(self, addr=TELNET, timeout=20):
        self.s = socket.create_connection(addr, timeout=timeout)
        self.buf = ""
        self.timeout = timeout

    def _recv(self):
        data = self.s.recv(4096)
        if not data:
            raise EOFError("connection closed; got: %r" % self.buf[-300:])
        data = re.sub(rb"\xff[\xfb-\xfe].|\xff[\xf0-\xfa]", b"", data)
        self.buf += data.decode("latin-1")

    def expect(self, pattern, timeout=None):
        end = time.time() + (timeout or self.timeout)
        rx = re.compile(pattern, re.I)
        while True:
            m = rx.search(self.buf)
            if m:
                seen, self.buf = self.buf[:m.end()], self.buf[m.end():]
                return seen
            if time.time() > end:
                raise TimeoutError("no %r; got: %r" % (pattern, self.buf[-300:]))
            self.s.settimeout(max(0.1, end - time.time()))
            try:
                self._recv()
            except socket.timeout:
                pass

    def send(self, line):
        # CR LF, not a bare CR: the node's telnet server takes the byte after
        # a CR as part of the line end, so a bare CR ate the "/" of "/EX".
        self.s.sendall(line.encode("latin-1") + b"\r\n")
        time.sleep(0.3)

    def login(self):
        self.expect(r"user:")
        self.send(LOGIN[0])
        self.expect(r"password:")
        self.send(LOGIN[1])
        end = time.time() + 3
        while time.time() < end:
            self.s.settimeout(0.5)
            try:
                self._recv()
            except socket.timeout:
                pass
        if re.search(r"user:|password:|invalid|failed", self.buf, re.I):
            raise SystemExit("telnet login refused")
        self.buf = ""

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


def _post(t, to_bbs, title):
    """At a BBS prompt: send one personal message to USER_CALL @ to_bbs."""
    t.send("SP %s @ %s" % (USER_CALL, to_bbs))
    t.expect(r"title")
    t.send(title)
    t.expect(r"text|/ex")
    t.send("Test message from the BarBPQ staging preview.")
    t.send("It exercises BBS forwarding over the AXIP link; nothing leaves the Mac.")
    t.send("/EX")
    t.expect(r"de \w+>", 30)
    time.sleep(1)


def mail(root):
    lm = _read(os.path.join(root, "staging", "linmail.cfg"))
    main_bbs = bbs_main_call(lm)
    stamp = time.strftime("%H:%M:%S")
    # 1: on the staging BBS, for the peer: the staging node forwards it.
    t = Telnet()
    t.login()
    t.send("BBS")
    t.expect(r"de \w+>", 30)
    _post(t, PEER_CALL, "Staging to peer %s" % stamp)
    t.send("B")
    t.close()
    print("mail: posted on %s for %s @ %s" % (main_bbs, USER_CALL, PEER_CALL))
    # 2: on the peer BBS, for the staging BBS: the peer forwards it back.
    t = Telnet()
    t.login()
    t.send("C %s" % PEER_ALIAS)
    t.expect(r"Connected to", 60)
    t.send("BBS")
    t.expect(r"de \w+>", 30)
    _post(t, main_bbs, "Peer to staging %s" % stamp)
    t.send("B")
    t.close()
    print("mail: posted on %s for %s @ %s" % (PEER_CALL, USER_CALL, main_bbs))


def session(secs):
    t = Telnet()
    t.login()
    t.send("C %s" % PEER_ALIAS)
    t.expect(r"Connected to", 60)
    print("session: L4 circuit to %s open for %d s (Ctrl-C ends it)" % (PEER_ALIAS, secs))
    try:
        end = time.time() + secs
        while time.time() < end:
            time.sleep(min(30, max(0, end - time.time())))
            if time.time() < end:
                t.send("")           # keeps the circuit busy enough not to idle out
    except KeyboardInterrupt:
        pass
    t.send("B")
    time.sleep(1)
    t.close()
    print("session: closed")


def rms():
    """One CMS attempt: the RMS application dials the CMS through the Telnet
    port, which records reachable or not for /api/ui/cms."""
    t = Telnet()
    t.login()
    t.send("RMS")
    end = time.time() + 8
    while time.time() < end:
        t.s.settimeout(0.5)
        try:
            t._recv()
        except (socket.timeout, EOFError):
            pass
    t.close()
    lines = [l.strip() for l in t.buf.replace("\r", "\n").split("\n") if l.strip()]
    print("rms: " + (" | ".join(lines[-4:]) or "no answer"))


def main(argv):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "apply":
        apply(root)
    elif cmd == "revert":
        revert(root)
    elif cmd == "mail":
        mail(root)
    elif cmd == "rms":
        rms()
    elif cmd == "session":
        session(int(argv[2]) if len(argv) > 2 else 120)
    else:
        sys.stderr.write(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
