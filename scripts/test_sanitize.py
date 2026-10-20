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
    assert "abc12345" not in str(e.value) and "CMSPASS" in str(e.value)


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
