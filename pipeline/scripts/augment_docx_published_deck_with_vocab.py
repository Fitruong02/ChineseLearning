from __future__ import annotations

import argparse
import json
import re
import sys
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from pypinyin import Style, pinyin

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = PROJECT_ROOT / "pipeline" / "src"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))

from chinese_flashcards.dictionary import CedictEntry, load_cedict
from import_docx_study_pack import (
    WEEK_RE,
    read_docx_paragraphs,
    select_items_for_type,
    slugify,
    stable_id,
)


TOKEN_RE = re.compile(r"^[\u4e00-\u9fff·]{2,8}$")
TRANSLATE_ENDPOINT = (
    "https://translate.googleapis.com/translate_a/single"
    "?client=gtx&dt=t"
)
VALID_POS_PREFIXES = ("n", "v", "a", "i", "l", "j", "s")
STOPWORDS = {
    "我们",
    "他们",
    "你们",
    "自己",
    "一个",
    "这个",
    "那个",
    "这些",
    "那些",
    "已经",
    "应该",
    "为了",
    "因为",
    "所以",
    "如果",
    "那么",
    "同时",
    "因此",
    "不是",
    "只有",
    "还有",
    "非常",
    "比较",
    "可以",
    "需要",
    "开始",
    "结束",
    "进行",
    "时候",
    "之后",
    "之前",
    "其中",
    "大家",
    "人们",
    "这样",
    "那样",
    "什么",
    "如何",
    "这里",
    "那里",
    "这里",
    "那个时候",
    "人为",
    "看吧",
    "起来",
    "和小王",
    "洛水之",
    "了自",
    "传于",
    "小张",
    "小季",
}
DEFINITION_SKIP_PREFIXES = (
    "classifier for ",
    "classifier:",
    "cl:",
    "surname ",
    "variant of ",
    "old variant of ",
    "used in ",
    "abbr. for ",
    "abbr. ",
    "see ",
)


def render_text_pinyin(text: str) -> str:
    if not text:
        return ""

    pieces: list[str] = []
    for chunk in pinyin(
        text,
        style=Style.TONE,
        heteronym=False,
        neutral_tone_with_five=False,
        errors=lambda value: list(value),
    ):
        token = chunk[0]
        if not token:
            continue
        if token.isspace():
            if pieces and pieces[-1] != " ":
                pieces.append(" ")
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]", token):
            if pieces and pieces[-1] != " ":
                pieces.append(" ")
            pieces.append(token)
            continue
        if pieces and pieces[-1] == " ":
            pieces.pop()
        pieces.append(token)

    return re.sub(r"\s+", " ", "".join(pieces)).strip()


def build_example_pinyin(example_zh: str, hanzi: str, card_pinyin: str) -> str:
    rendered = render_text_pinyin(example_zh)
    if not rendered or not hanzi or not card_pinyin:
        return rendered

    generated_term = render_text_pinyin(hanzi)
    if generated_term and generated_term in rendered:
        return rendered.replace(generated_term, card_pinyin, 1)

    return rendered


def extract_contextual_pinyin(sentence: str, term: str) -> str:
    if not sentence or not term:
        return ""

    start_index = sentence.find(term)
    if start_index == -1:
        return render_text_pinyin(term)

    chunks = pinyin(
        sentence,
        style=Style.TONE,
        heteronym=False,
        neutral_tone_with_five=False,
        errors=lambda value: list(value),
    )
    syllables: list[str] = []

    for offset, character in enumerate(term):
        if not re.fullmatch(r"[\u4e00-\u9fff]", character):
            continue
        chunk_index = start_index + offset
        if chunk_index >= len(chunks):
            continue
        token = chunks[chunk_index][0]
        if token:
            syllables.append(token)

    return " ".join(syllables).strip() or render_text_pinyin(term)


def split_week_groups(paragraphs: list[str]) -> list[tuple[str, list[str]]]:
    week_groups: list[tuple[str, list[str]]] = []
    current_heading = "Nội dung"
    current_items: list[str] = []

    for paragraph in paragraphs[1:]:
        if WEEK_RE.match(paragraph):
            if current_items:
                week_groups.append((current_heading, current_items))
            current_heading = paragraph
            current_items = []
            continue
        current_items.append(paragraph)

    if current_items:
        week_groups.append((current_heading, current_items))

    return week_groups


