"""
Encryption utilities for storing sensitive API credentials.

We use Fernet symmetric encryption (AES-128-CBC) so we can
decrypt credentials when we need to call external APIs.
This is NOT hashing – hashing is one-way and we need the
original values to authenticate with external APIs.
"""
from cryptography.fernet import Fernet
from app.config import settings


def _get_fernet() -> Fernet:
    """Get a Fernet instance using the encryption key from settings."""
    return Fernet(settings.encryption_key.encode())


def encrypt_value(plain_text: str) -> str:
    """
    Encrypt a plaintext string.

    Returns:
        Encrypted string (base64-encoded)
    """
    if not plain_text:
        return ""
    f = _get_fernet()
    return f.encrypt(plain_text.encode()).decode()


def decrypt_value(encrypted_text: str) -> str:
    """
    Decrypt an encrypted string back to plaintext.

    Returns:
        Decrypted string
    """
    if not encrypted_text:
        return ""
    f = _get_fernet()
    return f.decrypt(encrypted_text.encode()).decode()
