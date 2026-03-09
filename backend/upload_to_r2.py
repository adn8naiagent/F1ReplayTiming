#!/usr/bin/env python3
"""Upload pre-computed local data files to Cloudflare R2.

Reads JSON files from ./data/ and uploads them (gzipped) to R2.
Does NOT re-process anything — just syncs local files to cloud.

Usage:
    python upload_to_r2.py                     # upload everything
    python upload_to_r2.py --prefix sessions/2026/1   # upload only Round 1
    python upload_to_r2.py --skip-existing     # skip files already on R2
"""

import argparse
import gzip
import json
import logging
import os
import sys

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from services.storage import _get_r2_client, _r2_bucket, _r2_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("upload_r2")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def list_local_files(prefix: str = "") -> list[str]:
    """List all JSON files under DATA_DIR/prefix, returning relative paths."""
    base = os.path.join(DATA_DIR, prefix)
    if not os.path.exists(base):
        logger.error(f"Directory not found: {base}")
        return []
    files = []
    for root, _, filenames in os.walk(base):
        for fn in filenames:
            if fn.endswith(".json"):
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, DATA_DIR).replace("\\", "/")
                files.append(rel)
    return sorted(files)


def r2_exists(client, bucket: str, key: str) -> bool:
    from botocore.exceptions import ClientError
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError:
        return False


def upload_file(client, bucket: str, rel_path: str) -> None:
    local_path = os.path.join(DATA_DIR, rel_path)
    with open(local_path, "rb") as f:
        raw = f.read()

    compressed = gzip.compress(raw)
    key = _r2_key(rel_path)
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=compressed,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    logger.info(f"Uploaded {rel_path} ({len(raw)} -> {len(compressed)} bytes gzipped)")


def main():
    parser = argparse.ArgumentParser(description="Upload local data to R2")
    parser.add_argument("--prefix", default="", help="Only upload files under this prefix (e.g. sessions/2026/1)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip files already on R2")
    args = parser.parse_args()

    files = list_local_files(args.prefix)
    if not files:
        logger.info("No files to upload.")
        return

    logger.info(f"Found {len(files)} files to upload")

    client = _get_r2_client()
    bucket = _r2_bucket()

    uploaded = 0
    skipped = 0
    for rel in files:
        if args.skip_existing and r2_exists(client, bucket, _r2_key(rel)):
            skipped += 1
            continue
        upload_file(client, bucket, rel)
        uploaded += 1

    logger.info(f"Done: {uploaded} uploaded, {skipped} skipped")


if __name__ == "__main__":
    main()
