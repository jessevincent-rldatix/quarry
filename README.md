# Quarry

A local SQL workbench: write, organise, search and template queries, and browse results. It looks and
behaves like RLD Arc (teal chrome, mint panels, the same button and tab vocabulary).

Design: https://claude.ai/artifact/QtiDWyaApmruncP3MmLph3

## Run it

```
npm install
npm run dev
```

Then open http://127.0.0.1:4781. A demo SQLite database (`shop-demo`) is built in, so it works straight away.

`npm run dev` starts two things: the UI (Vite, port 4781) and a small local API (port 4780) that holds the
database connections. Both listen on 127.0.0.1 only. Set `QUARRY_PORT` to move the API.

To run without the dev tooling: `npm run build`, then `npm start` and open http://127.0.0.1:4780.

## Connecting to a database

Click **Connect** (bottom of the left rail). SQL Server, PostgreSQL, MySQL/MariaDB, Snowflake, Databricks and SQLite
files are supported. You can paste a connection string (`Server=127.0.0.1,1433;Database=…;User Id=…;Password=…`,
`postgres://user:pass@host/db`, `snowflake://user@account/db/schema?warehouse=…` or a Databricks JDBC address) and the
fields fill in.

- **Snowflake**: the account is the part of the web address before `.snowflakecomputing.com`. Choose how to sign in:
  password or access token, single sign-on (your browser opens), or a key pair (path to the private key file). Fill in
  the warehouse, and the database whose tables you want listed.
- **Databricks**: the workspace host, the SQL warehouse's HTTP path (on the warehouse, under "Connection details") and
  a personal access token. The catalog and schema are optional.
- Neither has been tried against a real account yet; see the known gaps in `FEATURES.md`.

- **Passwords** are kept in the API's memory and asked for again after a restart, unless you tick
  "Remember the password", which stores it encrypted in `~/.quarry/connections.json` (Windows DPAPI,
  tied to your Windows login; elsewhere a key file kept beside it).
- **Read-only** (on by default for new connections) refuses anything that is not a SELECT. It is a guard
  against slips, not a security boundary: use a login with read-only rights when data must not change.
- On a writable connection, an UPDATE or DELETE with no WHERE, a DROP or a TRUNCATE asks for confirmation first.
- Give a connection a **colour** to mark a database that needs care; it tints that connection's tabs and Run button.
- New connections start with encryption on for SQL Server and off for PostgreSQL and MySQL. A local SQL Server with a
  self-signed certificate also needs "Trust the server certificate".

## What is in it

| | |
|---|---|
| **Library** | Saved queries in folders, with tags and pins. Filter by name, SQL text or `#tag`. Drag a query onto a folder to move it. |
| **Schema** | Tables, views and columns with search. Click a column to insert its name; "Preview" runs a first-100-rows query. |
| **History** | Every run, searchable, with row count and timing. Click one to reopen it. |
| **Templates** | Reusable queries with fill-in variables, built-in ones per database plus your own. |
| **Map** | Tables as boxes with arrows for foreign keys. Click a table to see what it connects to. |
| **Ask** | `Ctrl I`: questions to a model served from Databricks, with a local index of table and column names. |
| **Builder** | Build a SELECT by picking a table, columns, a join, filters, grouping and sorting. |
| **Search & commands** | `Ctrl K`: jump to any saved query, table, column, template or command. |
| **Results** | Virtualised grid (sort, filter, resize, arrow keys, double-click a cell to view it), a bar chart, copy as TSV/CSV/JSON/Markdown, export CSV. |

### Variables

Write `{{name}}` in any query and an input appears under the editor.

| Syntax | Meaning |
|---|---|
| `{{name}}` | text, quoted and escaped for you |
| `{{n:number}}` | a number, validated |
| `{{d:date}}` | a date like `2026-01-31`, validated and quoted |
| `{{t:ident}}` | a table or column name, quoted for the database |
| `{{v:list}}` | comma-separated values for `IN (...)` |
| `{{x:raw}}` | inserted exactly as typed |
| `{{n:number=100}}` | any of the above with a default |
| `{{note=}}` | an empty value is allowed, and sends an empty string |

Tick "null" beside a text, number or date variable to send NULL.

### Keys

`Ctrl Enter` run (the selection, if there is one) · `Ctrl Shift Enter` run the statement under the cursor ·
`Ctrl S` save · `Shift Alt F` format · `Ctrl K` search · `Ctrl I` Ask

