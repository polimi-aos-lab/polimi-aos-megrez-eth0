DOCKER ?= docker
PLATFORM ?= linux/amd64
TAG ?= polimi-aos-megrez-build-env:$(subst /,-,$(PLATFORM))

.PHONY: build-container enter-container toolchain-check fetch-sources build-artifacts

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

build-artifacts: fetch-sources
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(TAG)" ./scripts/build-artifacts.sh
