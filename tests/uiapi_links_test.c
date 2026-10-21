/* Tests for /api/ui/links over fixture LinBPQ structures: the KISS and AXIP
   field reads in uiapi.c, with real sockets for the AXIP bind checks.
   Built with -DLINBPQ against uiapi.c by `make uitest`; the node globals
   uiapi.c reads are defined here. */

#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#include "../cheaders.h"
#include "../tncinfo.h"
#include "../kiss.h"
#include "../uiapi.h"

UCHAR MYNODECALL[10] = "AD6DM-11  ";
char MYALIASLOPPED[10] = "EGNOD";
char LOCATOR[80] = "";
char TextVerstring[50] = "test";
time_t TimeLoaded;
struct PORTCONTROL *PORTTABLE;
struct TNCINFO *TNCInfo[71];
NPASYINFO KISSInfo[MAXBPQPORTS];
struct AXIPPORTINFO *Portlist[MaxBPQPortNo + 1];

int ConvFromAX25(unsigned char *incall, unsigned char *outcall) { outcall[0] = 0; return 0; }
int send_http_response(char *response, const char *msg) { return 0; }

struct PORTCONTROL *GetPortTableEntryFromPortNum(int n)
{
	struct PORTCONTROL *P;

	for (P = PORTTABLE; P; P = P->PORTPOINTER)
		if (P->PORTNUMBER == n)
			return P;
	return NULL;
}

char *strlop(char *buf, char delim)
{
	char *p = strchr(buf, delim);

	if (!p)
		return NULL;
	*p++ = 0;
	return p;
}

static int passed = 0;
static char resp[250000];

/* The one port's entry in a /api/ui/links reply */
static const char *links_for(int n)
{
	static char want[64], entry[512];
	char *p, *e;

	uiapi_api_links(resp, NULL, "", 1);
	snprintf(want, sizeof want, "{\"number\":%d,", n);
	p = strstr(resp, want);
	assert(p);
	e = strchr(p, '}');
	assert(e && (size_t)(e - p) < sizeof entry);
	memcpy(entry, p, e - p + 1);
	entry[e - p + 1] = 0;
	return entry;
}

/* evidence NULL expects "evidence":null */
static void expect_ev(int n, const char *state, const char *detail, const char *evidence)
{
	char want[512], ev[32];
	const char *got = links_for(n);

	if (evidence)
		snprintf(ev, sizeof ev, "\"%s\"", evidence);
	else
		snprintf(ev, sizeof ev, "null");
	snprintf(want, sizeof want, "{\"number\":%d,\"state\":\"%s\",\"detail\":\"%s\",\"evidence\":%s}",
		n, state, detail, ev);
	if (strcmp(got, want) != 0)
	{
		fprintf(stderr, "port %d: got %s\n          want %s\n", n, got, want);
		assert(0);
	}
}

/* linked ports carry the evidence their driver gives; others null */
static void expect(int n, const char *state, const char *detail)
{
	const char *ev = NULL;

	if (strcmp(state, "linked") == 0)
		ev = n == 4 ? "socket" : n == 7 ? "link" : n == 6 ? "link" : "device";
	expect_ev(n, state, detail, ev);
}

/* A UDP socket bound to 127.0.0.1 on a port the kernel picks; returns the port */
static int bound_udp(int *fd)
{
	struct sockaddr_in a;
	socklen_t len = sizeof a;

	*fd = socket(AF_INET, SOCK_DGRAM, 0);
	assert(*fd > 0);
	memset(&a, 0, sizeof a);
	a.sin_family = AF_INET;
	a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	assert(bind(*fd, (struct sockaddr *)&a, sizeof a) == 0);
	assert(getsockname(*fd, (struct sockaddr *)&a, &len) == 0);
	return ntohs(a.sin_port);
}

static struct KISSINFO kser, kdrop, kslave;
static ASYINFO aser, aslave;
static struct _EXTPORTDATA eax, evara;
static struct TNCINFO *tvara;
static struct AXIPPORTINFO *ax;

