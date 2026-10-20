# build.sh passes --platform linux/amd64 to docker build.
FROM debian:bookworm-slim

# Upstream's makefile ends with `sudo setcap ...`. The container has no sudo,
# and capabilities set here would not survive copying the binary out, so the
# shim reports the call and succeeds.
RUN printf '#!/bin/sh\necho "sudo shim: skipped: $*" >&2\nexit 0\n' > /usr/local/bin/sudo \
 && chmod +x /usr/local/bin/sudo

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git autoconf automake libtool \
      libpaho-mqtt-dev libjansson-dev libminiupnpc-dev zlib1g-dev \
      libconfig-dev libpcap-dev \
 && rm -rf /var/lib/apt/lists/*

# libbacktrace-dev is not packaged in bookworm; build it from source.
RUN git clone https://github.com/ianlancetaylor/libbacktrace /tmp/libbacktrace \
 && cd /tmp/libbacktrace \
 && git checkout 0b9b49cf4a2c9229fc052d6716e1528b2f23e91a \
 && ./configure --prefix=/usr/local \
 && make -j2 \
 && make install \
 && ldconfig \
 && rm -rf /tmp/libbacktrace

WORKDIR /src
