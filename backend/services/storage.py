"""Storage abstraction layer for pre-computed F1 data.

Supports two backends:
- local: reads/writes JSON files to a local directory (default)
- r2: reads/writes to Cloudflare R2 (S3-compatible)

Set STORAGE_MODE=r2 to use R2, otherwise defaults to local.
Set DATA_DIR to control the local storage directory (default: ./data).
"""

from __future__ import annotations

import gzip
import json
import logging
import os
from pathlib import Path
from functools import lru_cache

logger = logging.getLogger(__name__)


def _mode() -> str:
    return os.environ.get("STORAGE_MODE", "local").lower()


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------

def _data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")))


def _local_put_json(path: str, data: object) -> None:
    filepath = _data_dir() / path
    filepath.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, separators=(",", ":")).encode()
    filepath.write_bytes(body)
    logger.info(f"Saved {path} ({len(body)} bytes)")


def _local_get_json(path: str) -> object | None:
    filepath = _data_dir() / path
    if not filepath.exists():
        return None
    return json.loads(filepath.read_bytes())


def _local_exists(path: str) -> bool:
    return (_data_dir() / path).exists()


def _local_list_keys(prefix: str) -> list[str]:
    base = _data_dir() / prefix
    if not base.exists():
        return []
    return [str(p.relative_to(_data_dir())) for p in base.rglob("*") if p.is_file()]


# ---------------------------------------------------------------------------
# R2 backend
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_r2_client():
    import boto3
    from botocore.config import Config

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


def _r2_bucket() -> str:
    return os.environ.get("R2_BUCKET_NAME", "f1timingdata")


def _r2_key(path: str) -> str:
    return path.lstrip("/")


def _r2_put_json(path: str, data: object) -> None:
    client = _get_r2_client()
    body = gzip.compress(json.dumps(data, separators=(",", ":")).encode())
    client.put_object(
        Bucket=_r2_bucket(),
        Key=_r2_key(path),
        Body=body,
        ContentType="application/json",
        ContentEncoding="gzip",
    )
    logger.info(f"Uploaded {path} ({len(body)} bytes gzipped)")


def _r2_get_json(path: str) -> object | None:
    from botocore.exceptions import ClientError
    client = _get_r2_client()
    try:
        resp = client.get_object(Bucket=_r2_bucket(), Key=_r2_key(path))
        body = resp["Body"].read()
        try:
            body = gzip.decompress(body)
        except gzip.BadGzipFile:
            pass
        return json.loads(body)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise


def _r2_exists(path: str) -> bool:
    from botocore.exceptions import ClientError
    client = _get_r2_client()
    try:
        client.head_object(Bucket=_r2_bucket(), Key=_r2_key(path))
        return True
    except ClientError:
        return False


def _r2_list_keys(prefix: str) -> list[str]:
    client = _get_r2_client()
    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=_r2_bucket(), Prefix=_r2_key(prefix)):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


# ---------------------------------------------------------------------------
# Public API - delegates to the configured backend
# ---------------------------------------------------------------------------

def put_json(path: str, data: object) -> None:
    if _mode() == "r2":
        _r2_put_json(path, data)
    else:
        _local_put_json(path, data)


def get_json(path: str) -> object | None:
    if _mode() == "r2":
        return _r2_get_json(path)
    return _local_get_json(path)


def exists(path: str) -> bool:
    if _mode() == "r2":
        return _r2_exists(path)
    return _local_exists(path)


def list_keys(prefix: str) -> list[str]:
    if _mode() == "r2":
        return _r2_list_keys(prefix)
    return _local_list_keys(prefix)