def build_docx_rows(source_path: Path) -> list[dict[str, str]]:
    paragraphs = read_docx_paragraphs(source_path)
    rows: list[dict[str, str]] = []

    for heading, items in split_week_groups(paragraphs):
        zh_items = select_items_for_type(items, "zh")
        pinyin_items = select_items_for_type(items, "pinyin")
        vi_items = select_items_for_type(items, "vi")
        row_count = max(len(zh_items), len(pinyin_items), len(vi_items))

        for index in range(row_count):
            zh_text = zh_items[index].strip() if index < len(zh_items) else ""
            if not zh_text:
                continue

            pinyin_text = (
                pinyin_items[index].strip()
                if index < len(pinyin_items) and pinyin_items[index].strip()
                else render_text_pinyin(zh_text)
            )
            vi_text = (
                vi_items[index].strip()
                if index < len(vi_items) and vi_items[index].strip()
                else translate_zh_to_vi(zh_text)
            )

            rows.append(
                {
                    "heading": heading,
                    "zh": zh_text,
                    "pinyin": pinyin_text,
                    "vi": vi_text,
                }
            )

    return rows


def iter_vocab_terms(text: str) -> list[str]:
    try:
        import jieba.posseg as pseg  # type: ignore
    except ModuleNotFoundError:
        return [
            token
            for token in re.findall(r"[\u4e00-\u9fff]{2,8}", text)
            if TOKEN_RE.fullmatch(token)
        ]

    terms: list[str] = []
    for item in pseg.lcut(text):
        token = item.word.strip()
        if not TOKEN_RE.fullmatch(token):
            continue
        if token in STOPWORDS:
            continue
        if not item.flag or not item.flag.startswith(VALID_POS_PREFIXES):
            continue
        terms.append(token)
    return terms


def translate_many_zh_to_vi(items: list[str], max_workers: int = 8) -> dict[str, str]:
    if not items:
        return {}

    translations: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(translate_zh_to_vi, item): item
            for item in dict.fromkeys(items)
        }
        for future in as_completed(future_map):
            item = future_map[future]
            translations[item] = future.result()

    return translations


@lru_cache(maxsize=None)
def translate_text(text: str, source_language: str, target_language: str) -> str:
    if not text.strip():
        return ""

    request = Request(
        f"{TRANSLATE_ENDPOINT}&sl={quote(source_language)}&tl={quote(target_language)}&q={quote(text)}",
        headers={"User-Agent": "Mozilla/5.0"},
    )

    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    translated = "".join(
        part[0] for part in payload[0] if isinstance(part, list) and part and part[0]
    )
    return translated.strip()


@lru_cache(maxsize=None)
def translate_zh_to_vi(text: str) -> str:
    return translate_text(text, "zh-CN", "vi")


@lru_cache(maxsize=None)
def translate_en_to_vi(text: str) -> str:
    return translate_text(text, "en", "vi")


def collect_candidate_definitions(entry: CedictEntry | None, limit: int = 3) -> list[str]:
    if not entry:
        return []

    ranked: list[tuple[int, int, str]] = []
    seen: set[str] = set()

    for index, definition in enumerate(entry.definitions):
        lowered = definition.strip().lower()
        if not lowered:
            continue
        if lowered.startswith(DEFINITION_SKIP_PREFIXES):
            continue
        cleaned = re.sub(r"^to\s+", "", definition.split(";")[0].strip(), flags=re.IGNORECASE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)

        word_count = len(cleaned.split())
        if word_count == 1 and cleaned.lower().endswith("ing"):
            score = 4
        elif cleaned.lower().startswith("in full "):
            score = 2
        elif 2 <= word_count <= 6:
            score = 3
        elif word_count == 1:
            score = 1
        elif word_count <= 10:
            score = 2
        else:
            score = 0

        ranked.append((score, -index, cleaned))

    ranked.sort(reverse=True)
    return [cleaned for _, _, cleaned in ranked[:limit]]


def pick_best_vi_translation(candidates: list[tuple[str, str]]) -> str:
    best_candidate = ""
    best_score = -1

    for candidate, source in candidates:
        cleaned = re.sub(r"\s+", " ", candidate).strip(" .;,/-")
        if not cleaned:
            continue

        word_count = len(cleaned.split())
        score = 0
        if not re.search(r"[A-Za-z]", cleaned):
            score += 4
        if 1 <= word_count <= 4:
            score += 3
        elif word_count <= 7:
            score += 2
        if not cleaned.lower().startswith(("để ", "một ", "sự ", "việc ", "được ", "là ")):
            score += 2
        if not any(symbol in cleaned for symbol in (";", "/", "(", ")")):
            score += 1
        if len(cleaned) >= 2:
            score += 1
        if source == "definition":
            score += 2

        if score > best_score:
            best_candidate = cleaned
            best_score = score

    return best_candidate


