from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.elasticsearch import SearchFilters


def default_candidate_k(top_k: int) -> int:
    return min(max(top_k * 3, 30), 150)


class TextSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    top_k: int = Field(default=10, ge=1, le=50, alias="topK")
    candidate_k: int | None = Field(default=None, ge=1, le=150, alias="candidateK")

    @model_validator(mode="after")
    def validate_candidate_k(self) -> "TextSearchRequest":
        if self.candidate_k is None:
            self.candidate_k = default_candidate_k(self.top_k)
        elif self.candidate_k < self.top_k:
            raise ValueError("candidateK must be greater than or equal to topK")
        return self


class HybridSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    query: str = Field(min_length=1, max_length=500)
    filters: SearchFilters = Field(default_factory=SearchFilters)
    top_k: int = Field(default=20, ge=1, le=50, alias="topK")
    candidate_k: int = Field(default=100, ge=1, le=150, alias="candidateK")

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("query must not be empty")
        return cleaned

    @model_validator(mode="after")
    def validate_candidate_k(self) -> "HybridSearchRequest":
        if self.candidate_k < self.top_k:
            raise ValueError("candidateK must be greater than or equal to topK")
        return self


class SearchQuery(BaseModel):
    query_type: Literal["text", "image", "hybrid_text"] = Field(alias="type")
    text: str | None = None
    top_k: int = Field(alias="topK")
    candidate_k: int = Field(alias="candidateK")


class SearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product_id: int = Field(alias="productId")
    rank: int = Field(ge=1)
    score: float


class SearchResponse(BaseModel):
    query: SearchQuery
    items: list[SearchResult]
    response_time_ms: float = Field(alias="responseTimeMs", ge=0)


class HybridSearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    query_type: Literal["hybrid_text"] = Field(default="hybrid_text", alias="type")
    text: str


class HybridSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    query: HybridSearchQuery
    items: list[SearchResult]
    response_time_ms: float = Field(alias="responseTimeMs", ge=0)
