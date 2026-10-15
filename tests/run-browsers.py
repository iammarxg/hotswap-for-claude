"""Isolated headless browser profiles; only synthetic fixtures, no user profiles.
No new package dependency. Requires installed Chrome and Firefox on Windows.
"""
import http.server
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
results = queue.Queue()
exchange = {}

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript'}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        print('HTTP', args[0] % args[1:], flush=True)
    def end_headers(self):
        self.send_header('Content-Security-Policy', "script-src 'self'; object-src 'self'")
        super().end_headers()
    def do_GET(self):
        if self.path.startswith('/exchange/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(exchange.get(self.path)).encode())
        else:
            super().do_GET()
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/result':
            results.put(data)
        else:
            exchange[self.path] = data
        self.send_response(200)
        self.end_headers()

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
all_results = []
try:
    for target, cross in [('chrome', False), ('firefox', False), ('chrome', True)]:
        # Profiles intentionally remain in ignored temp/ for review; no recursive
        # shell deletion and no interaction with the user's actual browser data.
        scratch = ROOT / 'temp'
        scratch.mkdir(exist_ok=True)
        profile = tempfile.mkdtemp(prefix=f'backup-test-{target}-', dir=scratch)
        url = f'http://127.0.0.1:{server.server_port}/tests/browser.html?target={target}' + ('&cross=1' if cross else '')
        print('Testing', target, url, flush=True)
        if target == 'chrome':
            command = [os.environ['PROGRAMFILES'] + '/Google/Chrome/Application/chrome.exe', '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', '--user-data-dir=' + profile, url]
        else:
            command = [os.environ['PROGRAMFILES'] + '/Mozilla Firefox/firefox.exe', '-headless', '-no-remote', '-profile', profile, url]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 90
            while True:
                try:
                    result = results.get(timeout=1)
                    break
                except queue.Empty:
                    if process.poll() is not None or time.monotonic() > deadline:
                        result = {'target': target, 'ok': False, 'error': 'Browser exited or did not return results', 'exitCode': process.poll()}
                        break
            all_results.append(result)
            print(json.dumps(result), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
finally:
    server.shutdown()
report = ROOT / 'docs/security/browser-results-verified.json'
report.write_text(json.dumps(all_results, indent=2) + '\n', encoding='utf-8')
if len(all_results) != 3 or not all(r.get('ok') for r in all_results):
    raise SystemExit(1)
