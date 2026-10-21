#!/usr/bin/env python3
"""
Save your pinned GitHub repositories to data/github.js, which the website reads.

GitHub runs this every week (see .github/workflows/update-profile-data.yml).
To run it yourself:

    pip install requests beautifulsoup4
    GITHUB_TOKEN=<a personal access token, optional> python scripts/update_github.py

The username comes from the "github" setting in index.html. If that's still
"your-username", the repository owner is used instead (inside GitHub Actions).

Pinned repositories are only available through GitHub's GraphQL API, which
needs a token. GitHub Actions provides one automatically. Without a token, the
script reads the pins from your public profile page, and if that also fails it
falls back to your most-starred repositories.
"""

import datetime
import json
import os
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "github.js"
API = "https://api.github.com"
SHOW = 6
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()

session = requests.Session()
session.headers.update({"Accept": "application/vnd.github+json", "User-Agent": "academic-website-updater"})
if TOKEN:
    session.headers["Authorization"] = f"Bearer {TOKEN}"


def warn(msg):
    print(f"::warning::{msg}" if os.environ.get("GITHUB_ACTIONS") else f"Warning: {msg}")


def find_user():
    env = os.environ.get("GITHUB_USER", "").strip()
    if env:
        return env
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r"github\s*:\s*\{[^}]*?user\s*:\s*[\"']([^\"']+)[\"']", html, re.S)
    if m and m.group(1).lower() != "your-username":
        return m.group(1)
    return os.environ.get("GITHUB_REPOSITORY_OWNER", "").strip() or None


def rest(path):
    r = session.get(API + path, timeout=30)
    r.raise_for_status()
    return r.json()


def from_rest(j):
    return {
        "owner": j["owner"]["login"],
        "name": j["name"],
        "url": j["html_url"],
        "description": j.get("description"),
        "language": j.get("language"),
        "stars": j.get("stargazers_count", 0),
        "forks": j.get("forks_count", 0),
        "pushed_at": j.get("pushed_at"),
    }


QUERY = """
query($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes {
        ... on Repository {
          name
          owner { login }
          url
          description
          primaryLanguage { name }
          stargazerCount
          forkCount
          pushedAt
        }
      }
    }
  }
}
"""


def pinned_via_graphql(user):
    if not TOKEN:
        raise RuntimeError("no token for the GraphQL API")
    r = session.post(API + "/graphql", json={"query": QUERY, "variables": {"login": user}}, timeout=30)
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"][0].get("message", "GraphQL error"))
    nodes = body["data"]["user"]["pinnedItems"]["nodes"]
    return [{
        "owner": n["owner"]["login"],
        "name": n["name"],
        "url": n["url"],
        "description": n.get("description"),
        "language": (n.get("primaryLanguage") or {}).get("name"),
        "stars": n.get("stargazerCount", 0),
        "forks": n.get("forkCount", 0),
        "pushed_at": n.get("pushedAt"),
    } for n in nodes if n]


def pinned_via_profile_page(user):
    r = requests.get(f"https://github.com/{user}", timeout=30,
                     headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    found = []
    for item in soup.select(".pinned-item-list-item"):
        for a in item.select("a[href]"):
            m = re.fullmatch(r"/([\w.-]+)/([\w.-]+)", a["href"])
            if m:
                found.append(f"{m.group(1)}/{m.group(2)}")
                break
    repos = []
    for full in found[:SHOW]:
        try:
            repos.append(from_rest(rest(f"/repos/{full}")))
        except requests.RequestException:
            pass
    return repos


def most_starred(user):
    items = rest(f"/users/{user}/repos?per_page=100&type=owner&sort=pushed")
    items = [r for r in items if not r.get("fork") and not r.get("archived")]
    items.sort(key=lambda r: (r.get("stargazers_count", 0), r.get("pushed_at") or ""), reverse=True)
    return [from_rest(r) for r in items[:SHOW]]


def main():
    user = find_user()
    if not user:
        warn("No GitHub username found. Set github: { user: \"...\" } in index.html.")
        return 0

    repos, source = [], "pinned"
    for attempt in (pinned_via_graphql, pinned_via_profile_page):
        try:
            repos = attempt(user)
            if repos:
                break
        except Exception as exc:
            print(f"{attempt.__name__} didn't work: {exc}")
    if not repos:
        source = "top"
        try:
            repos = most_starred(user)
        except Exception as exc:
            warn(f"Couldn't read repositories for {user}: {exc} Keeping the previous list.")
            return 0
    if not repos:
        warn(f"{user} has no public repositories to show. Keeping the previous list.")
        return 0

    try:
        public_repos = rest(f"/users/{user}").get("public_repos")
    except Exception:
        public_repos = None

    result = {
        "updated": datetime.date.today().isoformat(),
        "user": user,
        "source": source,
        "public_repos": public_repos,
        "repos": repos,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Written by scripts/update_github.py. You can also edit it by hand.\n"
        "window.GITHUB_DATA = " + json.dumps(result, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    label = "pinned" if source == "pinned" else "most-starred"
    print(f"Saved {len(repos)} {label} repositories for {user} to {OUT.relative_to(ROOT)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