static void setup(void)
{
	/* port 2: serial KISS, first port of its device; port 5 shares the device */
	kser.PORT.PORTNUMBER = 2;
	kser.FIRSTPORT = &kser;
	KISSInfo[2] = &aser;
	kdrop.PORT.PORTNUMBER = 5;
	kdrop.FIRSTPORT = &kser;
	/* port 6: KISS TCP slave (TCPPORT with no address) */
	kslave.PORT.PORTNUMBER = 6;
	kslave.PORT.KISSTCP = 1;
	kslave.PORT.KISSSLAVE = 1;
	kslave.FIRSTPORT = &kslave;
	KISSInfo[6] = &aslave;
	/* port 4: BPQAXIP */
	eax.PORTCONTROL.PORTNUMBER = 4;
	eax.PORTCONTROL.PORTTYPE = 0x10;
	memcpy(eax.PORT_DLL_NAME, "BPQAXIP         ", 16);
	ax = calloc(1, sizeof *ax);
	assert(ax);
	Portlist[4] = ax;

	/* port 7: VARA, an external port with a TNCINFO record */
	evara.PORTCONTROL.PORTNUMBER = 7;
	evara.PORTCONTROL.PORTTYPE = 0x10;
	tvara = calloc(1, sizeof *tvara);
	assert(tvara);
	tvara->Hardware = H_VARA;
	TNCInfo[7] = tvara;

	PORTTABLE = &kser.PORT;
	kser.PORT.PORTPOINTER = &kdrop.PORT;
	kdrop.PORT.PORTPOINTER = &eax.PORTCONTROL;
	eax.PORTCONTROL.PORTPOINTER = &kslave.PORT;
	kslave.PORT.PORTPOINTER = &evara.PORTCONTROL;
}

static void test_serial_kiss_fields(void)
{
	aser.idComDev = 7;
	expect(2, "linked", "serial device open");
	expect(5, "linked", "serial device open");	/* multidrop reads the first port's device */
	aser.idComDev = 0;				/* open failed or closed after a read error */
	expect(2, "down", "serial device not open");
	expect(5, "down", "serial device not open");
	aser.idComDev = 7;
	kser.PORT.PortStopped = 1;			/* STOPPORT sets the first port only */
	expect(2, "down", "port stopped");
	expect(5, "down", "port stopped");
	kser.PORT.PortStopped = 0;
	KISSInfo[2] = NULL;				/* no device record */
	expect(2, "unknown", "driver reports no link state");
	KISSInfo[2] = &aser;
	passed++;
}

static void test_kiss_slave_fields(void)
{
	aslave.Connected = 0;
	expect(6, "down", "KISS TCP listening, no client");
	aslave.Connected = 1;
	expect(6, "linked", "KISS TCP client connected");
	passed++;
}

static void test_axip_udp_bind(void)
{
	int fd, fd2, port, tcp;
	struct sockaddr_in to;

	port = bound_udp(&fd);
	ax->NumberofUDPPorts = 1;
	ax->udpsock[0] = fd;
	ax->udpport[0] = port;
	expect(4, "linked", "socket open, no peers mapped");

	ax->udpport[0] = port == 65535 ? 1 : port + 1;	/* bound, but not to the configured port */
	{
		char d[64];
		snprintf(d, sizeof d, "AXIP UDP %d not bound", ax->udpport[0]);
		expect(4, "down", d);
	}

	/* bind failed, then a send made the kernel bind an ephemeral port (S-1) */
	fd2 = socket(AF_INET, SOCK_DGRAM, 0);
	assert(fd2 > 0);
	memset(&to, 0, sizeof to);
	to.sin_family = AF_INET;
	to.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	to.sin_port = htons(9);
	sendto(fd2, "x", 1, 0, (struct sockaddr *)&to, sizeof to);
	ax->udpsock[0] = fd2;
	ax->udpport[0] = 10093;
	expect(4, "down", "AXIP UDP 10093 not bound");

	/* closed by CloseSockets, number still in the struct (M-1) */
	close(fd2);
	expect(4, "down", "AXIP UDP 10093 not bound");

	/* the closed number reused by a TCP socket on the configured port (M-1) */
	ax->udpport[0] = port;
	close(fd);
	tcp = socket(AF_INET, SOCK_STREAM, 0);
	assert(tcp > 0);
	memset(&to, 0, sizeof to);
	to.sin_family = AF_INET;
	to.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	to.sin_port = htons(port);
	if (bind(tcp, (struct sockaddr *)&to, sizeof to) == 0)
	{
		ax->udpsock[0] = tcp;
		{
			char d[64];
			snprintf(d, sizeof d, "AXIP UDP %d not bound", port);
			expect(4, "down", d);
		}
	}
	close(tcp);
	ax->NumberofUDPPorts = 0;
	passed++;
}

