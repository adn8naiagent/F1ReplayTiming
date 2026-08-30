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
import shutil
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


def _local_list_sizes(prefix: str) -> dict[str, int]:
    base = _data_dir() / prefix
    if not base.exists():
        return {}
    sizes: dict[str, int] = {}
    for p in base.rglob("*"):
        if p.is_file():
            sizes[str(p.relative_to(_data_dir()))] = p.stat().st_size
    return sizes


def _local_delete(path: str) -> int:
    filepath = _data_dir() / path
    if not filepath.is_file():
        return 0
    size = filepath.stat().st_size
    filepath.unlink()
    return size


def _local_delete_prefix(prefix: str) -> int:
    base = _data_dir() / prefix
    if not base.exists():
        return 0
    if base.is_file():
        return _local_delete(prefix)
    freed = sum(p.stat().st_size for p in base.rglob("*") if p.is_file())
    shutil.rmtree(base)
    # Drop now-empty parents so season/round dirs don't linger in listings.
    data_dir = _data_dir().resolve()
    parent = base.parent
    while parent.resolve() != data_dir and parent.is_dir() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent
    return freed


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


def _r2_list_sizes(prefix: str) -> dict[str, int]:
    client = _get_r2_client()
    sizes: dict[str, int] = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=_r2_bucket(), Prefix=_r2_key(prefix)):
        for obj in page.get("Contents", []):
            sizes[obj["Key"]] = obj["Size"]
    return sizes


def _r2_delete(path: str) -> int:
    client = _get_r2_client()
    key = _r2_key(path)
    try:
        size = client.head_object(Bucket=_r2_bucket(), Key=key)["ContentLength"]
    except Exception:
        return 0
    client.delete_object(Bucket=_r2_bucket(), Key=key)
    return size


def _r2_delete_prefixes(prefixes: list[str]) -> int:
    """Delete many prefixes with one listing and batched deletes.

    Deleting a hundred sessions one at a time is hundreds of sequential
    round trips; this keeps it to a single listing plus one call per 1000 keys.
    """
    client = _get_r2_client()
    bucket = _r2_bucket()

    wanted = tuple(p if p.endswith("/") else p + "/" for p in prefixes)
    # List once from the deepest shared root rather than per prefix.
    root = os.path.commonprefix(list(wanted))
    root = root[: root.rfind("/") + 1] if "/" in root else ""
    sizes = {k: v for k, v in _r2_list_sizes(root).items() if k.startswith(wanted)}
    if not sizes:
        return 0

    keys = list(sizes)
    for i in range(0, len(keys), 1000):
        client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]},
        )
    return sum(sizes.values())


def _r2_delete_prefix(prefix: str) -> int:
    client = _get_r2_client()
    bucket = _r2_bucket()
    sizes = _r2_list_sizes(prefix)
    if not sizes:
        return 0
    keys = list(sizes)
    # delete_objects caps at 1000 keys per call.
    for i in range(0, len(keys), 1000):
        client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]},
        )
    return sum(sizes.values())


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


def list_sizes(prefix: str) -> dict[str, int]:
    """Return {storage_key: size_in_bytes} for every file under *prefix*.

    For R2 the reported size is the gzip-compressed object size; for local
    storage it is the on-disk (uncompressed) size.
    """
    if _mode() == "r2":
        return _r2_list_sizes(prefix)
    return _local_list_sizes(prefix)


def delete(path: str) -> int:
    """Delete a single stored file. Returns the number of bytes freed."""
    if not path or path.strip("/") == "":
        raise ValueError("refusing to delete an empty path")
    if _mode() == "r2":
        return _r2_delete(path)
    return _local_delete(path)


def delete_prefix(prefix: str) -> int:
    """Delete every file under *prefix*. Returns the number of bytes freed.

    Guarded against empty prefixes and traversal so a caller can never be
    tricked into wiping the whole data directory or bucket.
    """
    cleaned = (prefix or "").strip("/")
    if not cleaned or ".." in cleaned.split("/"):
        raise ValueError(f"refusing to delete unsafe prefix: {prefix!r}")
    if _mode() == "r2":
        return _r2_delete_prefix(cleaned)
    return _local_delete_prefix(cleaned)


def delete_prefixes(prefixes: list[str]) -> int:
    """Delete every file under each of *prefixes*. Returns bytes freed."""
    cleaned = []
    for prefix in prefixes:
        c = (prefix or "").strip("/")
        if not c or ".." in c.split("/"):
            raise ValueError(f"refusing to delete unsafe prefix: {prefix!r}")
        cleaned.append(c)
    if not cleaned:
        return 0
    if _mode() == "r2":
        return _r2_delete_prefixes(cleaned)
    return sum(_local_delete_prefix(c) for c in cleaned)


def keys_under(prefixes: list[str]) -> dict[str, int]:
    """Every stored key beneath any of *prefixes*, with sizes.

    Does a single listing so a caller can delete in progress-reporting batches
    without paying for a fresh listing per batch.
    """
    cleaned = []
    for prefix in prefixes:
        c = (prefix or "").strip("/")
        if not c or ".." in c.split("/"):
            raise ValueError(f"refusing to list unsafe prefix: {prefix!r}")
        cleaned.append(c if c.endswith("/") else c + "/")
    if not cleaned:
        return {}

    root = os.path.commonprefix(cleaned)
    root = root[: root.rfind("/") + 1] if "/" in root else ""
    wanted = tuple(cleaned)
    return {k: v for k, v in list_sizes(root).items() if k.startswith(wanted)}


def delete_keys(keys: list[str], on_progress=None) -> None:
    """Delete exactly these keys. on_progress(done, total) fires per batch."""
    total = len(keys)
    if not total:
        return
    r2 = _mode() == "r2"
    client = _get_r2_client() if r2 else None
    bucket = _r2_bucket() if r2 else None

    step = 1000 if r2 else 200
    for i in range(0, total, step):
        batch = keys[i:i + step]
        if r2:
            client.delete_objects(
                Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch]}
            )
        else:
            for k in batch:
                try:
                    (_data_dir() / k).unlink()
                except FileNotFoundError:
                    pass
        if on_progress:
            on_progress(min(i + step, total), total)
