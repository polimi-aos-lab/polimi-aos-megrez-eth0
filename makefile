DOCKER ?= docker
HOST_OS := $(shell uname -s)
DEFAULT_PLATFORM := $(if $(filter Darwin,$(HOST_OS)),linux/aarch64,linux/amd64)
PLATFORM ?= $(DEFAULT_PLATFORM)
TAG ?= polimi-aos-megrez-build-env:$(subst /,-,$(PLATFORM))
JOBS ?= 1

.PHONY: build-container enter-container toolchain-check fetch-sources build-artifacts build-artifacts-baremetal build-artifacts-xen build-xen board-baremetal-smoke image-baremetal image-xen board-xen-smoke mcp-install mcp-typecheck mcp-build mcp-test

build-container:
	$(DOCKER) build --platform $(PLATFORM) -t $(TAG) .

enter-container:
	$(DOCKER) run -it --rm \
		-v "$(CURDIR):/repo" \
		-w /repo \
		$(TAG) \
		/bin/bash

toolchain-check:
	$(DOCKER) run --rm $(TAG) /usr/local/bin/toolchain-check

fetch-sources:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" ./scripts/fetch-sources.sh

build-artifacts:
	$(MAKE) JOBS="$(JOBS)" build-artifacts-baremetal
	$(MAKE) JOBS="$(JOBS)" build-artifacts-xen

build-artifacts-baremetal:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" PROFILE=baremetal JOBS="$(JOBS)" ./scripts/build-artifacts.sh

build-artifacts-xen:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" PROFILE=xen JOBS="$(JOBS)" ./scripts/build-artifacts.sh

build-xen:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" STAGE_DIR=/repo/stage/xen SRC_DIR=/repo/stage/src JOBS="$(JOBS)" ./scripts/build-xen.sh

board-baremetal-smoke:
	STAGE_DIR="$(CURDIR)/stage/baremetal" ./scripts/board-baremetal-smoke.sh

image-baremetal:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" JOBS="$(JOBS)" ./scripts/image-baremetal.sh

image-xen:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" JOBS="$(JOBS)" ./scripts/image-xen.sh

board-xen-smoke:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" STAGE_DIR=/repo/stage/xen ./scripts/board-xen-smoke.sh

mcp-install:
	npm --prefix mcp ci

mcp-typecheck:
	npm --prefix mcp run typecheck

mcp-build:
	npm --prefix mcp run build

mcp-test:
	npm --prefix mcp test