static void test_axip_tcp_maps_and_heard(void)
{
	time_t now = time(NULL);

	expect(4, "down", "AXIP socket not open");
	ax->arp_table_len = 2;
	ax->arp_table[0].TCPState = 4;			/* TCPConnected, bpqaxip.c:277 */
	ax->arp_table[0].LastHeard = now - 5;
	ax->arp_table[1].TCPState = 0;
	ax->arp_table[1].LastHeard = 0;
	expect(4, "linked", "socket open, 1 of 2 peers heard in the last hour");
	ax->arp_table[0].TCPState = 1;			/* TCPListening */
	expect(4, "linked", "socket open, 1 of 2 peers heard in the last hour");
	ax->arp_table[0].TCPState = 2;			/* TCPConnecting: nothing open yet */
	expect(4, "down", "AXIP socket not open");
	ax->arp_table_len = 0;
	passed++;
}

static void test_axip_only_through_portlist(void)
{
	Portlist[4] = NULL;				/* an external port that is not AXIP */
	expect(4, "unknown", "driver reports no link state");
	Portlist[4] = ax;
	passed++;
}

static void test_stopped_any_driver(void)
{
	int fd, port;

	tvara->CONNECTED = 1;
	expect(7, "linked", "connected to VARA modem");
	/* STOPPORT sets PortStopped on any port with a stop routine (Cmd.c:5983-5988) */
	evara.PORTCONTROL.PortStopped = 1;
	expect(7, "down", "port stopped");
	evara.PORTCONTROL.PortStopped = 0;
	tvara->CONNECTED = 0;
	expect(7, "down", "VARA modem not connected");

	port = bound_udp(&fd);
	ax->NumberofUDPPorts = 1;
	ax->udpsock[0] = fd;
	ax->udpport[0] = port;
	expect(4, "linked", "socket open, no peers mapped");
	eax.PORTCONTROL.PortStopped = 1;
	expect(4, "down", "port stopped");
	eax.PORTCONTROL.PortStopped = 0;
	kslave.PORT.PortStopped = 1;
	expect(6, "down", "port stopped");
	kslave.PORT.PortStopped = 0;
	close(fd);
	ax->NumberofUDPPorts = 0;
	passed++;
}

static void test_axip_several_udp_and_raw(void)
{
	int fd1, fd2, p1, p2, raw;
	char d[160];

	p1 = bound_udp(&fd1);
	p2 = bound_udp(&fd2);
	ax->NumberofUDPPorts = 3;
	ax->udpsock[0] = fd1;
	ax->udpport[0] = p1;
	ax->udpsock[1] = fd2;
	ax->udpport[1] = p2;
	ax->udpsock[2] = fd2;		/* a third configured port nothing is bound to */
	ax->udpport[2] = p2 == 65535 ? 1 : p2 + 1;
	expect(4, "linked", "2 of 3 UDP ports bound, no peers mapped");
	ax->udpport[0] = ax->udpport[2];
	ax->udpport[1] = ax->udpport[2];
	expect(4, "down", "none of 3 AXIP UDP ports bound");
	/* a TCP map connected beside the unbound UDP ports: still down, and said */
	ax->arp_table_len = 1;
	ax->arp_table[0].TCPState = 4;
	ax->arp_table[0].LastHeard = 0;
	expect(4, "down", "none of 3 AXIP UDP ports bound; 1 TCP map open");
	ax->arp_table[0].TCPState = 0;
	ax->arp_table_len = 0;

	/* the raw IP 93 socket: open is all there is, and the detail says so */
	ax->NumberofUDPPorts = 0;
	raw = socket(AF_INET, SOCK_DGRAM, 0);	/* stands in for the raw socket's number */
	assert(raw > 0);
	ax->needip = 1;
	ax->sock = raw;
	expect(4, "linked", "socket open, no peers mapped, raw IP socket bind not checked");
	ax->needip = 0;
	expect(4, "down", "AXIP socket not open");
	ax->sock = 0;
	close(raw);
	close(fd1);
	close(fd2);
	(void)d;
	passed++;
}

int main(void)
{
	setup();
	test_serial_kiss_fields();
	test_kiss_slave_fields();
	test_axip_udp_bind();
	test_axip_tcp_maps_and_heard();
	test_axip_only_through_portlist();
	test_stopped_any_driver();
	test_axip_several_udp_and_raw();
	printf("uiapi links over node structures: %d passed\n", passed);
	return 0;
}
