from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class IndexProductRequest(BaseModel):
    """Payload schema for prototype batch indexing endpoint (/index/products)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product_id: int = Field(alias="productId", ge=1)
    external_id: str | None = Field(default=None, alias="externalId", max_length=255)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=10_000)
    category: str = Field(min_length=1, max_length=255)
    category_id: int | None = Field(default=None, alias="categoryId", ge=1)
    brand: str | None = Field(default=None, max_length=255)
    image_urls: list[AnyHttpUrl] = Field(alias="imageUrls", min_length=1, max_length=10)
    version: int = Field(ge=1)


class SingleProductIndexRequest(BaseModel):
    """Payload schema for single product indexing endpoint (/index/product).

    Strictly adheres to docs/api/ai-service-contract.md.
    Does NOT infer or guess categoryId/categoryPathIds from text.
    Uses Decimal for exact price parsing and deterministic hashing.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product_id: int = Field(alias="productId", ge=1)
    version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=10_000)
    category_id: int = Field(alias="categoryId", ge=1)
    category_name: str | None = Field(default=None, alias="categoryName", max_length=255)
    category_path_ids: list[int] = Field(alias="categoryPathIds", min_length=1)
    brand_id: int | None = Field(default=None, alias="brandId", ge=1)
    brand_name: str | None = Field(default=None, alias="brandName", max_length=255)
    image_urls: list[AnyHttpUrl] = Field(alias="imageUrls", min_length=1, max_length=10)
    min_price: Decimal | None = Field(default=None, alias="minPrice", ge=Decimal("0.0"))
    max_price: Decimal | None = Field(default=None, alias="maxPrice", ge=Decimal("0.0"))
    in_stock: bool = Field(default=True, alias="inStock")
    attributes: dict[str, list[str]] = Field(default_factory=dict)
    external_id: str | None = Field(default=None, alias="externalId", max_length=255)

    @model_validator(mode="before")
    @classmethod
    def normalize_inputs(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        copied = dict(data)

        # Normalize price inputs to Decimal from string/int/float
        for price_key in ("minPrice", "min_price"):
            if price_key in copied and copied[price_key] is not None:
                try:
                    copied[price_key] = Decimal(str(copied[price_key]))
                except (InvalidOperation, TypeError, ValueError) as exc:
                    raise ValueError(f"Invalid decimal value for {price_key}") from exc
        for price_key in ("maxPrice", "max_price"):
            if price_key in copied and copied[price_key] is not None:
                try:
                    copied[price_key] = Decimal(str(copied[price_key]))
                except (InvalidOperation, TypeError, ValueError) as exc:
                    raise ValueError(f"Invalid decimal value for {price_key}") from exc

        if copied.get("description") is None:
            copied["description"] = ""

        return copied

    @model_validator(mode="after")
    def validate_single_product(self) -> "SingleProductIndexRequest":
        # Strict category validation:
        # path elements must be positive and path must end with categoryId
        if any(cat_id < 1 for cat_id in self.category_path_ids):
            raise ValueError("All elements in categoryPathIds must be positive integers")
        if self.category_path_ids[-1] != self.category_id:
            raise ValueError("categoryPathIds must end with categoryId")

        # Normalize price bounds if one is given and the other is not
        if self.min_price is not None and self.max_price is None:
            self.max_price = self.min_price
        elif self.max_price is not None and self.min_price is None:
            self.min_price = self.max_price

        if (
            self.min_price is not None
            and self.max_price is not None
            and self.min_price > self.max_price
        ):
            raise ValueError("minPrice cannot be greater than maxPrice")

        return self


class IndexStatusDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status: Literal["SUCCEEDED", "ALREADY_APPLIED", "FAILED"]
    version: int | None = None


class IndexesStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    elasticsearch: IndexStatusDetail
    faiss: IndexStatusDetail


class ProductSyncResponse(BaseModel):
    """Dual-index synchronization response matching docs/api/ai-service-contract.md."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    product_id: int = Field(alias="productId", ge=1)
    version: int = Field(ge=1)
    operation: Literal["UPSERT", "DELETE"]
    outcome: Literal["APPLIED", "NOOP", "STALE", "PARTIAL_FAILURE"]
    indexes: IndexesStatus


class FaissIndexStatus(BaseModel):
    status: Literal["updated", "deleted", "ignored"]
    vector_count: int = Field(alias="vectorCount", ge=0)


class IndexProductResponse(BaseModel):
    product_id: int = Field(alias="productId")
    version: int
    applied: bool
    faiss: FaissIndexStatus


class BatchIndexResponse(BaseModel):
    items: list[IndexProductResponse]
