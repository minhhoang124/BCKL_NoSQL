from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

AI_CLIP_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration loaded from AI-prefixed environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=AI_CLIP_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "BCKL AI Service"
    app_version: str = "0.1.0"
    image_model_name: str = "sentence-transformers/clip-ViT-B-32"
    text_model_name: str = "sentence-transformers/clip-ViT-B-32-multilingual-v1"
    device: str = "cpu"
    omp_num_threads: int = Field(default=1, ge=1)
    load_runtime_on_startup: bool = True
    artifacts_dir: Path = AI_CLIP_ROOT / "artifacts"
    faiss_index_path: Path = AI_CLIP_ROOT / "artifacts/products.faiss"
    faiss_state_path: Path = AI_CLIP_ROOT / "artifacts/faiss_state.json"
    product_sync_state_path: Path = Field(
        default=AI_CLIP_ROOT / "artifacts/product_sync_state.json",
        validation_alias=AliasChoices(
            "AI_PRODUCT_SYNC_STATE_PATH",
            "PRODUCT_SYNC_STATE_PATH",
            "product_sync_state_path",
        ),
    )
    server_workers: int = Field(
        default=1,
        ge=1,
        le=1,
        description=(
            "FastAPI service currently requires exactly 1 worker "
            "for process-local state synchronization."
        ),
        validation_alias=AliasChoices(
            "AI_SERVER_WORKERS",
            "SERVER_WORKERS",
            "WEB_CONCURRENCY",
            "server_workers",
        ),
    )
    mapping_path: Path = AI_CLIP_ROOT / "artifacts/products_mapping.json"
    sample_metadata_path: Path = (
        AI_CLIP_ROOT / "data/sample/abo_electronics_1200_metadata.csv"
    )
    max_image_bytes: int = Field(default=5 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=25_000_000, gt=0)
    image_download_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    image_url_allowed_hosts: str = "backend,localhost,127.0.0.1,::1"
    elasticsearch_url: str = Field(
        default="http://localhost:9200",
        validation_alias=AliasChoices(
            "AI_ELASTICSEARCH_URL",
            "ELASTICSEARCH_URL",
            "elasticsearch_url",
        ),
    )
    elasticsearch_index_name: str = Field(
        default="products",
        validation_alias=AliasChoices(
            "AI_ELASTICSEARCH_INDEX_NAME",
            "ELASTICSEARCH_INDEX_NAME",
            "AI_ELASTICSEARCH_INDEX",
            "elasticsearch_index_name",
        ),
    )
    elasticsearch_timeout_seconds: float = Field(
        default=5.0,
        gt=0,
        le=60,
        validation_alias=AliasChoices(
            "AI_ELASTICSEARCH_TIMEOUT_SECONDS",
            "ELASTICSEARCH_TIMEOUT_SECONDS",
            "elasticsearch_timeout_seconds",
        ),
    )
    rrf_k: int = Field(default=60, ge=1)

    @property
    def allowed_image_hosts(self) -> set[str]:
        return {
            host.strip().lower()
            for host in self.image_url_allowed_hosts.split(",")
            if host.strip()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
