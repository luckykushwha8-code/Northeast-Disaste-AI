from pydantic import BaseModel, ConfigDict, Field


class DistrictExplanationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    district: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)


class PreparednessQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=3, max_length=600)
