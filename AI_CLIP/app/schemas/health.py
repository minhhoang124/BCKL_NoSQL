from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    model_loaded: bool = Field(alias="modelLoaded")
    index_loaded: bool = Field(alias="indexLoaded")
    vector_count: int = Field(alias="vectorCount", ge=0)

    model_config = {"populate_by_name": True}
