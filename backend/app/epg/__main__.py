"""EPG command line.

    python -m app.epg add <url-or-path> [--label NAME]   register an XMLTV source
    python -m app.epg refresh                             reload all sources
    python -m app.epg channels-xml --country GB -o custom.channels.xml
    python -m app.epg demo                                load a generated demo guide
    python -m app.epg list
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from .. import config, db
from . import channels_xml, demo, ingest


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(prog="python -m app.epg", description=__doc__,
                                 formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--db", type=Path, default=config.DB_PATH)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("location")
    a.add_argument("--label")
    sub.add_parser("refresh")
    sub.add_parser("list")
    sub.add_parser("demo")
    c = sub.add_parser("channels-xml")
    c.add_argument("--country")
    c.add_argument("--category")
    c.add_argument("--ids", help="comma-separated channel ids")
    c.add_argument("--limit", type=int, default=500)
    c.add_argument("-o", "--output", type=Path, default=Path("custom.channels.xml"))
    args = ap.parse_args()

    conn = db.connect(args.db)
    db.init(conn)
    ingest.ensure_guide_feed_table(conn)

    if args.cmd == "add":
        sid = ingest.add_source(conn, args.location, args.label)
        print(json.dumps(ingest.refresh_source(conn, sid), indent=2))
        ingest.rebuild_indexes(conn)
    elif args.cmd == "demo":
        sid = ingest.add_source(conn, demo.DEMO_LOCATION, "Demo guide (generated)")
        print(json.dumps(ingest.refresh_source(conn, sid), indent=2))
        ingest.rebuild_indexes(conn)
    elif args.cmd == "refresh":
        print(json.dumps(ingest.refresh_all(conn), indent=2))
    elif args.cmd == "list":
        for r in conn.execute("SELECT * FROM epg_sources ORDER BY id"):
            print(dict(r))
    elif args.cmd == "channels-xml":
        ids = [i.strip() for i in args.ids.split(",")] if args.ids else None
        entries = channels_xml.select_entries(conn, ids, args.country, args.category, args.limit)
        args.output.write_text(channels_xml.render(entries), "utf-8")
        print(f"wrote {len(entries)} channels to {args.output}")


if __name__ == "__main__":
    main()
