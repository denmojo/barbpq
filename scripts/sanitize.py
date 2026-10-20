#!/usr/bin/env python3
"""Sanitize the gateway's bpq32.cfg and linmail.cfg for the staging node.

Library use: sanitize_bpq, sanitize_linmail, verify_no_leak.
Remote use:  ssh host 'python3 - --remote' < scripts/sanitize.py
  reads ~/bpq32.cfg and ~/linmail.cfg on the host, sanitizes, runs the leak
  check, and prints one JSON object {"bpq32.cfg": ..., "linmail.cfg": ...}.
  Only sanitized text is ever printed. A leak aborts with exit 3 and a
  message naming the key class only.

Staging carries the gateway's callsign, so besides secrets this also cuts the
node off from Winlink and APRS-IS: CMS off, WL2KREPORT and APRS-IS hosts
pointed at 127.0.0.1, and radio-modem endpoints pointed at unserved ports.
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
_CMSPASS_RE = re.compile(r"^(\s*CMSPASS\s*=)[^;\r\n]*", re.I | re.M)
_CMS_ON_RE = re.compile(r"^(\s*CMS)\s*=\s*1\b", re.I | re.M)
_WL2K_RE = re.compile(r"^(\s*WL2KREPORT\s+[^,\r\n]+,\s*)[^,\s]+", re.I | re.M)
_APRS_HOST_RE = re.compile(
    r"^(\s*(?:IS|APRSIS|APRS_IS|IGATE)_?HOST\s*=\s*)[^;\s]+", re.I | re.M)
_PASS_KEY_RE = re.compile(r'^(\s*\w*pass\w*\s*=\s*)"([^"]*)"', re.I | re.M)
_BBS_REC_RE = re.compile(r'^(\s*[^\s=]+\s*=\s*)"([^"]*)"(\s*;)', re.M)
_PORT_BLOCK_RE = re.compile(r"^\s*PORT\s*$.*?^\s*ENDPORT\s*$", re.I | re.M | re.S)


class LeakError(Exception):
    """A secret from the original survived into the sanitized text."""


def _bbs_users_span(text):
    m = re.search(r"^BBSUsers\s*:\s*\n\s*\{\n(.*?)^\};", text, re.M | re.S)
    return (m.start(1), m.end(1)) if m else None


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
    text = _USER_RE.sub(USER_REPLACEMENT, text)
    text = _CMSPASS_RE.sub(lambda m: m.group(1) + "staging", text)
    text = _CMS_ON_RE.sub(lambda m: m.group(1) + "=0", text)
    text = _WL2K_RE.sub(lambda m: m.group(1) + LOCAL, text)
    text = _APRS_HOST_RE.sub(lambda m: m.group(1) + LOCAL, text)
    text = _PORT_BLOCK_RE.sub(lambda m: _isolate_port_block(m.group(0)), text)
    return text


def sanitize_linmail(text):
    span = _bbs_users_span(text)
    if span:
        def rec(m):
            fields = m.group(2).split("^")
            flags, bbsno = _flags_bbsno(fields)
            return m.group(1) + '"' + BBS_TEMPLATE % (flags, bbsno) + '"' + m.group(3)
        body = _BBS_REC_RE.sub(rec, text[span[0]:span[1]])
        text = text[:span[0]] + body + text[span[1]:]
    return _PASS_KEY_RE.sub(lambda m: m.group(1) + '""', text)


def _collect_secrets(original):
    """Return [(key_class, value)] of every secret in the original."""
    found = []
    for m in _USER_RE.finditer(original):
        line = m.group(0).split(";", 1)[0]
        parts = line.split("=", 1)[1].split(",")
        if len(parts) > 1:
            found.append(("USER password", parts[1].strip()))
    for m in re.finditer(r"^\s*CMSPASS\s*=\s*([^;\r\n]*)", original, re.I | re.M):
        found.append(("CMSPASS", m.group(1).strip()))
    span = _bbs_users_span(original)
    if span:
        for m in _BBS_REC_RE.finditer(original[span[0]:span[1]]):
            for i, f in enumerate(m.group(2).split("^")[:7]):
                found.append(("BBS user field %d" % i, f.strip()))
    for m in _PASS_KEY_RE.finditer(original):
        found.append(("pass key", m.group(2)))
    return [(k, v) for k, v in found if len(v) >= MIN_SECRET_LEN]


def verify_no_leak(original, sanitized):
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
