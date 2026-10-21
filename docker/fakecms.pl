#!/usr/bin/perl
# Fake CMS for the staging preview (docker/staging.sh up --peer).
# Accepts TCP on 8772, the port linbpq dials for a CMS, sends one line and
# closes. It forwards nothing and opens no connection of its own: enough for
# the staging node to record the CMS as reachable.
# SIGUSR1 closes the listener, so a connect is refused at once (a stopped
# container would leave the address silent and the node waiting out a TCP
# timeout); SIGUSR2 opens it again. docker/staging.sh cms off|on sends them.
use strict;
use warnings;
use IO::Socket::INET;

$| = 1;
my $s;
my $want = 1;
$SIG{USR1} = sub { $want = 0 };
$SIG{USR2} = sub { $want = 1 };

while (1) {
  if ($want && !$s) {
    $s = IO::Socket::INET->new(LocalPort => 8772, Listen => 5, ReuseAddr => 1)
      or die "fakecms: listen on 8772: $!\n";
    print "fakecms: listening on 8772\n";
  } elsif (!$want && $s) {
    close $s;
    undef $s;
    print "fakecms: listener closed, connects are refused\n";
  }
  if (!$s) {
    sleep 1;
    next;
  }
  my $c = $s->accept or next;    # a signal interrupts accept
  printf "fakecms: %s connect from %s\n", scalar gmtime, $c->peerhost // '?';
  print $c "Staging fake CMS: no service here\r\n";
  close $c;
}
