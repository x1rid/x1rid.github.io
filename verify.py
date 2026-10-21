#!/usr/bin/env python3
"""
verify.py - zero-dependency static validation suite for x1rid.github.io

Run:  python verify.py

Checks (no pip installs, standard library only):
  1. Every .json file in the repo parses.
  2. Every referenced local asset actually exists on disk:
       - HTML: src="..." / href="..." (skips remote, #anchor, data:, mailto:, directory links)
       - CSS:  url(...)
       - Web app manifests: icons[].src
       - main/data/links.json: links[].icon / links[].gif
       - main/playlist/playlist.json: every track, plus any track missing from the manifest
  3. Every .js file passes `node --check` (skipped when node is unavailable).

Exit code 0 = all green, 1 = at least one error.
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {'.git', 'node_modules', '__pycache__'}

errors = []
warnings = []
checks = 0


def rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def walk(exts):
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name.lower().endswith(exts):
                yield os.path.join(dirpath, name)


def is_remote(url):
    return url.startswith((
        'http://', 'https://', '//', '#', 'data:', 'mailto:', 'tel:', 'javascript:', 'blob:',
        'about:', 'tg:',
    ))


def is_template(url):
    """Skip values built at runtime, e.g. src="${char.image}" inside inline JS."""
    return '$' in url or '{' in url or '}' in url


def resolve_ref(base_dir, url):
    """Return an absolute path for a local reference, or None when not checkable."""
    clean = url.split('#')[0].split('?')[0].strip()
    if not clean or clean.endswith('/'):
        return None  # directory / bare anchor
    if clean.startswith('/'):
        return os.path.normpath(os.path.join(ROOT, clean.lstrip('/')))
    return os.path.normpath(os.path.join(base_dir, clean))


def check_ref(base_dir, url, source, label):
    global checks
    if not url or is_remote(url) or is_template(url):
        return
    path = resolve_ref(base_dir, url)
    if path is None:
        return
    checks += 1
    if not os.path.exists(path):
        errors.append('{}: {} -> missing {} ({})'.format(rel(source), label, url, rel(path)))


# --------------------------------------------------------------------------- #
# 1. JSON syntax
# --------------------------------------------------------------------------- #
def check_json_files():
    for path in walk(('.json',)):
        checks_total[0] += 1
        try:
            with open(path, encoding='utf-8') as handle:
                json.load(handle)
        except Exception as exc:  # noqa: BLE001 - report anything
            errors.append('{}: invalid JSON ({})'.format(rel(path), exc))


# --------------------------------------------------------------------------- #
# 2. Referenced assets
# --------------------------------------------------------------------------- #
ATTR_RE = re.compile(r'\b(?:src|href)\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
CSS_URL_RE = re.compile(r'url\(\s*["\']?([^"\')]+)["\']?\s*\)', re.IGNORECASE)


def check_html_refs():
    for path in walk(('.html',)):
        with open(path, encoding='utf-8', errors='replace') as handle:
            text = handle.read()
        base = os.path.dirname(path)
        for url in ATTR_RE.findall(text):
            check_ref(base, url, path, 'src/href')


def check_css_refs():
    for path in walk(('.css',)):
        with open(path, encoding='utf-8', errors='replace') as handle:
            text = handle.read()
        base = os.path.dirname(path)
        for url in CSS_URL_RE.findall(text):
            check_ref(base, url, path, 'url()')


def check_manifests():
    for path in walk(('.json',)):
        try:
            with open(path, encoding='utf-8') as handle:
                data = json.load(handle)
        except Exception:  # noqa: BLE001 - already reported by check_json_files
            continue
        if not isinstance(data, dict) or 'icons' not in data:
            continue
        base = os.path.dirname(path)
        for icon in data.get('icons') or []:
            if isinstance(icon, dict):
                check_ref(base, str(icon.get('src', '')), path, 'manifest icon')


def check_links_data():
    path = os.path.join(ROOT, 'main', 'data', 'links.json')
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
    except Exception:  # noqa: BLE001
        return
    # Icon paths in links.json are relative to the page that renders them
    # (main/index.html), not to the JSON file itself.
    base = os.path.join(ROOT, 'main')
    for entry in (data.get('links') or []):
        for key in ('icon', 'gif'):
            value = entry.get(key)
            if value:
                check_ref(base, str(value), path, 'links.json ' + key)


def check_playlist():
    manifest = os.path.join(ROOT, 'main', 'playlist', 'playlist.json')
    if not os.path.exists(manifest):
        errors.append('main/playlist/playlist.json: missing')
        return
    try:
        with open(manifest, encoding='utf-8') as handle:
            tracks = json.load(handle)
    except Exception:  # noqa: BLE001
        return
    folder = os.path.dirname(manifest)
    listed = set()
    for track in tracks if isinstance(tracks, list) else []:
        listed.add(str(track))
        check_ref(folder, str(track), manifest, 'track')
    if os.path.isdir(folder):
        for name in sorted(os.listdir(folder)):
            if name.lower().endswith(('.opus', '.mp3', '.ogg', '.m4a')) and name not in listed:
                warnings.append('main/playlist/playlist.json: {} exists but is not listed'.format(name))


# --------------------------------------------------------------------------- #
# 3. JavaScript syntax
# --------------------------------------------------------------------------- #
def check_js_syntax():
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        warnings.append('node not available - skipped `node --check` on JavaScript files')
        return
    for path in walk(('.js',)):
        checks_total[0] += 1
        proc = subprocess.run(
            ['node', '--check', path], capture_output=True, text=True, cwd=ROOT,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout).strip().splitlines()
            errors.append('{}: syntax error ({})'.format(rel(path), detail[-1] if detail else 'unknown'))


checks_total = [0]


def main():
    check_json_files()
    check_manifests()
    check_links_data()
    check_playlist()
    check_html_refs()
    check_css_refs()
    check_js_syntax()

    for warning in warnings:
        print('WARN  ' + warning)
    for error in errors:
        print('FAIL  ' + error)

    print('---')
    print('{} checks, {} error(s), {} warning(s)'.format(checks_total[0], len(errors), len(warnings)))
    if errors:
        print('VERIFY FAILED')
        return 1
    print('VERIFY OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
