#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)

if [ "${FETCH_SOURCES_IN_CONTAINER:-0}" != 1 ]; then
    docker_bin=${DOCKER:-docker}
    docker_image=${DOCKER_IMAGE:-polimi-aos-megrez-build-env:linux-amd64}
    docker_env=(-e FETCH_SOURCES_IN_CONTAINER=1)

    for name in LOCK_FILE SRC_DIR; do
        if [ "${!name+x}" = x ]; then
            docker_env+=(-e "${name}=${!name}")
        fi
    done

    exec "${docker_bin}" run --rm \
        -v "${repo_root}:/repo" \
        -w /repo \
        "${docker_env[@]}" \
        "${docker_image}" \
        /repo/scripts/fetch-sources.sh "$@"
fi

lock_file=${LOCK_FILE:-"${repo_root}/sources.lock"}
src_dir=${SRC_DIR:-"${repo_root}/stage/src"}
tarball_dir=${TARBALL_DIR:-"${src_dir}/tarballs"}

usage() {
    cat <<EOF
Usage: $(basename "$0")

Materialize pinned upstream sources listed in ${lock_file} into ${src_dir}.
Runs inside the build Docker image; override with DOCKER_IMAGE=... if needed.

Lock formats:
  git <name> <git-url> <source-ref> <pinned-commit>
  tar <name> <tar-url> <sha256> <strip-components>
EOF
}

case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
    "")
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        exit 1
    fi
}

sha256_check() {
    local file=$1
    local expected=$2

    printf '%s  %s\n' "${expected}" "${file}" | sha256sum -c - >/dev/null
}

fetch_git() {
    local name=$1
    local url=$2
    local source_ref=$3
    local commit=$4
    local dest="${src_dir}/${name}"

    printf '==> %s\n' "${name}"
    printf '    url: %s\n' "${url}"
    printf '    source ref: %s\n' "${source_ref}"
    printf '    pinned commit: %s\n' "${commit}"

    if [ -e "${dest}" ] && [ ! -d "${dest}/.git" ]; then
        printf 'error: %s exists but is not a git checkout\n' "${dest}" >&2
        return 1
    fi

    if [ ! -d "${dest}/.git" ]; then
        mkdir -p "${dest}"
        git -C "${dest}" init -q
        git -C "${dest}" remote add origin "${url}"
    else
        git -C "${dest}" remote set-url origin "${url}"
    fi

    git -C "${dest}" fetch --depth 1 origin "${commit}"
    git -C "${dest}" checkout --detach --force -q "${commit}"
    git -C "${dest}" reset --hard -q "${commit}"

    local actual
    actual=$(git -C "${dest}" rev-parse HEAD)
    if [ "${actual}" != "${commit}" ]; then
        printf 'error: %s checked out %s, expected %s\n' "${name}" "${actual}" "${commit}" >&2
        return 1
    fi
}

fetch_tar() {
    local name=$1
    local url=$2
    local sha256=$3
    local strip_components=$4
    local dest="${src_dir}/${name}"
    local tarball="${tarball_dir}/${name}.tar"
    local stamp="${dest}/.source.sha256"

    printf '==> %s\n' "${name}"
    printf '    url: %s\n' "${url}"
    printf '    sha256: %s\n' "${sha256}"

    mkdir -p "${tarball_dir}"
    if [ ! -f "${tarball}" ] || ! sha256_check "${tarball}" "${sha256}"; then
        rm -f -- "${tarball}"
        curl -fL --retry 3 --output "${tarball}" "${url}"
        sha256_check "${tarball}" "${sha256}"
    fi

    if [ -f "${stamp}" ] && grep -qx -- "${sha256}" "${stamp}"; then
        return 0
    fi

    rm -rf -- "${dest}"
    mkdir -p "${dest}"
    tar -xf "${tarball}" -C "${dest}" --strip-components="${strip_components}"
    printf '%s\n' "${sha256}" > "${stamp}"
}

require_command curl
require_command git
require_command sha256sum
require_command tar
require_command grep
require_command rm
require_command mkdir
require_command printf

mkdir -p "${src_dir}"

while read -r kind field2 field3 field4 field5 extra; do
    case "${kind}" in
        ""|\#*)
            continue
            ;;
        git)
            if [ -n "${extra:-}" ] || [ -z "${field5:-}" ]; then
                printf 'error: malformed git lock entry: %s %s %s %s %s %s\n' \
                    "${kind}" "${field2:-}" "${field3:-}" "${field4:-}" "${field5:-}" "${extra:-}" >&2
                exit 1
            fi
            fetch_git "${field2}" "${field3}" "${field4}" "${field5}"
            ;;
        tar)
            if [ -n "${extra:-}" ] || [ -z "${field5:-}" ]; then
                printf 'error: malformed tar lock entry: %s %s %s %s %s %s\n' \
                    "${kind}" "${field2:-}" "${field3:-}" "${field4:-}" "${field5:-}" "${extra:-}" >&2
                exit 1
            fi
            fetch_tar "${field2}" "${field3}" "${field4}" "${field5}"
            ;;
        *)
            if [ -n "${field5:-}" ] || [ -z "${field4:-}" ]; then
                printf 'error: malformed legacy git lock entry: %s %s %s %s %s\n' \
                    "${kind}" "${field2:-}" "${field3:-}" "${field4:-}" "${field5:-}" >&2
                exit 1
            fi
            fetch_git "${kind}" "${field2}" "${field3}" "${field4}"
            ;;
    esac
done < "${lock_file}"

printf 'Sources ready in %s\n' "${src_dir}"
