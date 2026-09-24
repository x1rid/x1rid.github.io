#!/usr/bin/env python3
"""
Local development server for the retro homepage with automatic /playlist/ directory scanning.
Any audio file dropped into /playlist/ or /main/playlist/ is immediately discovered.
Run with:
    python serve.py [port]
Defaults to port 5500.
"""

import http.server
import json
import os
import sys
import urllib.parse

AUDIO_EXTENSIONS = {'.opus', '.ogg', '.mp3', '.wav', '.m4a'}

class PlaylistDevHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        norm_path = parsed_url.path.rstrip('/')

        # Expose automatic JSON file listing for /playlist or /main/playlist
        if norm_path in ['/playlist', '/main/playlist']:
            candidate_dirs = [
                os.path.join(os.getcwd(), 'main', 'playlist'),
                os.path.join(os.getcwd(), norm_path.lstrip('/')),
                os.path.join(os.getcwd(), 'playlist')
            ]
            found_dir = None
            for d in candidate_dirs:
                if d and os.path.isdir(d):
                    found_dir = d
                    break

            files = []
            if found_dir:
                try:
                    for f in sorted(os.listdir(found_dir)):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in AUDIO_EXTENSIONS and os.path.isfile(os.path.join(found_dir, f)):
                            files.append(f)
                except Exception as err:
                    print(f"Error reading playlist directory: {err}")

            data = json.dumps(files).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        super().do_GET()

def run(port=5500):
    server_address = ('', port)
    httpd = http.server.ThreadingHTTPServer(server_address, PlaylistDevHandler)
    print(f"Retro Homepage Dev Server running at http://127.0.0.1:{port}/")
    print("Serving files and live /playlist/ discovery. Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    port = 5500
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run(port)
