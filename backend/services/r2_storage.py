"""Cloudflare R2 storage layer for pre-computed F1 data.

R2 is S3-compatible, so we use boto3 with a custom endpoint.
All data is stored as gzipped JSON for efficient transfer.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_client():
    account_id = os.environ.get("R2_ACCOUNT_ID", "")
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")

    if not all([account_id, access_key, secret_key]):
        raise RuntimeError("R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.")

    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            region_name="auto",
            retries={"max_attempts": 3, "mode": "standard"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def _bucket() -> str:
    return os.environ.get("R2_BUCKET_NAME", "f1timingdata")


def _key(path: str) -> str:
    """Build an R2 object key from a logical path."""
    return path.lstrip("/")


def put_json(path: str, data: object) -> None:
    """Upload a JSON object to R2 (gzipped)."""
    client = _get_client()
    body = gzip.compress(json.dumps(data, separators=(",", ":")).encode())
    client.put_object(
        Bucket=_bucket(),
        Key=_key(path),
        Body=body,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    logger.info(f"Uploaded {path} ({len(body)} bytes gzipped)")


def get_json(path: str) -> object | None:
    """Download and parse a JSON object from R2. Returns None if not found."""
    client = _get_client()
    try:
        resp = client.get_object(Bucket=_bucket(), Key=_key(path))
        body = resp["Body"].read()
        # Try gzip decompression; if it fails, body was already decompressed
        try:
            body = gzip.decompress(body)
        except gzip.BadGzipFile:
            pass
        return json.loads(body)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise


def exists(path: str) -> bool:
    """Check if an object exists in R2."""
    client = _get_client()
    try:
        client.head_object(Bucket=_bucket(), Key=_key(path))
        return True
    except ClientError:
        return False


def list_keys(prefix: str) -> list[str]:
    """List all object keys under a prefix."""
    client = _get_client()
    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=_bucket(), Prefix=_key(prefix)):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys
