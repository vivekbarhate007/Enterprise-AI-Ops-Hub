import re

from sqlalchemy.orm import Session

from ..models.schemas import RetrievalResponse, RetrievalResult
from .embeddings import chunk_text, cosine_similarity, embed_text
from .llm_providers import LLMRouter
from .repository import list_chunks, list_documents, save_document

RTF_COMMAND_RE = re.compile(r"\\[a-zA-Z]+-?\d* ?")
RTF_HEX_RE = re.compile(r"\\'[0-9a-fA-F]{2}")
RTF_DESTINATION_RE = re.compile(r"{\\(?:fonttbl|colortbl|stylesheet|info|pict)[^{}]*(?:{[^{}]*}[^{}]*)*}")
WHITESPACE_RE = re.compile(r"\s+")
TITLE_TOKEN_RE = re.compile(r"[^a-z0-9]+")


def clean_document_text(content: str) -> str:
    """Convert basic RTF/TextEdit markup into readable plain text before embedding."""
    text = content.replace("\x00", " ").strip()

    if text.startswith("{\\rtf") or "\\fonttbl" in text:
        text = RTF_DESTINATION_RE.sub(" ", text)
        text = text.replace("\\pard", "\n").replace("\\par", "\n").replace("\\line", "\n").replace("\\tab", " ")
        text = text.replace("\\*", " ")
        text = RTF_HEX_RE.sub(" ", text)
        text = RTF_COMMAND_RE.sub(" ", text)
        text = text.replace("{", " ").replace("}", " ").replace("\\", " ")

    text = WHITESPACE_RE.sub(" ", text).strip(" *;:-")

    for marker in ("Checkout Latency Runbook", "Database pool", "Symptoms:", "When checkout"):
        marker_index = text.find(marker)
        if 0 <= marker_index <= 180:
            text = text[marker_index:]
            break

    return text.strip()


def canonical_source_title(title: str) -> str:
    title = title.strip().casefold()
    for extension in (".txt", ".md", ".markdown", ".pdf"):
        if title.endswith(extension):
            title = title[: -len(extension)]
            break
    return TITLE_TOKEN_RE.sub("", title)


class RagService:
    def __init__(self, router: LLMRouter | None = None) -> None:
        self.router = router or LLMRouter()

    def ingest_text(
        self,
        db: Session,
        *,
        tenant_id: str,
        title: str,
        source_type: str,
        content: str,
    ):
        cleaned_content = clean_document_text(content)
        chunks = [(chunk, embed_text(chunk)) for chunk in chunk_text(cleaned_content)]
        return save_document(
            db,
            tenant_id=tenant_id,
            title=title,
            source_type=source_type,
            content=cleaned_content,
            chunks=chunks,
        )

    def retrieve(self, db: Session, *, tenant_id: str, query: str, limit: int = 4) -> list[RetrievalResult]:
        query_embedding = embed_text(query)
        documents = {document.id: document for document in list_documents(db, tenant_id)}
        scored: list[RetrievalResult] = []
        for chunk in list_chunks(db, tenant_id):
            document = documents.get(chunk.document_id)
            if not document:
                continue
            cleaned_text = clean_document_text(chunk.text)
            scored.append(
                RetrievalResult(
                    document_id=chunk.document_id,
                    chunk_id=chunk.id,
                    title=document.title,
                    source_type=document.source_type,
                    score=max(0.0, cosine_similarity(query_embedding, chunk.embedding)),
                    text=cleaned_text,
                )
            )

        unique_sources: list[RetrievalResult] = []
        seen_document_ids: set[str] = set()
        seen_titles: set[str] = set()
        seen_texts: set[str] = set()

        for source in sorted(scored, key=lambda item: item.score, reverse=True):
            title_key = canonical_source_title(source.title)
            text_key = source.text[:240].strip().casefold()

            if source.document_id in seen_document_ids or title_key in seen_titles or text_key in seen_texts:
                continue

            unique_sources.append(source)
            seen_document_ids.add(source.document_id)
            seen_titles.add(title_key)
            seen_texts.add(text_key)

            if len(unique_sources) == limit:
                break

        return unique_sources

    async def answer(self, db: Session, *, tenant_id: str, query: str, provider: str = "local") -> RetrievalResponse:
        sources = self.retrieve(db, tenant_id=tenant_id, query=query)
        context = "\n".join(f"- {source.title}: {source.text}" for source in sources)
        prompt = (
            "Answer using only the provided enterprise context. "
            "Cite the source titles naturally.\n\n"
            f"Question: {query}\n\nContext:\n{context}"
        )
        completion = await self.router.complete(prompt, provider=provider)
        confidence = round(sum(source.score for source in sources[:3]) / max(len(sources[:3]), 1), 2)
        return RetrievalResponse(
            query=query,
            answer=completion.content,
            provider=completion.provider,
            confidence=confidence,
            sources=sources,
        )
