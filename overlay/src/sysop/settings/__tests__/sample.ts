// A bpq32.cfg shaped like the staging node's, with test-only secrets.
export const USER_PASSWORD = 'hunter2x';
export const CMS_PASSWORD = 'cmsSecret9';

export const SAMPLE_CFG = `; Basic RMS configuration

SIMPLE ; defaults

LINMAIL
LOCATOR=CM98hj
NODEALIAS=EGNOD
NODECALL=AD6DM-11 ; node call
IDMSG:
AD6DM-10 linbpq VARA FM ; kept as text
***
IDINTERVAL=15

/* old ports
PORT
*/

PORT
 PORTNUM=1
 ID=Telnet Server
 DRIVER=TELNET
 CONFIG
 CMSCALL=AD6DM
 CMSPASS=${CMS_PASSWORD} ; Secure CMS Password
 HTTPPORT=8088
 USER=sysop,${USER_PASSWORD},N0CALL,,SYSOP
 USER=guest,${USER_PASSWORD}g,KX6ABC,BBS
 CTEXT=Welcome.
ENDPORT

PORT
 PORTNUM=3
 ID=VARA FM
 DRIVER=VARA
 CONFIG
 ADDR 127.0.0.1 18300	;VARA FM Control port
ENDPORT

PORT
 PORTNUM=2
 ID=Direwolf
 TYPE=ASYNC
 PROTOCOL=KISS
 TXDELAY=500
 TXTAIL=50 ; tail
 IPADDR=127.0.0.1
 TCPPORT=18001
ENDPORT

APPLICATION 1,RMS,C 1 CMS,AD6DM-10,,0
APPLICATION 2,BBS
`;

/** The Edit Config page the node serves, with the config written raw into the textarea. */
export const editPage = (cfg: string, key = 'N1'): string =>
  `<html><head><title>Edit Config</title></head><body><form style="font-family: monospace;"method=post action=CFGSave?${key}\n\n><textarea cols=100 rows=25 name=Msg>${cfg}</textarea><br><br><input name=Save value=Save type=submit class='btn'><input name=Cancel value=Cancel type=submit class='btn'><br></form></body></html>`;

export const SAVED_REPLY = '<html><script>alert("Configuration Saved, Orig Length 10 New Length 16");window.close();</script></html>';
