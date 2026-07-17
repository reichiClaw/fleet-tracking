#!/usr/bin/env python3
"""Validate and safely extract a decrypted Fleet Tracking backup bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
from pathlib import Path, PurePosixPath


ALLOWED_BUNDLE_FILES = {
    "database.dump",
    "media.tar.gz",
    "caddy-data.tar.gz",
    "caddy-config.tar.gz",
    "metadata.json",
    "manifest.sha256",
}


def safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts


def validate_tar_members(archive: tarfile.TarFile, allowed: set[str] | None = None) -> None:
    for member in archive.getmembers():
        normalized = member.name.removeprefix("./")
        if normalized in {"", "."} and member.isdir():
            continue
        if not safe_name(normalized):
            raise ValueError(f"unsafe archive path: {member.name}")
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise ValueError(f"unsupported archive entry type: {member.name}")
        if allowed is not None and normalized not in allowed:
            raise ValueError(f"unexpected bundle file: {member.name}")
        if allowed is not None and not member.isfile():
            raise ValueError(f"bundle entries must be regular files: {member.name}")


def safe_extract(archive: tarfile.TarFile, destination: Path) -> None:
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    for member in archive.getmembers():
        normalized = member.name.removeprefix("./")
        target = destination / normalized
        if member.isdir():
            target.mkdir(mode=0o700, parents=True, exist_ok=True)
            continue
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise ValueError(f"could not read archive member: {member.name}")
        with source, target.open("xb") as output:
            shutil.copyfileobj(source, output)
        target.chmod(0o600)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_inner_archive(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        validate_tar_members(archive)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path, help="decrypted .tar.gz bundle")
    parser.add_argument("--extract", type=Path, required=True)
    args = parser.parse_args()

    if args.extract.exists():
        raise ValueError(f"extraction directory already exists: {args.extract}")

    with tarfile.open(args.bundle, "r:gz") as archive:
        validate_tar_members(archive, ALLOWED_BUNDLE_FILES)
        names = {member.name.removeprefix("./") for member in archive.getmembers()}
        required = {"database.dump", "metadata.json", "manifest.sha256"}
        missing = required - names
        if missing:
            raise ValueError(f"backup bundle is missing: {', '.join(sorted(missing))}")
        safe_extract(archive, args.extract)

    metadata = json.loads((args.extract / "metadata.json").read_text())
    if metadata.get("format_version") != 1:
        raise ValueError("unsupported backup format version")
    if metadata.get("database_dump") != "database.dump":
        raise ValueError("invalid database dump metadata")
    if metadata.get("media_included") and "media.tar.gz" not in names:
        raise ValueError("metadata says media is included, but its archive is absent")
    if metadata.get("caddy_state_included") and not {
        "caddy-data.tar.gz",
        "caddy-config.tar.gz",
    }.issubset(names):
        raise ValueError("metadata says Caddy state is included, but an archive is absent")

    expected: dict[str, str] = {}
    for line in (args.extract / "manifest.sha256").read_text().splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            raise ValueError("malformed checksum manifest")
        checksum, filename = parts
        filename = filename.lstrip("*")
        if filename not in names or filename == "manifest.sha256":
            raise ValueError(f"invalid manifest filename: {filename}")
        if len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
            raise ValueError(f"invalid SHA-256 for {filename}")
        expected[filename] = checksum

    checked = names - {"manifest.sha256"}
    if set(expected) != checked:
        raise ValueError("checksum manifest does not cover every bundle data file")
    for filename, checksum in expected.items():
        actual = sha256(args.extract / filename)
        if actual != checksum:
            raise ValueError(f"checksum mismatch: {filename}")

    for filename in ("media.tar.gz", "caddy-data.tar.gz", "caddy-config.tar.gz"):
        archive_path = args.extract / filename
        if archive_path.exists():
            validate_inner_archive(archive_path)

    print(
        f"Validated backup {metadata.get('backup_id', 'unknown')} "
        f"created {metadata.get('created_at_utc', 'unknown')}."
    )


if __name__ == "__main__":
    main()
