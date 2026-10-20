#!/usr/bin/env python3
"""Sanitize the gateway's bpq32.cfg and linmail.cfg for the staging node.

Library use: sanitize_bpq, sanitize_linmail, verify_no_leak.
Remote use:  ssh host 'python3 - --remote' < scripts/sanitize.py
  reads ~/bpq32.cfg and ~/linmail.cfg on the host, sanitizes, runs the leak
  check, and prints one JSON object {"bpq32.cfg": ..., "linmail.cfg": ...}.
  Only sanitized text is ever printed. A leak aborts with exit 3 and a
  message naming the key class only.

Staging carries the gateway's callsign, so besides secrets this also cuts the
node off from the internet: CMS off; WL2KREPORT, APRS-IS, map-server, relay and
MQTT hosts pointed at 127.0.0.1; radio-modem endpoints pointed at unserved
ports; linmail ISP host names and non-RMS connect scripts blanked.
"""
import json
import os
import re
import sys

USER_REPLACEMENT = " USER=sysop,staging,N0CALL,,SYSOP"
BBS_TEMPLATE = ("^^^^^^^0^%d^0^%d^0^0^0^" + "," * 25 + "^" + "," * 25)
LOCAL = "127.0.0.1"
VARA_PORT = "18300"
DIREWOLF_PORT = "18001"
MIN_SECRET_LEN = 4

_USER_RE = re.compile(r"^(\s*)USER\s*=.*$", re.I | re.M)
# Any bpq32.cfg key containing PASS (CMSPASS, PASSWORD, MQTT_PASS, ISPASSCODE ...)
_BPQ_PASS_RE = re.compile(r"^(\s*\w*pass\w*\s*=)[^;\n]*?(\s*)(?=;|$)", re.I | re.M)
_CMS_ON_RE = re.compile(r"^(\s*CMS)\s*=\s*1\b", re.I | re.M)
_WL2K_RE = re.compile(r"^(\s*WL2KREPORT\s+[^,\r\n]+,\s*)[^,\s]+", re.I | re.M)
# Hosts the node would contact with the gateway's callsign.
_HOST_KEY_RE = re.compile(
    r"^(\s*(?:NODEMAPSERVER|CHATMAPSERVER|NODEAPISERVER|RELAYHOST|MQTT_HOST"
    r"|(?:APRS)?IS_?HOST|IGATE_?HOST)\s*=\s*)[^;\s]+", re.I | re.M)
_QUOTED = r'"(?:[^"\\\n]|\\.)*"'
# linmail.cfg: any key containing pass, quoted or bare value
_LM_PASS_RE = re.compile(
    r"^(\s*\w*pass\w*\s*[=:]\s*)(?:" + _QUOTED + r"|[^;\n]*)", re.I | re.M)
_LM_HOST_RE = re.compile(
    r"^(\s*(?:ISPSMTPName|ISPPOP3Name|ISPEHLOName)\s*[=:]\s*)(?:" + _QUOTED
    + r"|[^;\n]*)", re.I | re.M)
_LM_SCRIPT_RE = re.compile(
    r"^(\s*ConnectScript\s*[=:]\s*)(?:" + _QUOTED + r"|[^;\n]*)", re.I)
_LM_HEADER_RE = re.compile(r"^\s*([^\s:=]+)\s*:\s*\{?\s*$")
_BBS_REC_RE = re.compile(r'^(\s*[^\s=]+\s*=\s*)"((?:[^"\\\n]|\\.)*)"(\s*;\s*)$')
_BBS_BLOCK_RE = re.compile(r"BBSUsers\s*:\s*\{(.*?)\}\s*;", re.I | re.S)
_PORT_BLOCK_RE = re.compile(r"^\s*PORT\s*$.*?^\s*ENDPORT\s*$", re.I | re.M | re.S)


class LeakError(Exception):
    """A secret from the original survived into the sanitized text."""


