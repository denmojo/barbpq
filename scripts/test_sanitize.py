import pytest
from sanitize import (LeakError, sanitize_bpq, sanitize_linmail,
                      verify_no_leak)


def test_user_lines_replaced():
    out = sanitize_bpq("PORT\n USER=AD6DM,s3cret,AD6DM,,SYSOP\nENDPORT\n")
    assert "s3cret" not in out and " USER=sysop,staging,N0CALL,,SYSOP" in out


def test_cmspass_replaced():
    assert "hunter2" not in sanitize_bpq(" CMSPASS=hunter2\n")


def test_bbs_user_record_keeps_flags_and_bbsno_only():
    rec = '  RMS = "a^b^c^d^e^f^g^0^16^0^2^0^0^0^x,,^y,,";\n'
    out = sanitize_linmail("BBSUsers : \n{\n" + rec + "};\n")
    assert '^16^' in out and '^2^' in out and 'a^b' not in out and 'x,,' not in out
    assert "  RMS = " in out


def test_bbs_record_matches_template():
    rec = '  RMS = "a^b^c^d^e^f^g^0^16^0^2^0^0^0^x,,^y,,";\n'
    out = sanitize_linmail("BBSUsers : \n{\n" + rec + "};\n")
    assert '"^^^^^^^0^16^0^2^0^0^0^' + "," * 25 + "^" + "," * 25 + '"' in out


def test_any_pass_key_blanked():
    out = sanitize_linmail('  CMSPass = "zz9";\n  POP3Password = "zz9";\n')
    assert "zz9" not in out and 'CMSPass = ""' in out and 'POP3Password = ""' in out


def test_refuses_when_secret_survives():
    with pytest.raises(LeakError):
        verify_no_leak(original=" CMSPASS=abc12345\n", sanitized=" CMSPASS=abc12345\n")


def test_leak_error_names_class_not_value():
    with pytest.raises(LeakError) as e:
        verify_no_leak(original=" CMSPASS=abc12345\n", sanitized=" CMSPASS=abc12345\n")
    assert "abc12345" not in str(e.value) and "pass key" in str(e.value)


def test_clean_sanitize_passes_leak_check():
    orig = " CMSPASS=abc12345\n USER=A,pw123456,A,,SYSOP\n"
    verify_no_leak(orig, sanitize_bpq(orig))


def test_cms_turned_off_but_cmscall_kept():
    out = sanitize_bpq(" CMS=1 ; Enable CMS Gateway\n CMSCALL=AD6DM ; x\n")
    assert " CMS=0 ; Enable CMS Gateway" in out and "CMSCALL=AD6DM" in out


def test_wl2kreport_host_rewritten_other_fields_kept():
    line = (" WL2KREPORT PUBLIC, www.winlink.org, 8778, AD6DM-10, CM98HJ, "
            "00-23, 145630000, VARAFM96, 20, 21, 5, 0\n")
    out = sanitize_bpq("PORT\n" + line + "ENDPORT\n")
    assert "winlink.org" not in out
    assert (" WL2KREPORT PUBLIC, 127.0.0.1, 8778, AD6DM-10, CM98HJ, "
            "00-23, 145630000, VARAFM96, 20, 21, 5, 0") in out


def test_aprs_is_hosts_rewritten():
    out = sanitize_bpq(" ISHOST=rotate.aprs2.net\n APRSISHOST = noam.aprs2.net ;x\n")
    assert "aprs2.net" not in out and out.count("127.0.0.1") == 2


def test_vara_and_direwolf_endpoints_isolated_telnet_untouched():
    cfg = ("PORT\n DRIVER=TELNET\n CONFIG\n TCPPORT=8010\nENDPORT\n"
           "PORT\n DRIVER=VARA\n CONFIG\n ADDR 127.0.0.1 8300\t;ctl\nENDPORT\n"
           "PORT\n TYPE=ASYNC\n IPADDR=10.0.0.9\n TCPPORT=8001\nENDPORT\n")
    out = sanitize_bpq(cfg)
    assert "TCPPORT=8010" in out
    assert "ADDR 127.0.0.1 18300" in out
    assert "IPADDR=127.0.0.1" in out and "TCPPORT=18001" in out
    assert "8300" not in out.replace("18300", "") and "10.0.0.9" not in out


# ---- fix round 1 ----

