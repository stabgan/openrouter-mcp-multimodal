# mcp-server-openrouter-multimodal

<!-- mcp-name: io.github.stabgan/openrouter-multimodal -->

Python **uvx / pip** launcher for the Node.js MCP server [`@stabgan/openrouter-mcp-multimodal`](https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal).

This package does not reimplement the server — it execs `npx -y @stabgan/openrouter-mcp-multimodal` so Python-first workflows can use the same `uvx` pattern as native Python MCP servers. **Node.js 20+** (with `npx` on `PATH`) is required.

## Run

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
uvx mcp-server-openrouter-multimodal
```

Pin the npm release:

```bash
export OPENROUTER_MCP_NPM_VERSION=4.5.3
uvx mcp-server-openrouter-multimodal
```

Optional env vars:

- `OPENROUTER_MCP_NPM_VERSION` — pin the underlying npm package version
- `OPENROUTER_MCP_NPM_SPEC` — path to a local `.tgz` from `npm pack` (dev/testing)

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

**pipx equivalent:** `pipx run mcp-server-openrouter-multimodal`
