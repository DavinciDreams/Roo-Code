# Morse Code

A self-hosted fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code) — an AI-powered coding assistant for VS Code.

> **Note:** This is an independent fork maintained separately from the upstream Roo Code project. It is not affiliated with or endorsed by Roo Code Veterinary Inc.

## Features

- Generate code from natural language descriptions and specs
- Adapt with Modes: Code, Architect, Ask, Debug, and Custom Modes
- Refactor & debug existing code
- Write & update documentation
- Answer questions about your codebase
- Automate repetitive tasks
- Utilize MCP Servers

## Build & Install

### Prerequisites

- [Node.js](https://nodejs.org/) (see `.nvmrc` for version)
- [pnpm](https://pnpm.io/)

### Build

```sh
pnpm install
pnpm build
```

### Create VSIX

```sh
cd src && pnpm vsix
```

### Install Extension

```sh
code --install-extension ../bin/morse-code-{version}.vsix
```

## Development

1. Clone the repo
2. Run `pnpm install`
3. Open in VS Code
4. Press `F5` to launch the extension development host

## Modes

- **Code Mode:** Everyday coding, edits, and file ops
- **Architect Mode:** Plan systems, specs, and migrations
- **Ask Mode:** Fast answers, explanations, and docs
- **Debug Mode:** Trace issues, add logs, isolate root causes
- **Custom Modes:** Build specialized modes for your workflow

## License

Licensed under the [Apache License 2.0](LICENSE).