Tabs: `Alt N` new · `Alt W` close · `Alt Shift W` close all · `Alt 1`–`Alt 8` jump to a tab · `Alt 9` last tab · `Alt PageDown` / `Alt PageUp`
next and previous

Results: `Shift` click, drag or `Shift Arrow` to select a block · `Ctrl A` everything · `Ctrl C` copy · `Enter` view a cell

## Ask and the local index

Open Ask with `Ctrl I` and choose **Set up**. It needs a Databricks workspace host, the name of a chat
serving endpoint, optionally the name of an embedding endpoint, and a personal access token. "Save and
test" sends one short message to the chat endpoint.

With an embedding endpoint set, **Build index** embeds the table and column names of the current
connection and keeps the vectors in `~/.quarry/index/`. Ask then picks tables by meaning, and `Ctrl K`
gains a "Related by meaning" group. Without an index both match words instead.

Ask can also work the app: "open the refund audit", "show me the first rows of orders", "go to the map", "run it".
What it did is listed above its answer. "Run it" only runs a query that reads.

Only names (tables, columns, saved queries, templates, open tabs, connections), types, your question and the query you
choose to include leave the machine. Rows never do.

## Voice: "Hey Seven of Nine"

Talk to Quarry instead of typing into Ask.

1. Put a Deepgram key in a file named `.env` beside `package.json`: `DEEPGRAM_API_KEY=...`. Restart Quarry.
2. Click the microphone in the header and allow the browser to use the microphone.
3. Say "Hey Seven of Nine" and then what you want, for example "Hey Seven of Nine, add a limit of ten rows to this
   query" or "Hey Seven of Nine, open the refund audit". Ask opens when the phrase is heard and shows your words as you speak.

The request goes to Ask together with the query in the open tab, so Ask must be set up first; the microphone says so
until it is. A spoken request to change the query replaces it in the editor (`Ctrl Z` undoes it). A query is run by
voice only when you ask, and only when it just reads.

Quarry listens only while it is the window in front; otherwise the microphone is closed. The wake phrase is recognised
on this computer, by a small model downloaded from Hugging Face the first time (about 30 MB). Only speech that starts
with the phrase, or something close to it, is sent to Deepgram. "Hey Quarry" works too, less reliably. If it does not wake, hover the microphone to see what
it heard. Set `DEEPGRAM_MODEL` in `.env` to use a model other than `nova-3`.

## Profiler

Shows which endpoints of a backend are slow and why, from real use.

1. The backend must put a trace span around each query, tagged `db.system`, `db.statement` and `db.rows`. For Interactive
   Insight that is the branch `temp/quarry-query-spans`. The same branch tags a request the client cancelled
   (`http.client_aborted`) and records the query string as sent (`url.query.raw`).
2. Start Quarry, then the backend with `dotnet run`. Quarry listens for traces on gRPC port 30317, where the backend's
   local settings already send them. Set `QUARRY_OTLP_PORT` to move it. Traces over HTTP are accepted too, at
   `http://127.0.0.1:4780/v1/traces` (`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`).
3. Open **Profiler**, create a project, press **Record**, use the app, press **Stop**.

If port 30317 is taken by a local trace collector, the Profiler says so; stop the collector or move one of them.

## Where things are kept

`~/.quarry/store.json` holds the library, templates, history and open tabs. `~/.quarry/connections.json`
holds connection details. `~/.quarry/index/` holds the vector index. `~/.quarry/projects/` holds profiler projects and recordings. Set `QUARRY_DATA_DIR` to use another folder.

## Layout

- `server/` local API: `index.ts` (routes), `drivers/` (one file per database), `ai.ts` (Databricks calls and
  the index), `voice.ts` (Deepgram), `secrets.ts` (encryption of saved passwords and tokens), `profiler/` (trace receiver, recorder, project files),
  `demo.ts` (demo data)
- `shared/` types, the SQL scanner (`sqlScan.ts`), what differs between databases (`dialect.ts`), the read-only check
  and the profiler's analysis rules, used by both sides
- `src/` the React app: `store/` (state and saving), `components/` (one component per file, grouped by
  area), `hooks/`, `ui/` (shadcn-style primitives), `lib/` (pure functions, unit tested)

`npm test` runs the unit tests. `FEATURES.md` lists every feature and what each review round changed.

One test file, `server/mocks.integration.test.ts`, runs the SQL Quarry writes against three throwaway mock databases
in Docker and is skipped by default. To run it, point `QUARRY_MOCK_PW_FILE` at the file holding the mocks' password:
`QUARRY_MOCK_PW_FILE=<path> npx vitest run server/mocks.integration.test.ts`.
