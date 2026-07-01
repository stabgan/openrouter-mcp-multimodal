"""Exec the Node.js MCP server via npx."""

from __future__ import annotations

import os
import shutil
import sys

NPM_PACKAGE = "@stabgan/openrouter-mcp-multimodal"


def _npm_spec() -> str:
    version = os.environ.get("OPENROUTER_MCP_NPM_VERSION", "").strip()
    if version:
        return f"{NPM_PACKAGE}@{version}"
    return NPM_PACKAGE


def main() -> None:
    npx = shutil.which("npx")
    if not npx:
        print(
            "mcp-server-openrouter-multimodal requires Node.js (npx not found on PATH).\n"
            "Install Node 20+ from https://nodejs.org or use npx/Docker install instead.\n"
            "See https://github.com/stabgan/openrouter-mcp-multimodal#install",
            file=sys.stderr,
        )
        raise SystemExit(1)

    npm_spec = _npm_spec()
    os.execvp(npx, [npx, "-y", npm_spec])
