FROM --platform=linux/amd64 debian:bookworm-slim

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
