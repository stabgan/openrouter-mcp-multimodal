# mcp-server-openrouter-multimodal

Python **uvx / pip** launcher for the Node.js MCP server [`@stabgan/openrouter-mcp-multimodal`](https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal).

This package does not reimplement the server — it execs `npx -y @stabgan/openrouter-mcp-multimodal` so Python-first workflows can use the same `uvx` pattern as native Python MCP servers. **Node.js 20+** (with `npx` on `PATH`) is required.

## Run

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
uvx mcp-server-openrouter-multimodal
```

Pin the npm release:

```bash
export OPENROUTER_MCP_NPM_VERSION=4.5.2
uvx mcp-server-openrouter-multimodal
```

## MCP client config

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "uvx",
      "args": ["mcp-server-openrouter-multimodal"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

From Git (before PyPI publish):

```json
{
  "command": "uvx",
  "args": [
    "--from",
    "git+https://github.com/stabgan/openrouter-mcp-multimodal#subdirectory=python",
    "mcp-server-openrouter-multimodal"
  ]
}
```
