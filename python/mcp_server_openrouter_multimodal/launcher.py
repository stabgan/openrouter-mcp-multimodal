"""Exec the Node.js MCP server via npx."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

NPM_PACKAGE = "@stabgan/openrouter-mcp-multimodal"
NPM_BIN = "openrouter-multimodal"


def _npm_spec() -> str:
    override = os.environ.get("OPENROUTER_MCP_NPM_SPEC", "").strip()
    if override:
        return override
    version = os.environ.get("OPENROUTER_MCP_NPM_VERSION", "").strip()
    if version:
        return f"{NPM_PACKAGE}@{version}"
    return NPM_PACKAGE


def _npx_command(npm_spec: str) -> list[str]:
    """Build npx argv for registry packages or local npm pack tarballs."""
    if npm_spec.endswith(".tgz") or npm_spec.startswith("file:"):
        return ["-y", "--package", npm_spec, NPM_BIN]
    return ["-y", npm_spec]


def _augmented_path_env() -> dict[str, str]:
    env = dict(os.environ)
    extra = (
        "/usr/local/bin",
        "/opt/homebrew/bin",
        os.path.expanduser("~/.local/bin"),
    )
    current = env.get("PATH", "")
    prefix = os.pathsep.join(p for p in extra if p not in current.split(os.pathsep))
    if prefix:
        env["PATH"] = f"{prefix}{os.pathsep}{current}" if current else prefix
    return env


def main() -> None:
    env = _augmented_path_env()
    npx = shutil.which("npx", path=env.get("PATH"))
    if not npx:
        print(
            "mcp-server-openrouter-multimodal requires Node.js (npx not found on PATH).\n"
            "Install Node 20+ from https://nodejs.org or use npx/Docker install instead.\n"
            "See https://github.com/stabgan/openrouter-mcp-multimodal#install",
            file=sys.stderr,
        )
        raise SystemExit(1)

    npm_spec = _npm_spec()
    # npx resolves package bins incorrectly when cwd is inside the uv/venv install tree.
    rc = subprocess.call(
        [npx, *_npx_command(npm_spec)],
        env=env,
        cwd=tempfile.gettempdir(),
    )
    raise SystemExit(rc)
