FROM ubuntu:focal
ARG DEBIAN_FRONTEND=noninteractive

RUN echo "rebuild n.5"
RUN apt-get update
RUN apt-get install -y wget git qemu-system qemu-utils python3 python3-pip \
        gcc libelf-dev libssl-dev bc flex bison vim bzip2 libncurses-dev cpio

# Build special linux crosscompile toolchain

ENV RISCV=/opt/riscv

RUN apt-get update && apt-get -y install \
    autoconf automake autotools-dev curl python3 python3-pip \
    libmpc-dev libmpfr-dev libgmp-dev gawk build-essential bison flex \
    texinfo gperf libtool patchutils bc zlib1g-dev libexpat-dev ninja-build \
    git cmake libglib2.0-dev libslirp-dev

RUN git clone https://github.com/riscv-collab/riscv-gnu-toolchain.git /usr/src/riscv-gnu-toolchain

WORKDIR /usr/src/riscv-gnu-toolchain
RUN ./configure --prefix=/opt/riscv
RUN make linux

RUN make install && \
    rm -rf /usr/src/riscv-gnu-toolchain

ENV PATH=/opt/riscv/bin:$PATH


# Download kernel
RUN mkdir -p /sources
WORKDIR /sources
RUN wget https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/snapshot/linux-6.4.16.tar.gz
RUN tar xvzf linux-6.4.16.tar.gz
RUN mv linux-6.4.16 linux
COPY scripts/linux_sbi.config /sources/linux/.config
WORKDIR /sources/linux
RUN make ARCH=riscv CROSS_COMPILE=riscv64-unknown-linux-gnu-


RUN mkdir -p /root/boot
RUN cp /sources/linux/arch/riscv/boot/Image.gz /root/boot
WORKDIR /sources
RUN wget https://busybox.net/downloads/busybox-1.32.1.tar.bz2
RUN tar xvjf busybox-1.32.1.tar.bz2
WORKDIR /sources/busybox-1.32.1

COPY scripts/busybox.config /sources/busybox-1.32.1/.config
RUN CROSS_COMPILE=riscv64-unknown-linux-gnu- make 
RUN CROSS_COMPILE=riscv64-unknown-linux-gnu- make install
 
RUN mkdir -p /root/boot/initramfs/fs
WORKDIR /root/boot/initramfs/fs
RUN mkdir -pv bin sbin etc proc sys usr/bin usr/sbin
RUN cp -av /sources/busybox-1.32.1/_install/* .

RUN find . -print0 | cpio --null -ov --format=newc | gzip -9 > /root/boot/initramfs-busybox-riscv64.cpio.gz
WORKDIR /root/boot
RUN rm -rf initramfs



