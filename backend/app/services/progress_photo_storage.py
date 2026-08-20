"""Private image handling for Forge progress photos.

Images are normalized server-side before persistence so original filenames, EXIF/GPS
metadata, and unsupported formats never become durable application data.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
from pathlib import Path
import os
import warnings

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_DECODED_PIXELS = 40_000_000
# Full-HD-scale upper bound: portrait images remain portrait and are never cropped.
MAX_DIMENSION = 1920
WEBP_QUALITY = 82
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class PhotoStorageUnavailable(Exception):
    """The deployment has not supplied a durable private storage location."""


def storage_root() -> Path:
    configured_root = settings.photo_storage_dir.strip()
    if not configured_root:
        raise PhotoStorageUnavailable(
            "Progress-photo uploads are not configured. Set PHOTO_STORAGE_DIR to a mounted persistent volume."
        )
    root = Path(configured_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    if not root.is_dir():
        raise PhotoStorageUnavailable("PHOTO_STORAGE_DIR is not a directory.")
    return root


def storage_unavailable_error(error: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))


def _safe_path(root: Path, storage_key: str) -> Path:
    candidate = (root / storage_key).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("Invalid private photo storage key.") from error
    return candidate


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


def write_progress_photo(storage_key: str, content: bytes) -> Path:
    root = storage_root()
    destination = _safe_path(root, storage_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)
    return destination


def read_progress_photo(storage_key: str) -> Path:
    root = storage_root()
    photo_path = _safe_path(root, storage_key)
    if not photo_path.is_file():
        raise FileNotFoundError(storage_key)
    return photo_path


def delete_progress_photo(storage_key: str) -> None:
    try:
        photo_path = _safe_path(storage_root(), storage_key)
        photo_path.unlink(missing_ok=True)
        parent = photo_path.parent
        root = storage_root()
        if parent != root:
            parent.rmdir()
    except FileNotFoundError:
        return
    except OSError:
        # A leftover empty directory or a file already removed must not expose inaccessible data.
        return
