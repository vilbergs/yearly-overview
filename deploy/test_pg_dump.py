import importlib.util
import os
import stat
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pg_dump", Path(__file__).with_name("pg-dump.py"))
dump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dump)


class DumpTests(unittest.TestCase):
    def test_encoded_password_and_connection_options(self):
        url, password = dump.connection(
            "postgres://user:p%40ss%3Aword@localhost/db?sslmode=require"
        )
        self.assertEqual(url, "postgres://user@localhost/db?sslmode=require")
        self.assertEqual(password, "p@ss:word")

    def test_query_password_overrides_userinfo_without_leaking(self):
        url, password = dump.connection(
            "postgresql://user:old@[::1]:5432/db?password=new%26secret&sslmode=disable"
        )
        self.assertEqual(url, "postgresql://user@[::1]:5432/db?sslmode=disable")
        self.assertEqual(password, "new&secret")

    def test_no_password_preserves_connection(self):
        url = "postgres://user@localhost/db"
        self.assertEqual(dump.connection(url), (url, None))

    def test_rejects_newline_in_password(self):
        with self.assertRaises(ValueError):
            dump.connection("postgres://user:bad%0Apass@localhost/db")

    def test_private_password_file_and_cleanup_on_dump_failure(self):
        password_files = []

        def run(args, env):
            self.assertEqual(args[-1], "postgres://user@localhost/db")
            self.assertNotIn("DATABASE_URL", env)
            self.assertNotIn("PGPASSWORD", env)
            path = Path(env["PGPASSFILE"])
            password_files.append(path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.read_text(), "*:*:*:*:p\\:a\\\\ss\n")
            return 1

        with patch.dict(os.environ, {"DATABASE_URL": "postgres://user:p%3Aa%5Css@localhost/db"}), \
             patch.object(sys, "argv", ["pg-dump.py", "/tmp/backup.partial"]), \
             patch.object(dump.subprocess, "call", side_effect=run):
            self.assertEqual(dump.main(), 1)
        self.assertFalse(password_files[0].exists())


if __name__ == "__main__":
    unittest.main()
