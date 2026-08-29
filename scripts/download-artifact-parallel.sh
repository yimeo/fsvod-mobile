#!/usr/bin/env bash
set -euo pipefail

artifact_url="${1:?Usage: download-artifact-parallel.sh <artifact-url> <output-path> [parts]}"
output_path="${2:?Usage: download-artifact-parallel.sh <artifact-url> <output-path> [parts]}"
parts="${3:-6}"

if ! [[ "$parts" =~ ^[1-9][0-9]*$ ]]; then
  echo "parts must be a positive integer" >&2
  exit 2
fi

mkdir -p "$(dirname "$output_path")"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

curl --fail --silent --show-error --location --range 0-0 --dump-header "$work_dir/probe.headers" "$artifact_url" -o "$work_dir/probe.bin"
file_size="$(grep -Ei '^content-range:' "$work_dir/probe.headers" | tail -n 1 | sed -E 's@.*/@@; s/\r$//')"

if ! [[ "$file_size" =~ ^[0-9]+$ ]] || [ "$file_size" -le 0 ]; then
  echo "Unable to determine artifact file size" >&2
  exit 1
fi

chunk_size=$(( (file_size + parts - 1) / parts ))
pids=()
for ((index = 0; index < parts; index += 1)); do
  start=$(( index * chunk_size ))
  if [ "$start" -ge "$file_size" ]; then
    break
  fi
  end=$(( start + chunk_size - 1 ))
  if [ "$end" -ge "$file_size" ]; then
    end=$(( file_size - 1 ))
  fi
  curl --fail --silent --show-error --location --range "${start}-${end}" "$artifact_url" -o "$work_dir/part-${index}" &
  pids+=("$!")
done

for pid in "${pids[@]}"; do
  wait "$pid"
done

: > "$output_path"
for ((index = 0; index < ${#pids[@]}; index += 1)); do
  cat "$work_dir/part-${index}" >> "$output_path"
done

actual_size="$(stat -c '%s' "$output_path")"
if [ "$actual_size" -ne "$file_size" ]; then
  echo "Downloaded size mismatch: expected $file_size, got $actual_size" >&2
  exit 1
fi

sha256sum "$output_path"
