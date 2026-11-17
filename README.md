# dassian-adt

MCP server for SAP ABAP development via the ADT API. Connect AI assistants to your SAP system — read, write, test, and deploy ABAP code without SAP GUI.

The AI can create objects, write source, activate, manage transports, run code, query tables, and check quality. Full development lifecycle, not just read-only or code generation.

## Origins

Based on [mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) by **[Mario Andreschak](https://github.com/mario-andreschak)** and the [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) library by **[Marcello Urbani](https://github.com/marcellourbani)**.

Dassian's fork adds input validation, error intelligence, MCP elicitation, session recovery, and a test suite. See [CHANGES.md](CHANGES.md) for the full list.

## This fork: patches for SAP_BASIS 7.40

This fork ([marikpro-sudo/dassian-adt](https://github.com/marikpro-sudo/dassian-adt), branch `local-patches`) keeps the server usable on SAP ERP with SAP_BASIS 7.40. Several ADT endpoints that upstream relies on do not exist on that release, so the tools below failed or returned nothing. `main` tracks upstream unchanged; the patches live in `local-patches`.

| Tool | What the patch does |
|------|---------------------|
| `abap_set_source`, `abap_set_class_include` | New `sourceFile` parameter: the server reads the source from a local file on its own machine, so a large source is not sent inline in the tool call. `sourceFile` wins when both `source` and `sourceFile` are given. |
| `abap_atc_run` | Works on releases without the ATC variant-lookup endpoint: the run is posted directly and the reply carries a summary and the findings. For a function module the whole function group is checked. |
| `abap_where_used` | Where-used on 7.40 for classes, interfaces, programs, function modules, methods and DDIC objects, with optional code snippets. |
| `abap_get_dump` | Reads the ST22 dump feed on 7.40: time, user, error, program and the place of the failure. |
| `abap_inactive_objects` | Reads the flat list that 7.40 returns instead of the newer structure. |
| `abap_get_source`, `abap_set_source` with `FUGR/I` | The include URL is built directly when `fugr` is given, because the type search for `FUGR/I` is empty on 7.40. |
| `abap_activate` with `FUGR`, `FUGR/FF`, `FUGR/I` | On 7.40 an activation reference activates only the object it points to, so sending the group alone answered "activated" and left function modules and includes inactive. The request now lists the group, the requested object and everything else inactive in the group, and the inactive-objects list is read again afterwards: `activated: false` with `stillInactive` if something stayed inactive. `fugr` is required for `FUGR/FF` and `FUGR/I`. |
| `abap_delete` | Releases the lock after the delete. On 7.40 the delete left an enqueue on the program name that survived logout and blocked re-creating or deleting an object with the same name. |

Replies of `abap_atc_run`, `abap_where_used` and `abap_inactive_objects` that took a 7.40 path are marked `mode: "legacy"`. Each patch has unit tests under `src/__tests__/unit/` (`atcLegacy`, `whereUsedLegacy`, `dumpFeed`, `inactiveLegacy`, `fugrActivation`).

Observed on our 7.40 system and **not** fixed here:

- Writing source needs stateful ADT sessions, which releases below 7.51 do not provide. We solved it on the SAP side with a small enhancement; it is not part of this repository.
- `abap_run` does not work: `IF_OO_ADT_CLASSRUN` does not exist on 7.40. We run code through an ABAP Unit test class instead.
- `abap_query`, `abap_table`, `abap_get_function_group`, `transport_create`, `transport_list`, `transport_info`, `transport_contents` and DDIC object creation return errors or a false success.

Install from this branch:

```bash
git clone -b local-patches https://github.com/marikpro-sudo/dassian-adt.git
cd dassian-adt
npm ci
npm run build
```

## What It Does

25 tools covering the full ABAP development lifecycle:

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Source** | `abap_get_source`, `abap_set_source`, `abap_get_function_group` | Read/write ABAP source for any object type. Function group tool fetches all includes and FMs in one call. |
| **Objects** | `abap_create`, `abap_delete`, `abap_activate`, `abap_search`, `abap_object_info` | Full object lifecycle. Create in $TMP or real packages. Automatic type mapping (CLAS -> CLAS/OC). |
| **Transports** | `transport_create`, `transport_assign`, `transport_release`, `transport_list`, `transport_info`, `transport_contents` | Create, populate, and release transports. Smart metadata handling for FUGR/VIEW/TABL. |
| **Quality** | `abap_syntax_check`, `abap_atc_run` | Syntax check and ATC with variant support. Workaround for CI-mode systems. |
| **Data** | `abap_table`, `abap_query` | Read tables/CDS views with WHERE/LIKE/BETWEEN. Execute freestyle SQL. |
| **Run** | `abap_run` | Create temp class, run ABAP code, capture output, clean up. Auto-detects ~run vs ~main across SAP releases. |
| **System** | `login`, `healthcheck`, `abap_get_dump`, `raw_http` | Session management, connectivity test, ST22 dumps, raw ADT access. |
| **Git** | `git_repos`, `git_pull` | gCTS repository listing and pull. |

## Quick Start

### Prerequisites

- Node.js 18+
- Access to an SAP system with ADT enabled (port 44300)
- SAP user with development authorization

### Install

```bash
git clone https://github.com/DassianInc/dassian-adt.git
cd dassian-adt
npm install
npm run build
```

### Configure

```bash
cp .env.example .env
# Edit .env with your SAP connection details:
#   SAP_URL=https://your-sap-server:44300
#   SAP_USER=YOUR_USER
#   SAP_PASSWORD=YOUR_PASSWORD
#   SAP_CLIENT=100
#   SAP_LANGUAGE=EN
```

For self-signed certificates, add to your `.env`:
```
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### Connect to Claude Code

Add to your Claude Code MCP settings (`~/.config/claude-code/config.json` or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "abap": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": {
        "SAP_URL": "https://your-sap-server:44300",
        "SAP_USER": "YOUR_USER",
        "SAP_PASSWORD": "YOUR_PASSWORD",
        "SAP_CLIENT": "100",
        "SAP_LANGUAGE": "EN"
      }
    }
  }
}
```

Multiple systems? Add one entry per system:

```json
{
  "mcpServers": {
    "abap-dev": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": { "SAP_URL": "https://dev-system:44300", "SAP_USER": "...", "SAP_PASSWORD": "..." }
    },
    "abap-qa": {
      "command": "node",
      "args": ["/path/to/dassian-adt/dist/index.js"],
      "env": { "SAP_URL": "https://qa-system:44300", "SAP_USER": "...", "SAP_PASSWORD": "..." }
    }
  }
}
```

### HTTP Mode (Team Deployment)

For team-wide access, run the server as a centralized HTTP service:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 \
  SAP_URL=https://your-sap-server:44300 \
  SAP_USER=SERVICE_USER \
  SAP_PASSWORD=... \
  node dist/index.js
```

Each client gets its own MCP session (and SAP session). Health check at `http://your-server:3000/health`.

Connect from Claude Code using the remote URL:

```json
{
  "mcpServers": {
    "abap": {
      "type": "url",
      "url": "http://your-server:3000/mcp"
    }
  }
}
```

Or register as a team integration on claude.ai for the whole org.

| Env Var | Default | Description |
|---------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` (local) or `http` (remote) |
| `MCP_HTTP_PORT` | `3000` | HTTP server port |
| `MCP_HTTP_PATH` | `/mcp` | MCP endpoint path |

### Test

```bash
npm test              # 165 unit tests, <3 seconds, no SAP needed
npm run test:live     # Integration tests against live SAP (needs env vars)
npm run test:e2e      # Write-path lifecycle test (create -> write -> activate -> delete)
```

## Key Features

### Zero-Crash Input Validation

Centralized validation middleware checks every tool's required parameters before any handler logic runs. Missing `name`? Missing `type`? The error names exactly what's missing. No stack traces, no `Cannot read properties of undefined`.

### MCP Elicitation

When the AI forgets a required parameter, instead of failing, the server asks the user directly:

- **Missing package** on `abap_create` -> "Which package?" form with $TMP default
- **Missing transport** on `abap_set_source` -> "Which transport?" prompt, then retries
- **Transport release** -> "Release D25K900161? This is IRREVERSIBLE" confirmation
- **Leftover class** on `abap_run` -> "Delete ZCL_TMP_ADT_RUN and retry?" prompt
- **Inactive dependents** on `abap_activate` -> "Activate them too?" with list

Falls back gracefully on clients that don't support elicitation.

### Self-Correcting Error Messages

Every SAP error is classified and annotated with actionable hints:

- Locked object -> "Check SM12 for active locks"
- Upgrade mode -> "Run SPAU_ENH to clear the upgrade flag"
- Opaque `I::000` code -> "The URL path is wrong -- check the object type"
- Transport number passed as object name -> "Use transport_contents instead"
- Pipe characters in string templates -> "Escape with \\| or use CONCATENATE"

The AI reads these hints and self-corrects on the next call.

### Automatic Session Recovery

Every ADT call is wrapped in `withSession()`. If the SAP session expires mid-operation, the server re-logs in automatically and retries. Users never see a session timeout.

### SAP Release Detection

`abap_run` auto-detects whether the system uses `IF_OO_ADT_CLASSRUN~run` (<=2023) or `~main` (2024+) by reading the interface source after login. Works on any S/4HANA release without configuration.

## Architecture

```
Client (Claude Code, VS Code, etc.)
    |
    | MCP protocol (stdio)
    |
AbapAdtServer (index.ts)
    |
    +-- BaseHandler (session mgmt, validation, elicitation)
    |       |
    |       +-- SourceHandlers    (get/set source, function groups)
    |       +-- ObjectHandlers    (create, delete, activate, search)
    |       +-- TransportHandlers (create, assign, release, list)
    |       +-- QualityHandlers   (syntax check, ATC)
    |       +-- DataHandlers      (table read, SQL query)
    |       +-- RunHandlers       (temp class execution)
    |       +-- SystemHandlers    (login, healthcheck, dumps)
    |       +-- GitHandlers       (gCTS repos, pull)
    |
    +-- lib/urlBuilder.ts  (ADT URL construction for 30+ object types)
    +-- lib/errors.ts      (SAP error classification + hints)
    +-- lib/logger.ts      (JSON structured logging)
```

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch
3. Run `npm test` and ensure all tests pass
4. Open a pull request

## Credits

- **[Mario Andreschak](https://github.com/mario-andreschak)** -- original [mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) server scaffold
- **[Marcello Urbani](https://github.com/marcellourbani)** -- [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) library powering all ADT HTTP communication
- **[Dassian Inc.](https://github.com/DassianInc)** -- fork maintainer

## License

MIT -- see [LICENSE](LICENSE).
