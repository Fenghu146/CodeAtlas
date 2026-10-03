# CodeAtlas for VS Code

Code awareness for AI coding agents — symbols, call graphs, impact analysis and semantic search for TypeScript, Python, C/C++, Java and Rust, exposed to Claude Code, Codex CLI and other MCP-capable agents.

## Requirements

- A CodeAtlas index for your project (`.codeatlas/db.sqlite`), built with the CodeAtlas CLI or MCP server
- VS Code 1.96 or newer

## Features

- **CodeLens** on symbols with call/impact quick actions
- **Code action** ("CodeAtlas: Explain impact") for the symbol under cursor
- **Hover** showing symbol details from the local index
- Commands to open the CodeAtlas dashboard and refresh the local index

## Related

- [CodeAtlas on GitHub](https://github.com/Fenghu146/CodeAtlas) — CLI, MCP server, web dashboard
- MIT licensed