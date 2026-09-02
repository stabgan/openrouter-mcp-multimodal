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


def _node_major_version(path_env: str) -> int | None:
    node = shutil.which("node", path=path_env)
    if not node:
        return None
    try:
        out = subprocess.check_output([node, "-p", "process.versions.node"], text=True).strip()
        return int(out.split(".", 1)[0])
    except (subprocess.CalledProcessError, ValueError, OSError):
        return None


def main() -> None:
    env = _augmented_path_env()
    path = env.get("PATH", "")
    npx = shutil.which("npx", path=path)
    if not npx:
        print(
            "mcp-server-openrouter-multimodal requires Node.js (npx not found on PATH).\n"
            "Install Node 22+ from https://nodejs.org or use npx/Docker install instead.\n"
            "See https://github.com/stabgan/openrouter-mcp-multimodal#install",
            file=sys.stderr,
        )
        raise SystemExit(1)

    node_major = _node_major_version(path)
    if node_major is None or node_major < 22:
        print(
            "mcp-server-openrouter-multimodal requires Node.js 22 or newer.\n"
            f"Found: node major={node_major if node_major is not None else 'missing'}\n"
            "See https://github.com/stabgan/openrouter-mcp-multimodal#install",
            file=sys.stderr,
        )
        raise SystemExit(1)

    npm_spec = _npm_spec()
    # Run npx from the system temp dir so package install/cache side effects stay out of the user's cwd.
    rc = subprocess.call(
        [npx, *_npx_command(npm_spec)],
        env=env,
        cwd=tempfile.gettempdir(),
    )
    raise SystemExit(rc)
