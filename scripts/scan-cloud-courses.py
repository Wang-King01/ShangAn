"""Build a metadata-only index of the selected Baidu Netdisk course folders."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path


PRIMARY_CLOUD_ROOT = "/考公资料/26 名师课程"
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m4v"}
TARGET_COURSES = [
    {
        "id": "guoxi-2027-twelve",
        "teacher": "郭熙",
        "module": "言语",
        "series": "2027 言语高分十二技",
        "path": f"{PRIMARY_CLOUD_ROOT}/【012】2027 年郭熙言语高分"十二技"",
    },
    {
        "id": "guoxi-2026-100",
        "teacher": "郭熙",
        "module": "言语",
        "series": "2026 言语考前必做 100 题",
        "path": f"{PRIMARY_CLOUD_ROOT}/2026 年郭熙言语考前必做 100 题",
    },
    {
        "id": "longfei-2026-foundation",
        "teacher": "龙飞",
        "module": "图推",
        "series": "2026 平面图推筑基先行班",
        "path": f"{PRIMARY_CLOUD_ROOT}/【003】2026 龙飞平面图形推理筑基先行班",
    },
    {
        "id": "longfei-2026-500",
        "teacher": "龙飞",
        "module": "图推",
        "series": "2026 平面图推 500 题",
        "path": f"{PRIMARY_CLOUD_ROOT}/【032】2026 年龙飞平面图推 500 题刷题精讲班",
    },
    {
        "id": "longfei-2026-solid",
        "teacher": "龙飞",
        "module": "图推",
        "series": "2026 立体图推理论刷题班",
        "path": f"{PRIMARY_CLOUD_ROOT}/【087】2026 年龙飞立体图推理论刷题班",
    },
    {
        "id": "longfei-2026-definition",
        "teacher": "龙飞",
        "module": "判断",
        "series": "2026 定义判断试题精讲",
        "path": f"{PRIMARY_CLOUD_ROOT}/【185】2026 年省考龙飞判断试题精讲定义判断",
    },
    {
        "id": "huasheng-2026-system",
        "teacher": "花生十三",
        "module": "判断",
        "series": "2026 飞扬笔试系统班",
        "path": f"{PRIMARY_CLOUD_ROOT}/【024】2026 年花生十三飞扬笔试系统班",
    },
    {
        "id": "gaozhao-2025-3plus2",
        "teacher": "高照",
        "module": "资料",
        "series": "2025 资料分析 3+2",
        "path": f"{PRIMARY_CLOUD_ROOT}/【033】2025 年高照资料分析理论实战班 3+2 学习法",
    },
    {
        "id": "gaozhao-2025-kuakua",
        "teacher": "高照",
        "module": "资料",
        "series": "2025 资料题型夸夸刷",
        "path": f"{PRIMARY_CLOUD_ROOT}/【083】2025 年高照资料题型夸夸刷刷题营",
    },
    {
        "id": "gaozhao-2025-cup",
        "teacher": "高照",
        "module": "资料",
        "series": "2025 资料分析超大杯 100 篇",
        "path": f"{PRIMARY_CLOUD_ROOT}/【107】2025 年高照资料分析超大杯刷题营【100 篇】",
    },
    {
        "id": "gaozhao-2025-quantity",
        "teacher": "高照",
        "module": "数量",
        "series": "2025 数量关系拿分稳稳班",
        "path": f"{PRIMARY_CLOUD_ROOT}/【057】2025 年高照数量关系拿分稳稳班",
    },
    {
        "id": "gaozhao-2026-number",
        "teacher": "高照",
        "module": "数量",
        "series": "2026 数字推理 460 题",
        "path": f"{PRIMARY_CLOUD_ROOT}/【140】2026 年高照数字推理 460 题",
    },
    {
        "id": "bailu-2021-60days",
        "teacher": "白鹭",
        "module": "申论",
        "series": "2021 申论 60 天上岸计划",
        "path": f"{PRIMARY_CLOUD_ROOT}/【00】已绝版课程【老师已不再授课】/【03】2021 年白鹭 60 天上岸计划（先听这个课）",
    },
    {
        "id": "bailu-2026-zamabu",
        "teacher": "白鹭",
        "module": "申论",
        "series": "2026 申论扎马步营 + 易行",
        "path": f"{PRIMARY_CLOUD_ROOT}/【019】2026 年白鹭申论扎马步营 + 易行",
    },
    {
        "id": "bailu-2026-poti",
        "teacher": "白鹭",
        "module": "申论",
        "series": "2026 申论破题阵突破营",
        "path": f"{PRIMARY_CLOUD_ROOT}/【047】2026 年白鹭申论破题阵突破营",
    },
    {
        "id": "bailu-2026-dianjiang",
        "teacher": "白鹭",
        "module": "申论",
        "series": "2026 申论点将台实战营",
        "path": f"{PRIMARY_CLOUD_ROOT}/【151】2026 年白鹭申论点将台实战营",
    },
    {
        "id": "bailu-2026-final",
        "teacher": "白鹭",
        "module": "申论",
        "series": "2026 申论大决战联考冲刺营",
        "path": f"{PRIMARY_CLOUD_ROOT}/【181】2026 年省考白鹭申论大决战联考冲刺营",
    },
    {
        "id": "current-affairs-2026",
        "teacher": "时政是条线",
        "module": "常识",
        "series": "2026 时政是条线",
        "path": f"{PRIMARY_CLOUD_ROOT}/【103】2026 年时政是条线",
    },
]


def normalize_cloud_path(path, root=PRIMARY_CLOUD_ROOT):
    """Normalize course paths to PRIMARY_CLOUD_ROOT.
    
    Baidu Netdisk may retain legacy folder names like /考公资料/25 年名师课程
    even after files are copied to new accounts. This function normalizes
    all course paths to the current PRIMARY_CLOUD_ROOT.
    """
    if not path:
        return path
    if path.startswith("/考公资料/25 年名师课程"):
        return path.replace("/考公资料/25 年名师课程", root)
    return path


def load_cookie_header() -> str: