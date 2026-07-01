#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "${script_dir}/.." && pwd)
lock_file=${LOCK_FILE:-"${repo_root}/sources.lock"}
src_dir=${SRC_DIR:-"${repo_root}/stage/src"}

usage() {
    cat <<EOF
Usage: $(basename "$0")

Materialize pinned upstream sources listed in ${lock_file} into ${src_dir}.
Override with LOCK_FILE=/path/to/sources.lock and SRC_DIR=/path/to/stage/src.
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

mkdir -p "${src_dir}"

fetch_one() {
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

while read -r name url source_ref commit extra; do
    case "${name}" in
        ""|\#*)
            continue
            ;;
    esac

    if [ -n "${extra:-}" ] || [ -z "${commit:-}" ]; then
        printf 'error: malformed lock entry: %s %s %s %s %s\n' \
            "${name}" "${url:-}" "${source_ref:-}" "${commit:-}" "${extra:-}" >&2
        exit 1
    fi

    fetch_one "${name}" "${url}" "${source_ref}" "${commit}"
done < "${lock_file}"

printf 'Sources ready in %s\n' "${src_dir}"
