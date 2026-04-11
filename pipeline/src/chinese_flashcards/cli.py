from __future__ import annotations

import argparse
from pathlib import Path

from .backfill_examples import backfill_published_examples
from .pipeline import export_published_deck, ingest_material


def build_ingest_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract draft flashcards from a source material.")
    parser.add_argument("path", type=Path, help="Path to the source PDF/TXT/MD file")
    parser.add_argument(
        "--content-root",
        type=Path,
        default=Path("web/public/content"),
        help="Output directory containing materials/, drafts/, published/ and manifest.json",
    )
    parser.add_argument(
        "--ollama-model",
        default=None,
        help="Optional local Ollama model name, for example qwen2.5:7b",
    )
    parser.add_argument(
        "--cedict-path",
        type=Path,
        default=None,
        help="Optional path to a full cedict_ts.u8 file",
    )
    parser.add_argument(
        "--max-cards",
        type=int,
        default=28,
        help="Maximum number of draft cards to generate",
    )
    parser.add_argument(
        "--no-ocr",
        action="store_true",
        help="Skip OCR to run faster (only use embedded text from PDF)",
    )
    parser.add_argument(
        "--topic",
        default=None,
        help="Optional topic tag, for example benh-vien or thu-vien",
    )
    return parser


def build_export_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export a published deck JSON and CSV from a draft deck.")
    parser.add_argument("draft", type=Path, help="Path to the source draft deck JSON")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("web/public/content"),
        help="Output directory containing published/ and manifest.json",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.72,
        help="Minimum confidence threshold for export",
    )
    parser.add_argument(
        "--merge-with",
        type=Path,
        default=None,
        help="Optional path to an existing published deck JSON to append unique terms",
    )
    return parser


def build_backfill_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill example sentences and example pinyin for published decks.")
    parser.add_argument(
        "--content-root",
        type=Path,
        default=Path("web/public/content"),
        help="Output directory containing materials/, published/ and manifest.json",
    )
    return parser


def ingest_main() -> None:
    args = build_ingest_parser().parse_args()
    result = ingest_material(
        source_path=args.path.resolve(),
        content_root=args.content_root.resolve(),
        ollama_model=args.ollama_model,
        cedict_path=args.cedict_path.resolve() if args.cedict_path else None,
        max_cards=args.max_cards,
        allow_ocr=not args.no_ocr,
        topic=args.topic,
    )

    print(f"Material JSON: {result.material_path}")
    print(f"Draft deck JSON: {result.draft_path}")


def export_main() -> None:
    args = build_export_parser().parse_args()
    published_path, csv_path = export_published_deck(
        draft_path=args.draft.resolve(),
        output_root=args.output_root.resolve(),
        min_confidence=args.min_confidence,
        merge_with=args.merge_with.resolve() if args.merge_with else None,
    )

    print(f"Published deck JSON: {published_path}")
    print(f"Published deck CSV: {csv_path}")


def backfill_examples_main() -> None:
    args = build_backfill_parser().parse_args()
    updated_paths = backfill_published_examples(args.content_root.resolve())

    if not updated_paths:
        print("No published decks needed backfill.")
        return

    print("Updated published decks:")
    for path in updated_paths:
        print(f"- {path}")