def _norm(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _bbs_users_body(text):
    """Return (start, end) of the BBSUsers body, None if the group is absent.

    Fails closed: the token present but no parseable block, or any non-blank
    body line that is not a plain record, raises LeakError.
    """
    if not re.search(r"BBSUsers", text, re.I):
        return None
    m = _BBS_BLOCK_RE.search(text)
    if not m:
        raise LeakError("BBSUsers unparsed")
    for line in m.group(1).split("\n"):
        if line.strip() and not _BBS_REC_RE.match(line):
            raise LeakError("BBSUsers unparsed")
    return m.start(1), m.end(1)


def _flags_bbsno(fields):
    def num(i):
        try:
            return int(fields[i])
        except (IndexError, ValueError):
            return 0
    return num(8), num(10)


def _isolate_port_block(block):
    """Point VARA ADDR and Direwolf IPADDR/TCPPORT at unserved local ports."""
    if re.search(r"^\s*DRIVER\s*=\s*VARA\b", block, re.I | re.M):
        block = re.sub(r"^(\s*ADDR\s+)\S+(\s+)\d+",
                       lambda m: m.group(1) + LOCAL + m.group(2) + VARA_PORT,
                       block, flags=re.I | re.M)
    if re.search(r"^\s*IPADDR\s*=", block, re.I | re.M):
        block = re.sub(r"^(\s*IPADDR\s*=\s*)[^;\s]+",
                       lambda m: m.group(1) + LOCAL, block, flags=re.I | re.M)
        block = re.sub(r"^(\s*TCPPORT\s*=\s*)\d+",
                       lambda m: m.group(1) + DIREWOLF_PORT, block,
                       flags=re.I | re.M)
    return block


def sanitize_bpq(text):
    text = _norm(text)
    text = _USER_RE.sub(USER_REPLACEMENT, text)
    text = _BPQ_PASS_RE.sub(lambda m: m.group(1) + "staging" + m.group(2), text)
    text = _CMS_ON_RE.sub(lambda m: m.group(1) + "=0", text)
    text = _WL2K_RE.sub(lambda m: m.group(1) + LOCAL, text)
    text = _HOST_KEY_RE.sub(lambda m: m.group(1) + LOCAL, text)
    text = _PORT_BLOCK_RE.sub(lambda m: _isolate_port_block(m.group(0)), text)
    return text


def sanitize_linmail(text):
    text = _norm(text)
    span = _bbs_users_body(text)
    if span:
        def rec(line):
            m = _BBS_REC_RE.match(line)
            if not m:
                return line
            flags, bbsno = _flags_bbsno(m.group(2).split("^"))
            return m.group(1) + '"' + BBS_TEMPLATE % (flags, bbsno) + '"' + m.group(3)
        body = "\n".join(rec(l) for l in text[span[0]:span[1]].split("\n"))
        text = text[:span[0]] + body + text[span[1]:]
    text = _LM_PASS_RE.sub(lambda m: m.group(1) + '""', text)
    text = _LM_HOST_RE.sub(lambda m: m.group(1) + '""', text)
    # Forwarding connect scripts may dial out: blank all but the RMS record's.
    out, header = [], ""
    for line in text.split("\n"):
        h = _LM_HEADER_RE.match(line)
        if h:
            header = h.group(1).upper()
        elif header != "RMS":
            line = _LM_SCRIPT_RE.sub(lambda m: m.group(1) + '""', line)
        out.append(line)
    return "\n".join(out)


def _value_candidates(rest):
    """Every plausible rendering of a secret value on the rest of a line.

    A quoted value ends at its closing quote (backslash escapes allowed); a
    bare value ends at the first ';', which starts a comment.
    """
    rest = rest.strip()
    cands = set()
    m = re.match(r'"((?:[^"\\]|\\.)*)"', rest)
    if m:
        inner = m.group(1)
    elif rest.startswith('"'):
        inner = rest[1:].rstrip(";").strip()      # unterminated: take it all
        cands.add(rest.rstrip(";").strip())
    else:
        inner = rest.split(";", 1)[0].strip()
    cands.add(inner)
    cands.add(inner.replace('\\"', '"'))
    cands.update(inner.split('\\"'))
    return {c for c in cands if c}


def _collect_secrets(original):
    """Return [(key_class, value)] of every secret in the original.

    Deliberately independent of the sanitizer's regexes and looser than them.
    """
    original = _norm(original)
    found = []
    for line in original.split("\n"):
        m = re.match(r"^\s*(\w*)\s*[=:]\s*(.*)$", line)
        if m and re.search(r"pass", m.group(1), re.I):
            for v in _value_candidates(m.group(2)):
                found.append(("pass key", v))
        u = re.match(r"^\s*USER\s*=(.*)$", line, re.I)
        if u:
            parts = u.group(1).split(";", 1)[0].split(",")
            if len(parts) > 1:
                found.append(("USER password", parts[1].strip()))
    span = _bbs_users_body(original)
    if span:
        for line in original[span[0]:span[1]].split("\n"):
            m = _BBS_REC_RE.match(line)
            if m:
                for i, f in enumerate(m.group(2).split("^")[:7]):
                    found.append(("BBS user field %d" % i, f.strip()))
    return [(k, v) for k, v in found if len(v) >= MIN_SECRET_LEN]


def verify_no_leak(original, sanitized):
    sanitized = _norm(sanitized)
    for key_class, value in _collect_secrets(original):
        if value in sanitized:
            raise LeakError("secret of class '%s' survived sanitizing" % key_class)


def _remote():
    out = {}
    for name, fn in (("bpq32.cfg", sanitize_bpq), ("linmail.cfg", sanitize_linmail)):
        with open(os.path.expanduser("~/" + name), encoding="latin-1", newline="") as f:
            original = f.read()
        clean = fn(original)
        try:
            verify_no_leak(original, clean)
        except LeakError as e:
            sys.stderr.write("%s: %s\n" % (name, e))
            sys.exit(3)
        out[name] = clean
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    if "--remote" in sys.argv[1:]:
        _remote()
    else:
        sys.stderr.write("usage: sanitize.py --remote (reads ~/bpq32.cfg, ~/linmail.cfg)\n")
        sys.exit(2)
