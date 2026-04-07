from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class MaterialSegment:
    text: str
    cardId: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if payload["cardId"] is None:
            payload.pop("cardId")
        return payload


@dataclass(slots=True)
class MaterialSection:
    id: str
    heading: str
    textZh: str
    textVi: str
    focusCardIds: list[str]
    segments: list[MaterialSegment] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["segments"] = [segment.to_dict() for segment in self.segments]
        return payload


@dataclass(slots=True)
class MaterialSource:
    id: str
    title: str
    type: str
    originPath: str
    language: str
    importedAt: str
    ocrMode: str
    summary: str
    tags: list[str]
    linkedDeckIds: list[str]
    sections: list[MaterialSection]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["sections"] = [section.to_dict() for section in self.sections]
        return payload


@dataclass(slots=True)
class DraftCard:
    id: str
    materialId: str
    hanzi: str
    pinyin: str
    meaningVi: str
    exampleZh: str
    exampleVi: str
    sourceSnippet: str
    tags: list[str]
    confidence: float
    status: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class DraftDeck:
    id: str
    title: str
    description: str
    level: str
    materialId: str
    createdAt: str
    sourcePath: str
    model: str
    tags: list[str]
    notes: list[str]
    cards: list[DraftCard]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["cards"] = [card.to_dict() for card in self.cards]
        return payload


@dataclass(slots=True)
class PublishedCard:
    id: str
    deckId: str
    hanzi: str
    pinyin: str
    meaningVi: str
    exampleZh: str
    exampleVi: str
    audioText: str
    tags: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PublishedDeck:
    id: str
    title: str
    description: str
    level: str
    materialId: str
    createdAt: str
    tags: list[str]
    cards: list[PublishedCard]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["cards"] = [card.to_dict() for card in self.cards]
        return payload
