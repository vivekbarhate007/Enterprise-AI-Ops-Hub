from __future__ import annotations

import base64
import hashlib
import hmac
import secrets


def hash_password(password: str, *, salt: str | None = None) -> str:
    active_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), active_salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${active_salt}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, salt, expected = password_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(hash_password(password, salt=salt), f"{algorithm}${salt}${expected}")