def build_meaning_lookup(terms: list[str]) -> dict[str, str]:
    dictionary = load_cedict()
    meaning_lookup: dict[str, str] = {}
    unique_terms = list(dict.fromkeys(terms))
    direct_translations = translate_many_zh_to_vi(unique_terms)
    definition_map = {
        term: collect_candidate_definitions(dictionary.get(term))
        for term in unique_terms
    }
    translated_definitions = translate_many_english_to_vi(
        [definition for definitions in definition_map.values() for definition in definitions]
    )

    for term in unique_terms:
        direct_translation = direct_translations.get(term, "").strip()
        definition_candidates: list[tuple[str, str]] = []
        for definition in definition_map.get(term, []):
            translated = translated_definitions.get(definition, "").strip()
            if translated:
                definition_candidates.append((translated, "definition"))

        best_translation = pick_best_vi_translation(definition_candidates)
        if not best_translation and direct_translation:
            best_translation = pick_best_vi_translation([(direct_translation, "direct")])
        if best_translation:
            meaning_lookup[term] = best_translation

    return meaning_lookup


def translate_many_english_to_vi(items: list[str], max_workers: int = 8) -> dict[str, str]:
    if not items:
        return {}

    translations: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(translate_en_to_vi, item): item
            for item in dict.fromkeys(items)
        }
        for future in as_completed(future_map):
            item = future_map[future]
            translations[item] = future.result()

    return translations


def augment_published_deck(source_path: Path, content_root: Path) -> Path:
    slug = slugify(source_path.stem)
    deck_path = content_root / "published" / f"deck-{slug}.json"
    if not deck_path.exists():
        raise FileNotFoundError(f"Published deck not found: {deck_path}")

    payload = json.loads(deck_path.read_text(encoding="utf-8"))
    existing_cards = payload.get("cards", [])
    existing_hanzi = {str(card.get("hanzi", "")).strip() for card in existing_cards}
    rows = build_docx_rows(source_path)
    ordered_vocab_rows: OrderedDict[str, dict[str, str]] = OrderedDict()

    for row in rows:
        for term in iter_vocab_terms(row["zh"]):
            if term in existing_hanzi or term in ordered_vocab_rows:
                continue
            ordered_vocab_rows[term] = row

    translated_terms = build_meaning_lookup(list(ordered_vocab_rows.keys()))
    ordered_vocab: list[dict[str, object]] = []

    for term, row in ordered_vocab_rows.items():
        meaning_vi = translated_terms.get(term, "").strip()
        if not meaning_vi:
            continue

        term_pinyin = extract_contextual_pinyin(row["zh"], term)
        ordered_vocab.append(
            {
                "id": stable_id("vocab", term),
                "deckId": payload["id"],
                "hanzi": term,
                "pinyin": term_pinyin,
                "meaningVi": meaning_vi,
                "exampleZh": row["zh"],
                "examplePinyin": row["pinyin"] or build_example_pinyin(
                    row["zh"],
                    term,
                    term_pinyin,
                ),
                "exampleVi": row["vi"] or translate_zh_to_vi(row["zh"]),
                "audioText": term,
                "tags": ["docx", row["heading"], "vocab-auto"],
            }
        )

    deduped_cards: list[dict[str, object]] = []
    seen_hanzi: set[str] = set()
    for card in [*existing_cards, *ordered_vocab]:
        hanzi = str(card.get("hanzi", "")).strip()
        if not hanzi or hanzi in seen_hanzi:
            continue
        seen_hanzi.add(hanzi)
        deduped_cards.append(card)

    payload["cards"] = deduped_cards
    payload["description"] = (
        "Deck tạo từ file DOCX ôn dịch viết, gồm câu mẫu và từ vựng tách tự động từ bài đọc."
    )
    payload["tags"] = list(dict.fromkeys([*payload.get("tags", []), "vocab-auto"]))

    deck_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return deck_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract unique vocabulary from a DOCX source and append it to the published deck."
    )
    parser.add_argument("source", type=Path, help="Path to the DOCX file")
    parser.add_argument(
        "--content-root",
        type=Path,
        default=Path("web/public/content"),
        help="Content root containing published decks",
    )
    args = parser.parse_args()

    deck_path = augment_published_deck(args.source.resolve(), args.content_root.resolve())
    payload = json.loads(deck_path.read_text(encoding="utf-8"))
    print(f"Updated deck: {deck_path}")
    print(f"Total cards: {len(payload.get('cards', []))}")


if __name__ == "__main__":
    main()
