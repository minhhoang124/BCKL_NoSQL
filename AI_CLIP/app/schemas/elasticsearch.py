from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProductDocument(BaseModel):
    """Product document schema stored in Elasticsearch.

    Matches PostgreSQL product domain and Backend indexing payload.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    product_id: int = Field(alias="productId", ge=1)
    name: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10_000)
    category_id: int = Field(alias="categoryId", ge=1)
    category_name: str | None = Field(default=None, alias="categoryName", max_length=255)
    category_path_ids: list[int] = Field(alias="categoryPathIds", min_length=1)
    brand_id: int | None = Field(default=None, alias="brandId", ge=1)
    brand_name: str | None = Field(default=None, alias="brandName", max_length=255)
    min_price: Decimal | None = Field(default=None, alias="minPrice", ge=Decimal("0"))
    max_price: Decimal | None = Field(default=None, alias="maxPrice", ge=Decimal("0"))
    in_stock: bool = Field(default=True, alias="inStock")
    attributes: dict[str, list[str]] = Field(default_factory=dict)
    version: int | None = Field(default=None, ge=1)

    @model_validator(mode="before")
    @classmethod
    def normalize_inputs(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        copied = dict(data)

        # Keep prices exact while validating the Backend decimal-string contract.
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

        return copied

    @model_validator(mode="after")
    def validate_document(self) -> "ProductDocument":
        # Strict category validation: path must not contain invalid IDs and must end with categoryId
        if any(cat_id < 1 for cat_id in self.category_path_ids):
            raise ValueError("All elements in categoryPathIds must be positive integers")
        if self.category_path_ids[-1] != self.category_id:
            raise ValueError("categoryPathIds must end with categoryId")

        # Normalize price bounds
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

    def to_es_source(self) -> dict[str, Any]:
        """Convert to Elasticsearch document source dict matching index properties."""
        return {
            "productId": self.product_id,
            "name": self.name,
            "description": self.description or "",
            "categoryId": self.category_id,
            "categoryName": self.category_name,
            "categoryPathIds": self.category_path_ids,
            "brandId": self.brand_id,
            "brandName": self.brand_name,
            "minPrice": float(self.min_price) if self.min_price is not None else None,
            "maxPrice": float(self.max_price) if self.max_price is not None else None,
            "inStock": self.in_stock,
            "attributes": self.attributes,
            "version": self.version,
        }


class SearchFilters(BaseModel):
    """Filters applied during Elasticsearch search queries."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    category_ids: list[int] | None = Field(default=None, alias="categoryIds")
    brand_ids: list[int] | None = Field(default=None, alias="brandIds")
    min_price: Decimal | None = Field(default=None, alias="minPrice", ge=Decimal("0"))
    max_price: Decimal | None = Field(default=None, alias="maxPrice", ge=Decimal("0"))
    in_stock: bool | None = Field(default=None, alias="inStock")

    @model_validator(mode="before")
    @classmethod
    def normalize_filter_prices(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        copied = dict(data)
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
        return copied

    @model_validator(mode="after")
    def validate_filter_range(self) -> "SearchFilters":
        if (
            self.min_price is not None
            and self.max_price is not None
            and self.min_price > self.max_price
        ):
            raise ValueError("minPrice cannot be greater than maxPrice")
        return self


class ElasticsearchHit(BaseModel):
    """Single search hit representing ranked product candidate from Elasticsearch."""

    model_config = ConfigDict(populate_by_name=True)

    product_id: int = Field(alias="productId", ge=1)
    rank: int = Field(ge=1)
    score: float


class ElasticsearchSearchResponse(BaseModel):
    """Elasticsearch search response metadata and items."""

    model_config = ConfigDict(populate_by_name=True)

    total: int = Field(ge=0)
    items: list[ElasticsearchHit]
    took_ms: float = Field(alias="tookMs", ge=0.0)
