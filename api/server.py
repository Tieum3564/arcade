#!/usr/bin/env python3
"""Neon Arcade API - tiny JSON API storing players and scores in SQLite.

Standard library only. Endpoints (all JSON):
  GET  /api/health
  POST /api/login        {"name"}                          -> {"name"}
  POST /api/scores       {"game", "name", "score", "level"} -> {"saved", "record", "best", "rank"}
  GET  /api/leaderboard?game=<id>&limit=10                 -> {"game", "entries": [{name, score, level, date}]}
  GET  /api/stats?name=<player>                            -> {"name", "games": {<id>: {best, rank}}}

Environment variables:
  ARCADE_DB            path of the SQLite file (default: ./data/arcade.db next to this script)
  ARCADE_HOST          bind address (default 0.0.0.0)
  ARCADE_PORT          port (default 8000)
  ARCADE_STATIC        optional folder to also serve static files (local development without Nginx)
  ARCADE_MAX_SCORE     highest accepted score (default 10000000)
  ARCADE_MIN_INTERVAL  minimum seconds between two scores of the same player (default 10)
  ARCADE_KEEP_SCORES   scores kept per player and game, the lowest are purged (default 20)

Administration (moderation):
  python server.py list-players
  python server.py ban "<name>"      delete the player's scores and forbid the name
  python server.py unban "<name>"
"""
import json
import os
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("ARCADE_DB") or os.path.join(BASE_DIR, "data", "arcade.db")
HOST = os.environ.get("ARCADE_HOST", "0.0.0.0")
PORT = int(os.environ.get("ARCADE_PORT", "8000"))
STATIC_DIR = os.environ.get("ARCADE_STATIC")
MAX_SCORE = int(os.environ.get("ARCADE_MAX_SCORE", "10000000"))
MIN_INTERVAL = float(os.environ.get("ARCADE_MIN_INTERVAL", "10"))
KEEP_SCORES = int(os.environ.get("ARCADE_KEEP_SCORES", "20"))

