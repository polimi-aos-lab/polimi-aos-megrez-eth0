DOCKER ?= docker
HOST_OS := $(shell uname -s)
DEFAULT_PLATFORM := $(if $(filter Darwin,$(HOST_OS)),linux/aarch64,linux/amd64)
PLATFORM ?= $(DEFAULT_PLATFORM)
TAG ?= polimi-aos-megrez-build-env:$(subst /,-,$(PLATFORM))

.PHONY: build-container enter-container toolchain-check fetch-sources build-artifacts assemble-boot mcp-install mcp-typecheck mcp-build mcp-test

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
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" ./scripts/build-artifacts.sh

assemble-boot: 
	./scripts/assemble-boot.sh

mcp-install:
	npm --prefix mcp ci

mcp-typecheck:
	npm --prefix mcp run typecheck

mcp-build:
	npm --prefix mcp run build

mcp-test:
	npm --prefix mcp test
