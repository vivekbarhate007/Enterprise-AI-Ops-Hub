import hashlib
import math
import re
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


CHUNK_SIZE_WORDS = 90
VECTOR_SIZE = 384
_MODEL_NAME = "all-MiniLM-L6-v2"
_MODEL_LOAD_FAILED = False
TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")
SYNONYM_GROUPS = {
    "database": {"database", "db", "postgres", "sql"},
    "connection": {"connection", "connections", "pool", "pooled", "saturation", "saturated", "full"},
    "latency": {"latency", "slow", "slowness", "delay", "delayed", "response", "responses"},
    "failure": {"failure", "failures", "crash", "error", "errors", "outage", "incident"},
    "checkout": {"checkout", "payment", "payments", "cart"},
}


@lru_cache(maxsize=1)
def _get_model() -> "SentenceTransformer":
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(_MODEL_NAME)


def _canonical_tokens(text: str) -> list[str]:
    tokens = [token.lower() for token in TOKEN_RE.findall(text)]
    expanded: list[str] = []
    for token in tokens:
        expanded.append(token)
        for canonical, synonyms in SYNONYM_GROUPS.items():
            if token in synonyms:
                expanded.append(canonical)
                expanded.extend(sorted(synonyms))
                break
    return expanded


def _fallback_embed_text(text: str) -> list[float]:
    vector = [0.0] * VECTOR_SIZE
    for token in _canonical_tokens(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], "big") % VECTOR_SIZE
        vector[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 6) for value in vector]


def chunk_text(text: str, *, max_words: int = CHUNK_SIZE_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    for start in range(0, len(words), max_words):
        chunks.append(" ".join(words[start : start + max_words]))
    return chunks


def embed_text(text: str) -> list[float]:
    global _MODEL_LOAD_FAILED
    if _MODEL_LOAD_FAILED:
        return _fallback_embed_text(text)
    try:
        model = _get_model()
        vector = model.encode(text, normalize_embeddings=True)
        return [round(float(value), 6) for value in vector]
    except Exception:
        _MODEL_LOAD_FAILED = True
        return _fallback_embed_text(text)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(value * value for value in left)) or 1.0
    norm_r = math.sqrt(sum(value * value for value in right)) or 1.0
    return dot / (norm_l * norm_r)
