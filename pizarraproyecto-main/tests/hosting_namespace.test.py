"""Test the real Python auth/storage routes with a disposable database.

ChatGPT browser automation is unrelated to hosting and is stubbed out so this
check doesn't need Scrapling or an interactive browser session.
"""
import http.cookiejar
import importlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from urllib.request import HTTPCookieProcessor, Request, build_opener

import uvicorn


class HostingNamespaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory(prefix="cursado-hosting-test-")
        cls.target = Path(cls.storage.name).resolve()
        assert cls.target.parent == Path(tempfile.gettempdir()).resolve()
        board_root = Path(__file__).resolve().parents[1]
        os.environ["PIZARRA_DATA_DIR"] = str(cls.target)
        os.environ["PIZARRA_FRONTEND_DIR"] = str(board_root / "dist")
        sys.path.insert(0, str(board_root))
        automation = types.ModuleType("reconocimiento_local.chatgpt_browser")
        automation.attach_chatgpt_browser = lambda app: None
        sys.modules[automation.__name__] = automation
        app = importlib.import_module("web_host").app
        cls.sock = socket.socket()
        cls.sock.bind(("127.0.0.1", 0))
        cls.origin = f"http://127.0.0.1:{cls.sock.getsockname()[1]}"
        cls.server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        cls.thread = threading.Thread(target=cls.server.run, kwargs={"sockets": [cls.sock]}, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 10
        while not cls.server.started and time.monotonic() < deadline:
            time.sleep(.02)
        assert cls.server.started

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.sock.close()
        assert not cls.thread.is_alive()
        assert cls.target.parent == Path(tempfile.gettempdir()).resolve()
        cls.storage.cleanup()

    def test_namespaced_ui_and_api_keep_original_auth_and_board_routes(self):
        jar = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(jar))
        with opener.open(self.origin + "/?invite=example") as response:
            self.assertEqual(response.url, self.origin + "/pizarra/?invite=example")
            self.assertIn(b"/pizarra/assets/", response.read())

        def api(path, payload=None):
            request = Request(self.origin + path,
                              data=json.dumps(payload).encode() if payload is not None else None,
                              headers={"Content-Type": "application/json"})
            with opener.open(request) as response:
                return json.load(response)

        user = api("/pizarra/api/auth/guest", {"name": "Hosting test", "password": "test-password-123", "color": "#6366f1"})
        cookie = next(cookie for cookie in jar if cookie.name == "pizarra_sid")
        self.assertEqual(cookie.path, "/")
        self.assertTrue(cookie.has_nonstandard_attr("HttpOnly"))
        self.assertEqual(api("/pizarra/api/auth/me")["id"], user["id"])
        self.assertEqual(api("/api/auth/me")["id"], user["id"])
        board = api("/pizarra/api/boards", {"name": "Shared test", "folder_id": None})
        self.assertEqual(api(f"/api/boards/{board['id']}")["id"], board["id"])
        self.assertEqual(api(f"/pizarra/api/boards/{board['id']}")["id"], board["id"])


if __name__ == "__main__":
    unittest.main()
