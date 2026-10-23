"""Private image handling for Forge progress photos and training-plan images.

Images are normalized server-side before persistence so original filenames, EXIF/GPS
metadata, and unsupported formats never become durable application data.

Normalized images are stored in a private S3-compatible bucket (Cloudflare R2 in
production). Objects are never public; they are only streamed through the
authenticated API after an owner lookup.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
import warnings

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

logger = logging.getLogger(__name__)

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_DECODED_PIXELS = 40_000_000
# Full-HD-scale upper bound: portrait images remain portrait and are never cropped.
MAX_DIMENSION = 1920
WEBP_QUALITY = 82
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
_MISSING_OBJECT_CODES = {"NoSuchKey", "NotFound", "404"}


class PhotoStorageUnavailable(Exception):
    """The deployment has not supplied (or cannot reach) private object storage."""


def ensure_storage_available() -> None:
    """Fail fast with a clear message when the S3 settings are incomplete."""
    required = (
        ("S3_ENDPOINT_URL", settings.s3_endpoint_url),
        ("S3_BUCKET", settings.s3_bucket),
        ("S3_ACCESS_KEY_ID", settings.s3_access_key_id),
        ("S3_SECRET_ACCESS_KEY", settings.s3_secret_access_key),
    )
    missing = [name for name, value in required if not value.strip()]
    if missing:
        raise PhotoStorageUnavailable(
            "Private image uploads are not configured. Set " + ", ".join(missing) + "."
        )


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url.strip(),
        aws_access_key_id=settings.s3_access_key_id.strip(),
        aws_secret_access_key=settings.s3_secret_access_key.strip(),
        region_name=(settings.s3_region.strip() or "auto"),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=30,
            # Cloudflare R2 does not accept the optional CRC32 trailers newer boto3 adds by default.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def storage_unavailable_error(error: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))


def _object_key(storage_key: str) -> str:
    """Map a database storage key to a bucket key, rejecting anything that could escape the prefix."""
    key = storage_key.strip()
    parts = key.split("/")
    if not key or key.startswith("/") or "\\" in key or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Invalid private photo storage key.")
    prefix = settings.s3_key_prefix.strip().strip("/")
    return f"{prefix}/{key}" if prefix else key


def prepare_progress_photo(source: bytes) -> tuple[bytes, int, int, str]:
    """Validate, metadata-strip, and resize an allowed image into a WebP payload."""
    if not source:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose an image to upload.")
    if len(source) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Images must be 10 MiB or smaller.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(source)) as verification_image:
                image_format = verification_image.format
                verification_image.verify()
            if image_format not in _ALLOWED_FORMATS:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Only JPEG, PNG, and WebP images are supported.",
                )
            with Image.open(BytesIO(source)) as decoded_image:
                decoded_image.load()
                image = ImageOps.exif_transpose(decoded_image)
                if image.width * image.height > MAX_DECODED_PIXELS:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Image dimensions are too large.")
                image = image.convert("RGB")
                image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format="WEBP", quality=WEBP_QUALITY, method=6)
                normalized = output.getvalue()
                return normalized, image.width, image.height, sha256(normalized).hexdigest()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The uploaded file is not a valid supported image.",
        )


def write_progress_photo(storage_key: str, content: bytes) -> None:
    """Store (or overwrite) one normalized image. Blocking network call: run it in a threadpool."""
    ensure_storage_available()
    try:
        _client().put_object(
            Bucket=settings.s3_bucket.strip(),
            Key=_object_key(storage_key),
            Body=content,
            ContentType="image/webp",
            CacheControl="private, no-store",
        )
    except (BotoCoreError, ClientError):
        logger.exception("Could not write private image %s to object storage", storage_key)
        raise storage_unavailable_error(PhotoStorageUnavailable("Photo storage is temporarily unavailable."))


def read_progress_photo(storage_key: str) -> bytes:
    """Return the stored image bytes. Blocking network call: run it in a threadpool.

    Raises FileNotFoundError when the object does not exist and PhotoStorageUnavailable
    when storage is misconfigured or unreachable.
    """
    ensure_storage_available()
    try:
        response = _client().get_object(Bucket=settings.s3_bucket.strip(), Key=_object_key(storage_key))
        with response["Body"] as body:
            return body.read()
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in _MISSING_OBJECT_CODES:
            raise FileNotFoundError(storage_key) from error
        logger.exception("Could not read private image %s from object storage", storage_key)
        raise PhotoStorageUnavailable("Photo storage is temporarily unavailable.") from error
    except BotoCoreError as error:
        logger.exception("Could not read private image %s from object storage", storage_key)
        raise PhotoStorageUnavailable("Photo storage is temporarily unavailable.") from error


def delete_progress_photo(storage_key: str) -> None:
    """Best-effort delete. A missing object or unreachable storage must not break the caller."""
    ensure_storage_available()
    try:
        _client().delete_object(Bucket=settings.s3_bucket.strip(), Key=_object_key(storage_key))
    except (BotoCoreError, ClientError):
        logger.warning("Could not delete private image %s from object storage", storage_key, exc_info=True)
