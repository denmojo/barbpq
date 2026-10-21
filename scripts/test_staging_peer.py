from staging_peer import (CMS_IP, MARK, PEER_CALL, PEER_IP, PEER_NODE,
                          axip_portnum, patch_bpq, patch_linmail, peer_bpq,
                          peer_linmail, revert_bpq, revert_linmail)

BPQ = """SIMPLE
NODECALL=XX1XX-11
PORT
 PORTNUM=1
 DRIVER=TELNET
 CONFIG
 CMS=0 ; Enable CMS Gateway
 CMSPASS=staging
ENDPORT

PORT
 PORTNUM=3
 DRIVER=VARA
 CONFIG
 CMS=0
ENDPORT

APPLICATION 1,RMS,C 1 CMS,XX1XX-10,,0
APPLICATION 2,BBS
"""

LM = """main :
{
  Streams = 10;
  BBSApplNum = 2;
  BBSName = "XX1XX";
  SYSOPCall = "XX1XX";
  Prompt = "de XX1XX>\\r\\n";
};
BBSForwarding :
{
  RMS :
  {
    ConnectScript = "ATTACH 1|C CMS";
    Enabled = 1;
  };
};
Housekeeping :
{
  LastHouseKeepingTime = 1792540811L;
  MaxMsgno = 60000;
};
BBSUsers :
{
  RMS = "^^^^^^^0^16^0^2^0^0^0^,,^,,";
  XX1XX = "^^^^^^^0^16^0^1^0^0^0^,,^,,";
  N0CALL = "B^^^^^^^3^73728^0^160^0^0^0^1,,^,,";
};
"""


def test_bpq_patch_round_trips_exactly():
    assert revert_bpq(patch_bpq(BPQ)) == BPQ


def test_bpq_patch_is_idempotent():
    once = patch_bpq(BPQ)
    assert patch_bpq(once) == once


def test_bpq_patch_adds_axip_port_after_last_portnum():
    out = patch_bpq(BPQ)
    assert axip_portnum(out) == 4
    assert " DRIVER=BPQAXIP" in out
    assert " MAP %s %s UDP 10093 B" % (PEER_NODE, PEER_IP) in out
    assert out.index("DRIVER=BPQAXIP") < out.index("APPLICATION 1,RMS")


def test_bpq_patch_turns_cms_on_at_an_address_on_the_telnet_port_only():
    out = patch_bpq(BPQ)
    telnet = out[:out.index("PORTNUM=3")]
    assert " CMS=1 " + MARK in telnet
    assert " CMSSERVER=%s %s" % (CMS_IP, MARK) in telnet
    assert MARK + ";  CMS=0 ; Enable CMS Gateway" in telnet
    vara = out[out.index("PORTNUM=3"):]
    assert " CMS=0\n" in vara and "CMSSERVER" not in vara


def test_linmail_patch_round_trips_exactly():
    assert revert_linmail(patch_linmail(LM, 4)) == LM


def test_linmail_patch_adds_bbs_user_with_free_number_and_record():
    out = patch_linmail(LM, 4)
    assert '  %s = "Staging peer^^^^^^^0^16^0^3^' % PEER_CALL in out
    assert 'RequestReverse = 0;' in out and 'RevFWDInterval = 0;' in out
    assert 'ConnectScript = "C 4 %s|BBS";' % PEER_NODE in out
    # the record sits inside BBSForwarding, before Housekeeping
    assert out.index(PEER_CALL + " : ") < out.index("Housekeeping")


def test_linmail_revert_after_node_rewrote_the_user_record():
    out = patch_linmail(LM, 4).replace("^0^16^0^3^0^0^0^", "^5^16^0^3^0^0^1792540999^")
    assert revert_linmail(out) == LM


def test_peer_configs_use_only_the_peer_and_staging_calls():
    bpq = peer_bpq("XX1XX-11")
    assert "NODECALL=%s" % PEER_NODE in bpq and "MAP XX1XX-11 " in bpq
    lm = peer_linmail(LM, "XX1XX", "XX1XX-11")
    assert 'BBSName = "%s"' % PEER_CALL in lm and 'Prompt = "de %s>' % PEER_CALL in lm
    assert "BBSApplNum = 1;" in lm and "LastHouseKeepingTime = 0L;" in lm
    assert 'ConnectScript = "C 1 XX1XX-11|BBS";' in lm
    # the staging calls appear only as the forwarding partner: group, script, BBS user
    assert lm.count("XX1XX") == 3
