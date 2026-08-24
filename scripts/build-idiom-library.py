#!/usr/bin/env python3
"""Build the local idiom and word-discrimination library from the user's PDFs."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader
import pypdfium2 as pdfium


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UPPER = Path(r"D:\BaiduNetdiskDownload\（上册）【四海】-高频成语实词1000词.pdf")
DEFAULT_LOWER = Path(r"D:\BaiduNetdiskDownload\（下册）【四海】-高频成语实词1000词(0).pdf")
DEFAULT_DISCRIMINATION = Path(r"D:\BaiduNetdiskDownload\公务员行测词语辨析456组  1.pdf")
DEFAULT_OUTPUT = ROOT / "data" / "idiom-library.json"
OCR_ROOT = ROOT / "tmp" / "pdfs" / "discrimination-ocr"
OCR_CACHE = ROOT / "tmp" / "pdfs" / "discrimination-ocr-raw.json"
BUILD_REPORT = ROOT / "tmp" / "pdfs" / "idiom-build-report.json"
RAPIDOCR_PATH = ROOT / "tmp" / "rapidocr"

GROUP_RE = re.compile(r"【(第[一二三四五六七八九十百]+组)】\s*(.+?)\s*[（(]\s*(\d+)\s*个")
ENTRY_RE = re.compile(r"^✎\s*(.+?)\s*$")
PAGE_HEADER_RE = re.compile(r"^(?:第\s*\d+\s*页|1000\s*词高频成语实词|高频成语篇)$")
SECTION_RE = re.compile(r"^\d+(?:\.\d+)+\s*(?:成语解释|成语辨析|实词解释|词语辨析)")
OCR_ENTRY_START_RE = re.compile(r"^\s*(\d{1,3})\s*[.、]?\s*[\[［【〔(（]\s*(.*)$")
OCR_TITLE_OVERRIDES = {
    4: "安置·安顿·安排",
    9: "把持·操纵",
    23: "崩裂·迸裂",
    32: "病例·病历",
    46: "察访·查访",
    50: "嘲笑·嗤笑·嘲讽·嘲弄·讥笑·耻笑",
    57: "踌躇·犹豫·迟疑",
    59: "出生·出身",
    65: "篡夺·撺夺",
    74: "讹传·讹舛",
    75: "遏止·遏制",
    77: "二·两",
    89: "废除·废黜",
    94: "愤怒·愤慨",
    114: "苟合·媾合",
    135: "花序·花絮",
    142: "会晤·会面",
    150: "急遽·急剧",
    154: "技能·机能",
    169: "截止·截至",
    177: "救急·救济",
    192: "恳切·殷切",
    196: "宽绰·宽裕",
    199: "拉拢·笼络",
    207: "吝啬·吝惜",
    218: "罗织·罗致",
    220: "漫步·慢步",
    226: "面视·面试·睨视",
    233: "难言·赧颜",
    257: "启用·起用",
    260: "牵扯·牵掣",
    264: "切记·切忌",
    269: "清冽·清洌",
    288: "糅合·揉合",
    289: "软弱·懦弱",
    294: "商量·商榷·协商",
    339: "统一·同一",
    371: "心底·心地",
    399: "意气·义气",
    402: "引见·引荐",
    403: "引导·导致",
    426: "征候·症候",
    434: "中止·终止",
    444: "捉摸·琢磨",
    449: "自诩·自夸",
    452: "纵容·怂恿",
}
OCR_TEXT_CORRECTIONS = (
    ("进裂", "迸裂"),
    ("擦访", "察访"),
    ("化传", "讹传"),
    ("遇制", "遏制"),
    ("废點", "废黜"),
    ("急邃", "急遽"),
    ("恩切", "恳切"),
    ("宽除", "宽绰"),
    ("拉笼", "拉拢"),
    ("客啬", "吝啬"),
    ("报颜", "赧颜"),
    ("清测", "清洌"),
    ("儒弱", "懦弱"),
    ("厂面视”", "“面视”"),
    ("晒视", "睨视"),
    ("弓见", "引见"),
    ("弓[荐", "引荐"),
    ("引[荐", "引荐"),
    ("弓导", "引导"),
    ("愚味", "愚昧"),
    ("自翊", "自诩"),
    ("自谢", "自诩"),
    ("丛惠", "怂恿"),
    ("丛患", "怂恿"),
    ("应征人伍", "应征入伍"),
    ("瞩咐", "嘱咐"),
    ("耻笑】“嘲笑”", "“嘲笑”"),
    ("“笑”带有轻视", "“嗤笑”带有轻视"),
    ("1相同点", "相同点"),
    ("“目同点", "相同点"),
)


def compact(text: str) -> str:
    value = str(text or "").replace("\u3000", " ")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+([，。；：、！？）】])", r"\1", value)
    value = re.sub(r"([（【])\s+", r"\1", value)
    return value.strip()


def stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def flush_shihai_entry(active: dict[str, Any] | None, output: list[dict[str, Any]], source: str) -> None:
    if not active:
        return
    word = compact(active["word"]).strip("：:")
    body = "\n".join(active["lines"])
    parts = re.split(r"【例】", body)
    meaning = compact(parts[0])
    examples = [compact(part) for part in parts[1:] if compact(part)]
    if not word or not meaning:
        return
    output.append(
        {
            "id": stable_id("shihai", word),
            "word": word,
            "meaning": meaning,
            "example": examples[0] if examples else "",
            "examples": examples[:3],
            "kind": "四海成语实词",
            "source": source,
            "group": active.get("group", ""),
            "topic": active.get("topic", ""),
            "tags": [tag for tag in ["四海", active.get("topic", ""), "高频词"] if tag],
        }
    )


def extract_shihai(path: Path, source: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reader = PdfReader(str(path))
    entries: list[dict[str, Any]] = []
    expected_by_group: dict[str, int] = {}
    topic_by_group: dict[str, str] = {}
    actual_by_group: Counter[str] = Counter()
    current_group = ""
    current_topic = ""
    active: dict[str, Any] | None = None
    content_started = False

    for page in reader.pages:
        text = (page.extract_text() or "").replace("\u3000", " ")
        if "✎" in text:
            content_started = True
        if not content_started:
            continue
        for raw_line in text.splitlines():
            line = compact(raw_line)
            if not line or PAGE_HEADER_RE.match(line):
                continue
            group_match = GROUP_RE.search(line)
            if group_match:
                flush_shihai_entry(active, entries, source)
                active = None
                current_group = group_match.group(1)
                current_topic = compact(group_match.group(2))
                expected_by_group[current_group] = int(group_match.group(3))
                topic_by_group[current_group] = current_topic
                continue
            if SECTION_RE.match(line):
                flush_shihai_entry(active, entries, source)
                active = None
                continue
            entry_match = ENTRY_RE.match(line)
            if entry_match:
                flush_shihai_entry(active, entries, source)
                active = {
                    "word": entry_match.group(1),
                    "group": current_group,
                    "topic": current_topic,
                    "lines": [],
                }
                continue
            if re.fullmatch(r"【第[一二三四五六七八九十百]+组】", line):
                continue
            if active:
                active["lines"].append(line)

    flush_shihai_entry(active, entries, source)
    for item in entries:
        actual_by_group[item["group"]] += 1
    mismatches = {
        group: {"expected": expected, "actual": actual_by_group[group], "topic": topic_by_group.get(group, "")}
        for group, expected in expected_by_group.items()
        if actual_by_group[group] != expected
    }
    report = {
        "source": source,
        "pages": len(reader.pages),
        "entries": len(entries),
        "groups": len(expected_by_group),
        "groupCountMismatches": mismatches,
        "missingMeaning": [item["word"] for item in entries if not item["meaning"]],
        "missingExample": [item["word"] for item in entries if not item["example"]],
    }
    return entries, report


_OCR_ENGINE = None


def init_ocr_worker(rapidocr_path: str) -> None:
    global _OCR_ENGINE
    sys.path.insert(0, rapidocr_path)
    from rapidocr_onnxruntime import RapidOCR

    _OCR_ENGINE = RapidOCR(
        rec_batch_num=64,
        cls_batch_num=64,
        intra_op_num_threads=4,
        inter_op_num_threads=1,
    )


def ocr_page(task: tuple[int, str]) -> dict[str, Any]:
    page_number, image_path = task
    started = time.perf_counter()
    result, elapsed = _OCR_ENGINE(image_path, use_cls=False)
    rows = []
    for box, text, score in result or []:
        rows.append({"box": box, "text": str(text), "score": round(float(score), 4)})
    return {
        "page": page_number,
        "image": image_path,
        "rows": rows,
        "elapsed": elapsed,
        "seconds": round(time.perf_counter() - started, 2),
    }


def render_ocr_pages(pdf_path: Path) -> list[tuple[int, str]]:
    OCR_ROOT.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(pdf_path))
    tasks: list[tuple[int, str]] = []
    for index in range(len(document)):
        target = OCR_ROOT / f"page-{index + 1:03d}.png"
        if not target.exists():
            image = document[index].render(scale=2.0).to_pil().convert("RGB")
            image.save(target, format="PNG", optimize=True)
        tasks.append((index + 1, str(target)))
    return tasks


def load_ocr_cache() -> dict[str, Any]:
    if not OCR_CACHE.exists():
        return {"pages": {}}
    try:
        payload = json.loads(OCR_CACHE.read_text(encoding="utf-8"))
        if isinstance(payload.get("pages"), dict):
            return payload
    except (OSError, json.JSONDecodeError):
        pass
    return {"pages": {}}


def run_ocr(pdf_path: Path, workers: int, force: bool) -> list[dict[str, Any]]:
    if not RAPIDOCR_PATH.exists():
        raise RuntimeError(f"RapidOCR runtime not found: {RAPIDOCR_PATH}")
    tasks = render_ocr_pages(pdf_path)
    cache = load_ocr_cache()
    if force:
        cache = {"pages": {}}
    pending = [task for task in tasks if str(task[0]) not in cache["pages"]]
    if pending:
        print(f"OCR: {len(pending)} pages pending, {workers} workers", flush=True)
        with concurrent.futures.ProcessPoolExecutor(
            max_workers=workers,
            initializer=init_ocr_worker,
            initargs=(str(RAPIDOCR_PATH),),
        ) as pool:
            futures = {pool.submit(ocr_page, task): task[0] for task in pending}
            complete = 0
            for future in concurrent.futures.as_completed(futures):
                payload = future.result()
                cache["pages"][str(payload["page"])] = payload
                complete += 1
                OCR_CACHE.parent.mkdir(parents=True, exist_ok=True)
                OCR_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
                print(
                    f"OCR: {complete}/{len(pending)} new pages; page {payload['page']} in {payload['seconds']}s",
                    flush=True,
                )
    return [cache["pages"][str(page)] for page, _ in tasks]


def row_geometry(row: dict[str, Any]) -> tuple[float, float, float, float]:
    points = row.get("box") or []
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def merge_ocr_lines(rows: list[dict[str, Any]], image_width: int) -> list[dict[str, Any]]:
    columns: list[list[dict[str, Any]]] = [[], []]
    for row in rows:
        text = compact(row.get("text", ""))
        if not text or re.search(r"词语辨析\s*456\s*组|按音序排列|^第?\s*\d+\s*页$", text):
            continue
        x1, y1, x2, y2 = row_geometry(row)
        center = (x1 + x2) / 2
        column = 0 if center < image_width / 2 else 1
        columns[column].append({**row, "text": text, "x1": x1, "y1": y1, "x2": x2, "y2": y2})

    merged: list[dict[str, Any]] = []
    for column, values in enumerate(columns):
        values.sort(key=lambda item: (item["y1"], item["x1"]))
        line_groups: list[list[dict[str, Any]]] = []
        for item in values:
            if line_groups:
                anchor = sum(value["y1"] for value in line_groups[-1]) / len(line_groups[-1])
                if abs(item["y1"] - anchor) <= 10:
                    line_groups[-1].append(item)
                    continue
            line_groups.append([item])
        for group in line_groups:
            group.sort(key=lambda item: item["x1"])
            merged.append(
                {
                    "column": column,
                    "y": min(item["y1"] for item in group),
                    "text": compact("".join(item["text"] for item in group)),
                    "score": round(sum(float(item["score"]) for item in group) / len(group), 4),
                }
            )
    return merged


def correct_ocr_text(text: str) -> str:
    value = compact(text)
    for source, target in OCR_TEXT_CORRECTIONS:
        value = value.replace(source, target)
    return value


def normalized_title(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", text)


def strip_expected_title(text: str, title: str) -> str | None:
    expected = normalized_title(title)
    seen = ""
    for index, char in enumerate(text):
        normalized = normalized_title(char)
        if not normalized:
            continue
        seen += normalized
        if seen == expected:
            return text[index + 1 :].lstrip()
        if not expected.startswith(seen):
            return None
    return None


def parse_ocr_entry_start(text: str) -> tuple[int, str, str] | None:
    match = OCR_ENTRY_START_RE.match(text)
    if not match:
        return None
    number = int(match.group(1))
    remainder = compact(match.group(2))
    closing = re.search(r"[\]］】〕]", remainder)
    if closing:
        raw_title = compact(remainder[: closing.start()])
        body = compact(remainder[closing.end() :])
        return number, OCR_TITLE_OVERRIDES.get(number, raw_title), body

    override = OCR_TITLE_OVERRIDES.get(number)
    if not override:
        return None
    body = strip_expected_title(remainder, override)
    if body is None:
        marker_positions = [
            position
            for marker in ("“", "相同点", "二者", "三者")
            if (position := remainder.find(marker)) > 0
        ]
        body = remainder[min(marker_positions) :] if marker_positions else ""
    return number, override, compact(body)


def split_distinction_terms(title: str) -> list[str]:
    normalized = re.sub(r"[•・、，,；;/|]+", "·", compact(title))
    terms = [compact(term) for term in normalized.split("·") if compact(term)]
    if len(terms) == 1 and re.fullmatch(r"[\u3400-\u9fff]{4,12}", terms[0]) and len(terms[0]) % 2 == 0:
        return [terms[0][index : index + 2] for index in range(0, len(terms[0]), 2)]
    return terms


def parse_discrimination(raw_pages: list[dict[str, Any]], source: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    stream: list[dict[str, Any]] = []
    for page in sorted(raw_pages, key=lambda item: item["page"]):
        from PIL import Image

        with Image.open(page["image"]) as image:
            lines = merge_ocr_lines(page["rows"], image.width)
        for line in lines:
            stream.append({**line, "page": page["page"]})

    parsed: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None
    unmatched_numbered_lines: list[dict[str, Any]] = []
    for line in stream:
        text = correct_ocr_text(line["text"])
        entry_start = parse_ocr_entry_start(text)
        if entry_start:
            if active:
                parsed.append(active)
            number, title, body = entry_start
            active = {
                "number": number,
                "title": title,
                "body": [body] if body else [],
                "page": line["page"],
                "scores": [line["score"]],
            }
            continue
        if OCR_ENTRY_START_RE.match(text):
            unmatched_numbered_lines.append({"page": line["page"], "text": text})
        if active:
            active["body"].append(text)
            active["scores"].append(line["score"])
    if active:
        parsed.append(active)

    items: list[dict[str, Any]] = []
    for entry in parsed:
        terms = split_distinction_terms(entry["title"])
        display = " · ".join(terms) if len(terms) > 1 else entry["title"]
        meaning = correct_ocr_text("".join(entry["body"]))
        confidence = round(sum(entry["scores"]) / max(1, len(entry["scores"])), 4)
        items.append(
            {
                "id": f"distinction-{entry['number']:03d}",
                "word": display,
                "terms": terms,
                "meaning": meaning,
                "example": "",
                "examples": [],
                "kind": "词语辨析",
                "source": source,
                "group": f"第{entry['number']}组",
                "topic": display,
                "tags": ["词语辨析", "易混词", "言语理解"],
                "sourcePage": entry["page"],
                "ocrConfidence": confidence,
                "ocrReviewedTitle": entry["number"] in OCR_TITLE_OVERRIDES,
            }
        )

    numbers = [item_number(item["id"]) for item in items]
    expected = set(range(1, 458))
    actual = set(numbers)
    report = {
        "source": source,
        "pages": len(raw_pages),
        "entries": len(items),
        "missingNumbers": sorted(expected - actual),
        "duplicateNumbers": sorted(number for number, count in Counter(numbers).items() if count > 1),
        "unexpectedNumbers": sorted(actual - expected),
        "numberingNote": "源文件名写作456组，但正文实际连续编号为1-457。",
        "unmatchedNumberedLines": unmatched_numbered_lines,
        "averageOcrConfidence": round(
            sum(item["ocrConfidence"] for item in items) / max(1, len(items)), 4
        ),
        "lowConfidence": [
            {"number": item_number(item["id"]), "word": item["word"], "score": item["ocrConfidence"]}
            for item in items
            if item["ocrConfidence"] < 0.88
        ],
    }
    return items, report


def item_number(item_id: str) -> int:
    return int(item_id.rsplit("-", 1)[-1])


def deduplicate_shihai(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[item["word"]].append(item)
    output: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    for word, matches in grouped.items():
        base = matches[0]
        if len(matches) > 1:
            sources = list(dict.fromkeys(item["source"] for item in matches))
            groups = list(dict.fromkeys(item["group"] for item in matches))
            topics = list(dict.fromkeys(item["topic"] for item in matches))
            base["source"] = " / ".join(sources)
            base["group"] = " / ".join(groups)
            base["topic"] = " / ".join(topics)
            base["tags"] = list(dict.fromkeys(tag for item in matches for tag in item["tags"]))
            duplicates.append({"word": word, "count": len(matches), "sources": sources})
        output.append(base)
    return output, duplicates


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upper", type=Path, default=DEFAULT_UPPER)
    parser.add_argument("--lower", type=Path, default=DEFAULT_LOWER)
    parser.add_argument("--discrimination", type=Path, default=DEFAULT_DISCRIMINATION)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=min(3, max(1, (os.cpu_count() or 4) // 4)))
    parser.add_argument("--force-ocr", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for source_path in [args.upper, args.lower, args.discrimination]:
        if not source_path.exists():
            raise FileNotFoundError(source_path)

    upper, upper_report = extract_shihai(args.upper, "四海高频成语实词1000词·上册")
    lower, lower_report = extract_shihai(args.lower, "四海高频成语实词1000词·下册")
    shihai, duplicates = deduplicate_shihai(upper + lower)
    raw_ocr = run_ocr(args.discrimination, max(1, args.workers), args.force_ocr)
    distinctions, discrimination_report = parse_discrimination(raw_ocr, "公务员行测词语辨析456组")

    fatal_errors = []
    if upper_report["groupCountMismatches"]:
        fatal_errors.append("upper group counts do not match")
    if lower_report["groupCountMismatches"]:
        fatal_errors.append("lower group counts do not match")
    if (
        discrimination_report["missingNumbers"]
        or discrimination_report["duplicateNumbers"]
        or discrimination_report["unexpectedNumbers"]
    ):
        fatal_errors.append("word-discrimination numbering is incomplete")

    items = sorted(shihai, key=lambda item: (item["group"], item["word"])) + distinctions
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "metadata": {
            "generatedAt": generated_at,
            "total": len(items),
            "shihaiUnique": len(shihai),
            "wordDiscriminationGroups": len(distinctions),
            "sources": [
                {"title": "四海高频成语实词1000词·上册", "path": str(args.upper), "entries": len(upper)},
                {"title": "四海高频成语实词1000词·下册", "path": str(args.lower), "entries": len(lower)},
                {"title": "公务员行测词语辨析456组", "path": str(args.discrimination), "entries": len(distinctions)},
            ],
            "extraction": "PDF text extraction + local RapidOCR; source files never leave this computer",
        },
        "items": items,
    }
    report = {
        "generatedAt": generated_at,
        "upper": upper_report,
        "lower": lower_report,
        "shihaiDuplicates": duplicates,
        "discrimination": discrimination_report,
        "outputTotal": len(items),
        "fatalErrors": fatal_errors,
    }
    BUILD_REPORT.parent.mkdir(parents=True, exist_ok=True)
    BUILD_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if fatal_errors:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise RuntimeError("; ".join(fatal_errors))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(args.output),
                "total": len(items),
                "shihaiUnique": len(shihai),
                "wordDiscriminationGroups": len(distinctions),
                "averageOcrConfidence": discrimination_report["averageOcrConfidence"],
                "report": str(BUILD_REPORT),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
