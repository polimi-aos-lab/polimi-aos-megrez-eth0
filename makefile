DOCKER ?= docker
PLATFORM ?= linux/amd64
TAG ?= polimi-aos-megrez-build-env:$(subst /,-,$(PLATFORM))

.PHONY: build-container enter-container toolchain-check

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
