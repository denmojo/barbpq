FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git autoconf automake libtool \
      libpaho-mqtt-dev libjansson-dev libminiupnpc-dev zlib1g-dev \
      libconfig-dev libpcap-dev \
 && rm -rf /var/lib/apt/lists/*

# libbacktrace-dev is not packaged in bookworm; build it from source.
RUN git clone --depth 1 https://github.com/ianlancetaylor/libbacktrace /tmp/libbacktrace \
 && cd /tmp/libbacktrace \
 && ./configure --prefix=/usr/local \
 && make -j2 \
 && make install \
 && ldconfig \
 && rm -rf /tmp/libbacktrace

WORKDIR /src
