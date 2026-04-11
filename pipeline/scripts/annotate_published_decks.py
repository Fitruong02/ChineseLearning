from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = PROJECT_ROOT / "pipeline" / "src"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))

from chinese_flashcards.card_metadata import infer_card_kind, infer_part_of_speech


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def annotate_deck(deck_path: Path) -> int:
    payload = json.loads(deck_path.read_text(encoding="utf-8"))
    updated = 0

    for card in payload.get("cards", []):
        card_kind = infer_card_kind(
            str(card.get("hanzi", "")),
            str(card.get("pinyin", "")),
            [str(tag) for tag in card.get("tags", [])],
        )
        part_of_speech = infer_part_of_speech(str(card.get("hanzi", "")), card_kind)

        if card.get("cardKind") != card_kind:
            card["cardKind"] = card_kind
            updated += 1

        if part_of_speech:
            if card.get("partOfSpeech") != part_of_speech:
                card["partOfSpeech"] = part_of_speech
                updated += 1
        elif "partOfSpeech" in card:
            card.pop("partOfSpeech")
            updated += 1

    deck_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return updated


def update_manifest(content_root: Path) -> None:
    manifest_path = content_root / "manifest.json"
    if not manifest_path.exists():
        return

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["generatedAt"] = now_iso()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Annotate published decks with card kind and part-of-speech metadata.")
    parser.add_argument(
        "--content-root",
        type=Path,
        default=Path("web/public/content"),
        help="Content root containing published/ and manifest.json",
    )
    args = parser.parse_args()

    content_root = args.content_root.resolve()
    published_root = content_root / "published"
    updated_total = 0
    for deck_path in sorted(published_root.glob("*.json")):
        updated_total += annotate_deck(deck_path)

    update_manifest(content_root)
    print(f"Annotated metadata updates: {updated_total}")


if __name__ == "__main__":
    main()

