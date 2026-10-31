"""VOD (Movies, Series & On-Demand Media) Router."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..deps import current_profile, get_conn

router = APIRouter(prefix="/api/vod", tags=["vod"])

# Curated initial high-quality VOD catalog to ensure immediate playable library
INITIAL_MOVIES = [
    {
        "id": "movie-tears-of-steel",
        "type": "movie",
        "title": "Tears of Steel",
        "original_title": "Tears of Steel",
        "overview": "Set in a dystopian future in Amsterdam, a group of scientists and soldiers attempt to rescue the world from destructive robots using retro-futuristic technology.",
        "poster": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Tears_of_Steel_poster.jpg/440px-Tears_of_Steel_poster.jpg",
        "backdrop": "https://mango.blender.org/wp-content/uploads/2012/09/01_render_01_comp_00000.png",
        "release_date": "2012-09-12",
        "genre": ["Sci-Fi", "Action", "Short"],
        "rating": 7.8,
        "duration_min": 12,
        "trailer_url": "https://www.youtube.com/watch?v=R6MlUcmOul8",
        "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        "container_extension": "mp4",
    },
    {
        "id": "movie-big-buck-bunny",
        "type": "movie",
        "title": "Big Buck Bunny",
        "original_title": "Big Buck Bunny",
        "overview": "A large and lovable rabbit deals with bullying forest creatures in this groundbreaking open-source animation masterpiece.",
        "poster": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/440px-Big_buck_bunny_poster_big.jpg",
        "backdrop": "https://peach.blender.org/wp-content/uploads/bbb-splash.png",
        "release_date": "2008-04-10",
        "genre": ["Animation", "Comedy", "Family"],
        "rating": 8.1,
        "duration_min": 10,
        "trailer_url": "https://www.youtube.com/watch?v=YE7VzlLtp-4",
        "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        "container_extension": "mp4",
    },
    {
        "id": "movie-sintel",
        "type": "movie",
        "title": "Sintel",
        "original_title": "Sintel",
        "overview": "A lonely young woman searches the dangerous wilderness for a baby dragon she befriended and nursed back to health.",
        "poster": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/440px-Sintel_poster.jpg",
        "backdrop": "https://durian.blender.org/wp-content/uploads/2010/09/sintel_and_scales_02.jpg",
        "release_date": "2010-09-27",
        "genre": ["Animation", "Fantasy", "Drama"],
        "rating": 8.4,
        "duration_min": 15,
        "trailer_url": "https://www.youtube.com/watch?v=eRsGyueVLvQ",
        "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
        "container_extension": "mp4",
    },
    {
        "id": "movie-cosmos-laundromat",
        "type": "movie",
        "title": "Cosmos Laundromat",
        "original_title": "Cosmos Laundromat",
        "overview": "On a desolate island, a suicidal sheep named Franck meets a quirky salesman who offers him the adventure of a lifetime.",
        "poster": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Cosmos_Laundromat_Poster.jpg/440px-Cosmos_Laundromat_Poster.jpg",
        "backdrop": "https://gooseberry.blender.org/wp-content/uploads/2015/07/shot01_still.png",
        "release_date": "2015-08-10",
        "genre": ["Animation", "Sci-Fi", "Comedy"],
        "rating": 7.9,
        "duration_min": 12,
        "trailer_url": "https://www.youtube.com/watch?v=Y-rmzh0PI3c",
        "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4",
        "container_extension": "mp4",
    },
    {
        "id": "movie-night-of-the-living-dead",
        "type": "movie",
        "title": "Night of the Living Dead",
        "original_title": "Night of the Living Dead",
        "overview": "A ragtag group of Pennsylvanians barricade themselves in an old farmhouse to remain safe from a horde of flesh-eating zombies in this George A. Romero classic.",
        "poster": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Night_of_the_Living_Dead_%281968%29_theatrical_poster.jpg/440px-Night_of_the_Living_Dead_%281968%29_theatrical_poster.jpg",
        "backdrop": "https://upload.wikimedia.org/wikipedia/commons/f/fc/Night_of_the_Living_Dead_still.jpg",
        "release_date": "1968-10-01",
        "genre": ["Horror", "Classic", "Thriller"],
        "rating": 7.9,
        "duration_min": 96,
        "trailer_url": "",
        "stream_url": "https://ia800301.us.archive.org/1/items/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4",
        "container_extension": "mp4",
    },
]

INITIAL_SERIES = [
    {
        "id": "series-nature-wonders",
        "type": "series",
        "title": "Wonders of the Earth",
        "original_title": "Wonders of the Earth",
        "overview": "An awe-inspiring natural history documentary series capturing the extraordinary diversity and beauty of planet Earth.",
        "poster": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80",
        "backdrop": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80",
        "release_date": "2023-01-15",
        "genre": ["Documentary", "Nature", "Science"],
        "rating": 9.2,
        "duration_min": 45,
        "trailer_url": "",
        "episodes": [
            {
                "id": "ep-earth-1-1",
                "season_num": 1,
                "episode_num": 1,
                "title": "Living Oceans & Coral Kingdoms",
                "overview": "Explore the vibrant marine ecosystems and underwater kingdoms thriving in the deep seas.",
                "duration_min": 15,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
                "rating": 9.3,
            },
            {
                "id": "ep-earth-1-2",
                "season_num": 1,
                "episode_num": 2,
                "title": "Mountain Peaks & Glaciers",
                "overview": "Ascend the tallest peaks and witness the icy glaciers sculpting our continents.",
                "duration_min": 15,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
                "rating": 9.1,
            },
            {
                "id": "ep-earth-1-3",
                "season_num": 1,
                "episode_num": 3,
                "title": "Ancient Rainforests",
                "overview": "Journey through dense tropical canopies harboring over half of the world's species.",
                "duration_min": 15,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
                "rating": 9.4,
            },
        ],
    },
    {
        "id": "series-space-frontiers",
        "type": "series",
        "title": "Cosmic Frontiers",
        "original_title": "Cosmic Frontiers",
        "overview": "Journey to the outer reaches of the known universe with deep-space observatory images, planetary rovers, and astrophysicists.",
        "poster": "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=600&auto=format&fit=crop&q=80",
        "backdrop": "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=1200&auto=format&fit=crop&q=80",
        "release_date": "2024-03-20",
        "genre": ["Sci-Fi", "Documentary", "Space"],
        "rating": 8.9,
        "duration_min": 40,
        "trailer_url": "",
        "episodes": [
            {
                "id": "ep-space-1-1",
                "season_num": 1,
                "episode_num": 1,
                "title": "Secrets of the Solar System",
                "overview": "Exploring volcanic moons and subterranean oceans across our neighbouring planets.",
                "duration_min": 15,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
                "rating": 8.8,
            },
            {
                "id": "ep-space-1-2",
                "season_num": 1,
                "episode_num": 2,
                "title": "Black Holes & Gravitational Waves",
                "overview": "How relativistic monsters bend light and spacetime at the centers of distant galaxies.",
                "duration_min": 15,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
                "rating": 9.0,
            },
        ],
    },
]


def ensure_seed_vod(conn: sqlite3.Connection):
    """Populates the database with initial curated VOD if empty."""
    count = conn.execute("SELECT COUNT(*) FROM vod_items").fetchone()[0]
    if count > 0:
        return

    now = int(time.time())
    with db.transaction(conn):
        for m in INITIAL_MOVIES:
            conn.execute(
                """
                INSERT OR IGNORE INTO vod_items(
                    id, type, title, original_title, overview, poster, backdrop,
                    release_date, genre, rating, duration_min, trailer_url,
                    stream_url, container_extension, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    m["id"], m["type"], m["title"], m["original_title"], m["overview"],
                    m["poster"], m["backdrop"], m["release_date"], db.jdump(m["genre"]),
                    m["rating"], m["duration_min"], m["trailer_url"], m["stream_url"],
                    m["container_extension"], now,
                ),
            )
            try:
                conn.execute(
                    "INSERT INTO vod_fts(id, title, original_title, overview, genre) VALUES (?,?,?,?,?)",
                    (m["id"], m["title"], m["original_title"], m["overview"], " ".join(m["genre"])),
                )
            except Exception:
                pass

        for s in INITIAL_SERIES:
            conn.execute(
                """
                INSERT OR IGNORE INTO vod_items(
                    id, type, title, original_title, overview, poster, backdrop,
                    release_date, genre, rating, duration_min, trailer_url,
                    created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    s["id"], s["type"], s["title"], s["original_title"], s["overview"],
                    s["poster"], s["backdrop"], s["release_date"], db.jdump(s["genre"]),
                    s["rating"], s["duration_min"], s["trailer_url"], now,
                ),
            )
            try:
                conn.execute(
                    "INSERT INTO vod_fts(id, title, original_title, overview, genre) VALUES (?,?,?,?,?)",
                    (s["id"], s["title"], s["original_title"], s["overview"], " ".join(s["genre"])),
                )
            except Exception:
                pass

            for ep in s["episodes"]:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO vod_series_episodes(
                        id, series_id, season_num, episode_num, title, overview,
                        duration_min, stream_url, rating
                    ) VALUES (?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        ep["id"], s["id"], ep["season_num"], ep["episode_num"],
                        ep["title"], ep["overview"], ep["duration_min"],
                        ep["stream_url"], ep["rating"],
                    ),
                )


class ProgressUpdate(BaseModel):
    item_id: str
    series_id: str | None = None
    watched_s: int = Field(ge=0)
    total_s: int = Field(ge=0)
    completed: bool = False


@router.get("/featured")
def get_featured_vod(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    ensure_seed_vod(conn)
    now = int(time.time())

    hero = conn.execute("SELECT * FROM vod_items ORDER BY rating DESC LIMIT 1").fetchone()
    movies = conn.execute("SELECT * FROM vod_items WHERE type = 'movie' ORDER BY rating DESC LIMIT 10").fetchall()
    series = conn.execute("SELECT * FROM vod_items WHERE type = 'series' ORDER BY rating DESC LIMIT 10").fetchall()

    def serialize(r):
        return {
            "id": r["id"],
            "type": r["type"],
            "title": r["title"],
            "original_title": r["original_title"],
            "overview": r["overview"],
            "poster": r["poster"],
            "backdrop": r["backdrop"],
            "release_date": r["release_date"],
            "genre": db.jload(r["genre"], []),
            "rating": r["rating"],
            "duration_min": r["duration_min"],
            "trailer_url": r["trailer_url"],
            "stream_url": r["stream_url"] if "stream_url" in r.keys() else None,
        }

    return {
        "hero": serialize(hero) if hero else None,
        "movies": [serialize(r) for r in movies],
        "series": [serialize(r) for r in series],
    }


@router.get("/movies")
def list_movies(
    genre: str | None = None,
    q: str | None = None,
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    ensure_seed_vod(conn)
    where = ["type = 'movie'"]
    params: list = []

    if q:
        where.append("(title LIKE ? OR overview LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if genre:
        where.append("genre LIKE ?")
        params.append(f'%"{genre}"%')

    sql_where = " WHERE " + " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM vod_items{sql_where}", params).fetchone()[0]
    rows = conn.execute(f"SELECT * FROM vod_items{sql_where} ORDER BY rating DESC LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "type": "movie",
            "title": r["title"],
            "overview": r["overview"],
            "poster": r["poster"],
            "backdrop": r["backdrop"],
            "release_date": r["release_date"],
            "genre": db.jload(r["genre"], []),
            "rating": r["rating"],
            "duration_min": r["duration_min"],
            "stream_url": r["stream_url"],
        })

    return {"items": items, "total": total}


@router.get("/series")
def list_series(
    genre: str | None = None,
    q: str | None = None,
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    ensure_seed_vod(conn)
    where = ["type = 'series'"]
    params: list = []

    if q:
        where.append("(title LIKE ? OR overview LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if genre:
        where.append("genre LIKE ?")
        params.append(f'%"{genre}"%')

    sql_where = " WHERE " + " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM vod_items{sql_where}", params).fetchone()[0]
    rows = conn.execute(f"SELECT * FROM vod_items{sql_where} ORDER BY rating DESC LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "type": "series",
            "title": r["title"],
            "overview": r["overview"],
            "poster": r["poster"],
            "backdrop": r["backdrop"],
            "release_date": r["release_date"],
            "genre": db.jload(r["genre"], []),
            "rating": r["rating"],
            "duration_min": r["duration_min"],
        })

    return {"items": items, "total": total}


@router.get("/item/{item_id}")
def get_vod_detail(
    item_id: str,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    ensure_seed_vod(conn)
    row = conn.execute("SELECT * FROM vod_items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "VOD item not found")

    item = {
        "id": row["id"],
        "type": row["type"],
        "title": row["title"],
        "original_title": row["original_title"],
        "overview": row["overview"],
        "poster": row["poster"],
        "backdrop": row["backdrop"],
        "release_date": row["release_date"],
        "genre": db.jload(row["genre"], []),
        "rating": row["rating"],
        "duration_min": row["duration_min"],
        "trailer_url": row["trailer_url"],
        "stream_url": row["stream_url"] if "stream_url" in row.keys() else None,
    }

    # Fetch seasons and episodes if series
    if row["type"] == "series":
        ep_rows = conn.execute(
            "SELECT * FROM vod_series_episodes WHERE series_id = ? ORDER BY season_num, episode_num",
            (item_id,),
        ).fetchall()
        seasons: dict[int, list[dict[str, Any]]] = {}
        for ep in ep_rows:
            s_num = ep["season_num"]
            if s_num not in seasons:
                seasons[s_num] = []
            seasons[s_num].append({
                "id": ep["id"],
                "season_num": ep["season_num"],
                "episode_num": ep["episode_num"],
                "title": ep["title"],
                "overview": ep["overview"],
                "still_path": ep["still_path"],
                "duration_min": ep["duration_min"],
                "stream_url": ep["stream_url"],
                "rating": ep["rating"],
            })
        item["seasons"] = [{"season_num": k, "episodes": v} for k, v in sorted(seasons.items())]

    # Watch progress if any
    prog = conn.execute(
        "SELECT * FROM vod_progress WHERE profile_id = ? AND item_id = ?",
        (profile["id"], item_id),
    ).fetchone()
    item["progress"] = {
        "watched_s": prog["watched_s"],
        "total_s": prog["total_s"],
        "completed": bool(prog["completed"]),
    } if prog else None

    return item


@router.get("/continue")
def get_vod_continue(
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[dict[str, Any]]:
    ensure_seed_vod(conn)
    rows = conn.execute(
        """
        SELECT vp.*, vi.title, vi.poster, vi.type, vi.stream_url
        FROM vod_progress vp
        JOIN vod_items vi ON vi.id = vp.item_id
        WHERE vp.profile_id = ? AND vp.completed = 0
        ORDER BY vp.last_seen_at DESC LIMIT 10
        """,
        (profile["id"],),
    ).fetchall()

    return [
        {
            "item_id": r["item_id"],
            "series_id": r["series_id"],
            "title": r["title"],
            "poster": r["poster"],
            "type": r["type"],
            "stream_url": r["stream_url"],
            "watched_s": r["watched_s"],
            "total_s": r["total_s"],
            "percent": int(r["watched_s"] / max(1, r["total_s"]) * 100),
            "last_seen_at": r["last_seen_at"],
        }
        for r in rows
    ]


@router.post("/progress", status_code=204)
def save_progress(
    body: ProgressUpdate,
    profile: sqlite3.Row = Depends(current_profile),
    conn: sqlite3.Connection = Depends(get_conn),
):
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO vod_progress(profile_id, item_id, series_id, watched_s, total_s, completed, last_seen_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(profile_id, item_id) DO UPDATE SET
            watched_s = excluded.watched_s,
            total_s = excluded.total_s,
            completed = excluded.completed,
            last_seen_at = excluded.last_seen_at
        """,
        (profile["id"], body.item_id, body.series_id, body.watched_s, body.total_s, int(body.completed), now),
    )
