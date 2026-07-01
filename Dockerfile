# syntax=docker/dockerfile:1
FROM debian:bookworm

ARG DEBIAN_FRONTEND=noninteractive

ENV ARCH=riscv \
    CROSS_COMPILE=riscv64-linux-gnu- \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        autoconf \
        automake \
        bc \
        binutils-riscv64-linux-gnu \
        bison \
        build-essential \
        bzip2 \
        ca-certificates \
        cmake \
        cpio \
        curl \
        device-tree-compiler \
        file \
        flex \
        gawk \
        gcc-riscv64-linux-gnu \
        g++-riscv64-linux-gnu \
        git \
        gperf \
        gzip \
        libelf-dev \
        libexpat1-dev \
        libfdt-dev \
        libglib2.0-dev \
        libgmp-dev \
        libmpc-dev \
        libmpfr-dev \
        libncurses-dev \
        libpixman-1-dev \
        libslirp-dev \
        libssl-dev \
        libtool \
        lrzsz \
        make \
        ninja-build \
        patch \
        patchutils \
        pkg-config \
        python3 \
        python3-dev \
        python3-pip \
        python3-setuptools \
        python3-venv \
        qemu-system-misc \
        qemu-utils \
        rsync \
        texinfo \
        u-boot-tools \
        unzip \
        wget \
        xz-utils \
        zlib1g-dev \
        zstd && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        ': "${CROSS_COMPILE:=riscv64-linux-gnu-}"' \
        '"${CROSS_COMPILE}gcc" --version >/dev/null' \
        'dtc --version >/dev/null' \
        'mkimage -V >/dev/null' \
        'qemu-system-riscv64 --version >/dev/null' \
        'echo "build-env ok: ${CROSS_COMPILE}gcc, dtc, mkimage, qemu-system-riscv64"' \
    > /usr/local/bin/toolchain-check && \
    chmod +x /usr/local/bin/toolchain-check

WORKDIR /repo

CMD ["/bin/bash"]
