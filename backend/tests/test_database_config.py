from app.database import normalize_database_url


def test_render_postgresql_connection_strings_use_psycopg():
    assert normalize_database_url("postgresql://user:password@host/db") == "postgresql+psycopg://user:password@host/db"
    assert normalize_database_url("postgres://user:password@host/db") == "postgresql+psycopg://user:password@host/db"


def test_sqlite_connection_string_is_unchanged():
    assert normalize_database_url("sqlite:///./nesafe.db") == "sqlite:///./nesafe.db"