def test_bpq_unquoted_pass_keys_replaced():
    cfg = (" PASSWORD=sysopsecret\n MQTT_PASS=mqttsecret ; c\n"
           " ISPasscode=12345678\n")
    out = sanitize_bpq(cfg)
    for s in ("sysopsecret", "mqttsecret", "12345678"):
        assert s not in out
    assert " MQTT_PASS=staging ; c" in out
    verify_no_leak(cfg, out)


def test_leak_check_catches_unsanitized_bpq_pass_keys():
    for line in (" PASSWORD=sysopsecret\n", " MQTT_PASS=mqttsecret\n"):
        with pytest.raises(LeakError):
            verify_no_leak(line, line)


def test_leak_check_independent_of_quoting():
    orig = '  Weird_Pass : zz99secret;\n'
    with pytest.raises(LeakError):
        verify_no_leak(orig, orig)


def test_bbsusers_crlf():
    rec = '  RMS = "a1111^b2222^c3333^d^e^f^g^0^16^0^2^0^0^0^x,,^y,,";\r\n'
    out = sanitize_linmail("BBSUsers : \r\n{\r\n" + rec + "};\r\n")
    assert "a1111" not in out and "^16^0^2^" in out


def test_bbsusers_brace_on_same_line():
    rec = '  RMS = "a1111^b2222^c3333^d^e^f^g^0^16^0^2^0^0^0^x,,^y,,";\n'
    out = sanitize_linmail("BBSUsers : {\n" + rec + "};\n")
    assert "a1111" not in out and "b2222" not in out


def test_bbsusers_escaped_quote_in_record():
    rec = '  RMS = "a1111^b\\"2222^c3333^d^e^f^g^0^16^0^2^0^0^0^x,,^y,,";\n'
    text = "BBSUsers : \n{\n" + rec + "};\n"
    out = sanitize_linmail(text)
    assert "b2222" not in out and "a1111" not in out and "^16^0^2^" in out
    verify_no_leak(text, out)


def test_escaped_quote_in_pass_value_fully_blanked():
    text = '  CMSPass = "ab\\"cdSECRET";\n'
    out = sanitize_linmail(text)
    assert "SECRET" not in out and 'CMSPass = "";' in out
    with pytest.raises(LeakError):
        verify_no_leak(text, text)


def test_bbsusers_unparsed_fails_closed():
    with pytest.raises(LeakError, match="BBSUsers unparsed"):
        sanitize_linmail("BBSUsers\n  RMS = whatever\n")
    with pytest.raises(LeakError, match="BBSUsers unparsed"):
        verify_no_leak("BBSUsers\n  RMS = whatever\n", "")


def test_bbsusers_stray_line_fails_closed():
    text = 'BBSUsers : \n{\n  RMS = "a^b^c^d^e^f^g^0^1^0^1^0^0^0^x";\n  junk line\n};\n'
    with pytest.raises(LeakError, match="BBSUsers unparsed"):
        sanitize_linmail(text)
    with pytest.raises(LeakError, match="BBSUsers unparsed"):
        verify_no_leak(text, "")


def test_map_relay_mqtt_hosts_rewritten():
    cfg = (" NODEMAPSERVER=update.g8bpq.net\n CHATMAPSERVER=chatupdate.g8bpq.net\n"
           " RELAYHOST=relay.example.org\n MQTT_HOST=mqtt.example.org ;c\n")
    out = sanitize_bpq(cfg)
    assert "g8bpq" not in out and "example.org" not in out
    assert out.count("127.0.0.1") == 4 and "MQTT_HOST=127.0.0.1 ;c" in out


def test_isp_hosts_blanked():
    out = sanitize_linmail('  ISPSMTPName = "smtp.example.org";\n'
                           '  ISPPOP3Name = "pop.example.org";\n')
    assert "example.org" not in out
    assert 'ISPSMTPName = "";' in out and 'ISPPOP3Name = "";' in out


def test_connect_scripts_blanked_except_rms():
    text = ('BBSForwarding : \n{\n  RMS : \n  {\n    ConnectScript = "C 1 CMS";\n  };\n'
            '  OTHER : \n  {\n    ConnectScript = "C 2 N0XYZ";\n  };\n};\n')
    out = sanitize_linmail(text)
    assert 'ConnectScript = "C 1 CMS";' in out
    assert "N0XYZ" not in out and 'ConnectScript = "";' in out


def test_empty_value_with_comment_is_not_a_secret():
    orig = " CMSPASS= ; CMS gateway password goes here\n"
    verify_no_leak(orig, sanitize_bpq(orig))
