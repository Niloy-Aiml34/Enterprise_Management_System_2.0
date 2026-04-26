import sqlite3
import os
import re
import pandas as pd

_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.db")


def sanitize_name(filename: str) -> str:
    """Convert a filename to a valid SQLite table name (lowercase, alphanum + underscore)."""
    name = os.path.splitext(filename)[0]
    name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name or name[0].isdigit():
        name = "t_" + name
    return name.lower()


def get_available_name(base: str) -> tuple:
    """Return (final_name, was_renamed). Auto-numbers if base already exists."""
    existing = set(list_tables())
    if base not in existing:
        return base, False
    i = 2
    while f"{base}_{i}" in existing:
        i += 1
    return f"{base}_{i}", True


def list_tables() -> list:
    """Return all user-created table names."""
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            return [r[0] for r in cur.fetchall()]
    except Exception:
        return []


def load_dataframe(df: pd.DataFrame, table_name: str) -> tuple:
    """Load a DataFrame into a named SQLite table, replacing if it exists."""
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            df.to_sql(table_name, conn, if_exists="replace", index=False)
        return True, f"Loaded {len(df)} rows × {len(df.columns)} columns into '{table_name}'."
    except Exception as e:
        return False, str(e)


def load_table_as_df(table_name: str) -> pd.DataFrame:
    """Load a full SQLite table into a DataFrame."""
    with sqlite3.connect(_DB_PATH) as conn:
        return pd.read_sql_query(f'SELECT * FROM "{table_name}"', conn)


def run_query(sql: str) -> tuple:
    """Execute a SELECT query. Returns (list[dict] | None, error_str | None)."""
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            cursor = conn.execute(sql)
            if cursor.description is None:
                return [], None
            columns = [d[0] for d in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return rows, None
    except Exception as e:
        return None, str(e)


def get_schema(table_name: str) -> str:
    """Return the CREATE TABLE SQL for the given table."""
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            cur = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (table_name,)
            )
            row = cur.fetchone()
            return row[0] if row else ""
    except Exception:
        return ""


def get_preview(table_name: str, n: int = 5) -> tuple:
    """Return (columns, rows) for the first n rows."""
    rows, err = run_query(f'SELECT * FROM "{table_name}" LIMIT {n}')
    if err or not rows:
        return [], []
    return list(rows[0].keys()), rows


def get_table_info(table_name: str) -> dict:
    """Return {row_count, column_count, columns} by querying SQLite directly."""
    cols, _ = get_preview(table_name, 1)
    count_rows, _ = run_query(f'SELECT COUNT(*) as cnt FROM "{table_name}"')
    count = count_rows[0]["cnt"] if count_rows else 0
    return {"row_count": count, "column_count": len(cols), "columns": cols}


def delete_table(table_name: str) -> tuple:
    """Drop a table. Returns (success, error_str | None)."""
    try:
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
        return True, None
    except Exception as e:
        return False, str(e)