NAME_RE = re.compile(r"[\w .\-']{2,20}")
GAME_RE = re.compile(r"[a-z0-9-]{1,40}")
MAX_BODY = 4096

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL,
    banned     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scores (
    id         INTEGER PRIMARY KEY,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game       TEXT NOT NULL,
    score      INTEGER NOT NULL,
    level      INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_game_player ON scores (game, player_id, score DESC);
"""


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(players)")}
        if "banned" not in columns:  # databases created before moderation existed
            conn.execute("ALTER TABLE players ADD COLUMN banned INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    finally:
        conn.close()


def clean_name(value):
    # NFKC folds look-alike forms (full-width letters, ligatures...) into their canonical characters
    name = " ".join(unicodedata.normalize("NFKC", str(value or "")).split())
    if not NAME_RE.fullmatch(name):
        raise ApiError(400, "Nom de joueur invalide (2 à 20 caractères : lettres, chiffres, espace, - _ . ').")
    return name


def clean_game(value):
    game = str(value or "")
    if not GAME_RE.fullmatch(game):
        raise ApiError(400, "Identifiant de jeu invalide.")
    return game


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def get_or_create_player(conn, name):
    conn.execute("INSERT OR IGNORE INTO players (name, created_at) VALUES (?, ?)", (name, now()))
    player = conn.execute("SELECT id, name, banned FROM players WHERE name = ?", (name,)).fetchone()
    if player["banned"]:
        raise ApiError(403, "Ce nom de joueur n'est pas autorisé.")
    return player


def find_player(conn, name):
    return conn.execute("SELECT id, name FROM players WHERE name = ?", (name,)).fetchone()


# ---------------------------------------------------------------- handlers

def health(conn, query, body):
    conn.execute("SELECT 1").fetchone()
    return {"status": "ok"}


def login(conn, query, body):
    player = get_or_create_player(conn, clean_name(body.get("name")))
    return {"name": player["name"]}


def post_score(conn, query, body):
    name = clean_name(body.get("name"))
    game = clean_game(body.get("game"))
    score = body.get("score")
    if not is_int(score) or not 0 < score <= MAX_SCORE:
        raise ApiError(400, "Score invalide.")
    level = body.get("level")
    if not is_int(level) or not 0 <= level <= 100000:
        level = None

    player = get_or_create_player(conn, name)
    last = conn.execute("SELECT MAX(created_at) FROM scores WHERE player_id = ?", (player["id"],)).fetchone()[0]
    if last and (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds() < MIN_INTERVAL:
        raise ApiError(429, "Scores envoyés trop rapidement, réessayez plus tard.")
    previous = conn.execute(
        "SELECT MAX(score) FROM scores WHERE game = ? AND player_id = ?", (game, player["id"])
    ).fetchone()[0] or 0
    conn.execute(
        "INSERT INTO scores (player_id, game, score, level, created_at) VALUES (?, ?, ?, ?, ?)",
        (player["id"], game, score, level, now()),
    )
    # Bound the database size: only keep the best scores of each player per game
    conn.execute(
        """DELETE FROM scores WHERE game = ? AND player_id = ? AND id NOT IN (
               SELECT id FROM scores WHERE game = ? AND player_id = ? ORDER BY score DESC, created_at ASC LIMIT ?)""",
        (game, player["id"], game, player["id"], KEEP_SCORES),
    )
    best = max(previous, score)
    better = conn.execute(
        "SELECT COUNT(*) FROM (SELECT MAX(score) AS best FROM scores WHERE game = ? GROUP BY player_id) WHERE best > ?",
        (game, best),
    ).fetchone()[0]
    return {"saved": True, "record": score > previous, "best": best, "rank": better + 1}


def leaderboard(conn, query, body):
    game = clean_game(query.get("game"))
    try:
        limit = max(1, min(100, int(query.get("limit", 10))))
    except ValueError:
        limit = 10
    rows = conn.execute(
        """
        SELECT name, score, level, created_at FROM (
            SELECT p.name, s.score, s.level, s.created_at,
                   ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.score DESC, s.created_at ASC) AS rn
            FROM scores s JOIN players p ON p.id = s.player_id
            WHERE s.game = ?
        ) WHERE rn = 1
        ORDER BY score DESC, created_at ASC
        LIMIT ?
        """,
        (game, limit),
    ).fetchall()
    return {
        "game": game,
        "entries": [{"name": r["name"], "score": r["score"], "level": r["level"], "date": r["created_at"]} for r in rows],
    }


def stats(conn, query, body):
    name = clean_name(query.get("name"))
    player = find_player(conn, name)
    if not player:
        return {"name": name, "games": {}}
    rows = conn.execute(
        """
        WITH best AS (SELECT game, player_id, MAX(score) AS score FROM scores GROUP BY game, player_id)
        SELECT b.game, b.score,
               1 + (SELECT COUNT(*) FROM best o WHERE o.game = b.game AND o.score > b.score) AS rank
        FROM best b WHERE b.player_id = ?
        """,
        (player["id"],),
    ).fetchall()
    return {"name": player["name"], "games": {r["game"]: {"best": r["score"], "rank": r["rank"]} for r in rows}}


ROUTES = {
    ("GET", "/api/health"): health,
    ("POST", "/api/login"): login,
    ("POST", "/api/scores"): post_score,
    ("GET", "/api/leaderboard"): leaderboard,
    ("GET", "/api/stats"): stats,
}


# ---------------------------------------------------------------- HTTP layer

class Handler(SimpleHTTPRequestHandler):
    server_version = "NeonArcadeAPI"
    sys_version = ""  # do not disclose the Python version
    timeout = 15      # drop idle / slow connections

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR or BASE_DIR, **kwargs)

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        if STATIC_DIR and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_json(405, {"error": "Méthode non autorisée."})

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            if STATIC_DIR and method == "GET":
                return super().do_GET()
            return self.send_json(404, {"error": "Introuvable."})
        try:
            handler = ROUTES.get((method, url.path.rstrip("/")))
            if handler is None:
                raise ApiError(404, "Introuvable.")
            body = self.read_json() if method == "POST" else {}
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            conn = connect()
            try:
                result = handler(conn, query, body)
                conn.commit()
            finally:
                conn.close()
            self.send_json(200, result)
        except ApiError as e:
            self.send_json(e.status, {"error": e.message})
        except Exception as e:  # pragma: no cover - unexpected failure
            self.log_error("Unhandled error: %r", e)
            self.send_json(500, {"error": "Erreur interne du serveur."})

    def read_json(self):
        # Requiring JSON also blocks cross-site HTML form submissions (they cannot send this content type)
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "Content-Type application/json attendu.")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Requête invalide.")
        if length < 0:
            raise ApiError(400, "Requête invalide.")
        if length > MAX_BODY:
            raise ApiError(413, "Requête trop volumineuse.")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise ApiError(400, "JSON invalide.")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON invalide.")
        return data

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)


def admin(args):
    init_db()
    conn = connect()
    try:
        if args[0] == "list-players" and len(args) == 1:
            for r in conn.execute(
                """SELECT p.name, p.banned, p.created_at, COUNT(s.id) AS n, MAX(s.score) AS best
                   FROM players p LEFT JOIN scores s ON s.player_id = p.id GROUP BY p.id ORDER BY p.name"""
            ):
                flag = " [BANNI]" if r["banned"] else ""
                print(f"{r['name']}{flag}\tscores={r['n']}\tbest={r['best'] or 0}\tcréé={r['created_at']}")
        elif args[0] in ("ban", "unban") and len(args) == 2:
            name = clean_name(args[1])
            conn.execute("INSERT OR IGNORE INTO players (name, created_at) VALUES (?, ?)", (name, now()))
            conn.execute("UPDATE players SET banned = ? WHERE name = ?", (1 if args[0] == "ban" else 0, name))
            if args[0] == "ban":
                deleted = conn.execute(
                    "DELETE FROM scores WHERE player_id = (SELECT id FROM players WHERE name = ?)", (name,)
                ).rowcount
                print(f"{name} banni, {deleted} score(s) supprimé(s).")
            else:
                print(f"{name} réautorisé.")
            conn.commit()
        else:
            print(__doc__)
            return 2
    except ApiError as e:
        print(e.message)
        return 1
    finally:
        conn.close()
    return 0


def main():
    if len(sys.argv) > 1:
        return admin(sys.argv[1:])
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Neon Arcade API on http://{HOST}:{PORT} (db: {DB_PATH}, static: {STATIC_DIR or 'off'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
