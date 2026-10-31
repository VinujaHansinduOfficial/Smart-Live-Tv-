"""Streaming XMLTV parser.

Reads <channel> and <programme> elements one at a time so multi-hundred-MB
guides do not need to fit in memory. Handles plain and gzip input.
"""
from __future__ import annotations

import gzip
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import IO, Iterator, Union

_TIME_RE = re.compile(r"^\s*(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{2}:?\d{2}|Z|UTC|GMT)?")


def parse_time(value: str | None) -> int | None:
    """Parse an XMLTV timestamp ('20261031183000 +0530') to unix seconds."""
    if not value:
        return None
    m = _TIME_RE.match(value)
    if not m:
        return None
    y, mo, d, h, mi, s, tz = m.groups()
    dt = datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0), int(s or 0))
    offset = timedelta(0)
    if tz and tz not in ("Z", "UTC", "GMT"):
        tz = tz.replace(":", "")
        sign = -1 if tz[0] == "-" else 1
        offset = sign * timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5]))
    return int((dt - offset).replace(tzinfo=timezone.utc).timestamp())


@dataclass
class XChannel:
    id: str
    names: list[str] = field(default_factory=list)
    icon: str | None = None


@dataclass
class XProgramme:
    channel: str
    start: int
    stop: int
    title: str
    sub_title: str | None = None
    description: str | None = None
    categories: list[str] = field(default_factory=list)
    episode: str | None = None
    rating: str | None = None
    icon: str | None = None


def _text(el: ET.Element, tag: str, lang_pref: str | None) -> str | None:
    best = None
    for child in el.findall(tag):
        text = (child.text or "").strip()
        if not text:
            continue
        if best is None:
            best = text
        if lang_pref and child.get("lang", "").lower().startswith(lang_pref):
            return text
    return best


def _episode(el: ET.Element) -> str | None:
    onscreen = None
    ns = None
    for ep in el.findall("episode-num"):
        text = (ep.text or "").strip()
        if not text:
            continue
        if ep.get("system") == "onscreen":
            onscreen = text
        elif ep.get("system") == "xmltv_ns":
            parts = [p.split("/")[0].strip() for p in text.split(".")]
            try:
                season = int(parts[0]) + 1 if parts[0] else None
                episode = int(parts[1]) + 1 if len(parts) > 1 and parts[1] else None
            except ValueError:
                continue
            if season and episode:
                ns = f"S{season:02d}E{episode:02d}"
            elif episode:
                ns = f"E{episode}"
    return onscreen or ns


Item = Union[XChannel, XProgramme]


def open_source(data: bytes | IO[bytes]) -> IO[bytes]:
    stream = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    head = stream.read(2)
    stream.seek(0)
    if head == b"\x1f\x8b":
        return gzip.GzipFile(fileobj=stream)
    return stream


def iter_xmltv(data: bytes | IO[bytes], lang_pref: str | None = None) -> Iterator[Item]:
    stream = open_source(data)
    for _, el in ET.iterparse(stream, events=("end",)):
        if el.tag == "channel":
            names = [(n.text or "").strip() for n in el.findall("display-name") if (n.text or "").strip()]
            icon = el.find("icon")
            yield XChannel(id=el.get("id", ""), names=names, icon=icon.get("src") if icon is not None else None)
            el.clear()
        elif el.tag == "programme":
            start = parse_time(el.get("start"))
            stop = parse_time(el.get("stop"))
            title = _text(el, "title", lang_pref)
            if start is not None and title:
                if stop is None or stop <= start:
                    stop = start + 30 * 60   # missing stop: assume half an hour
                rating_el = el.find("rating/value")
                icon = el.find("icon")
                yield XProgramme(
                    channel=el.get("channel", ""),
                    start=start, stop=stop, title=title,
                    sub_title=_text(el, "sub-title", lang_pref),
                    description=_text(el, "desc", lang_pref),
                    categories=[(c.text or "").strip() for c in el.findall("category") if (c.text or "").strip()],
                    episode=_episode(el),
                    rating=(rating_el.text or "").strip() if rating_el is not None and rating_el.text else None,
                    icon=icon.get("src") if icon is not None else None,
                )
            el.clear()
