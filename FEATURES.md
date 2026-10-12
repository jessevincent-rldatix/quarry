# Quarry: what is in it

A running record. Features first, then what each review round changed. For how to run it, see README.md.

## Features

**Editor**
- SQL colouring per database, autocomplete for keywords, tables and columns (alias-aware: `o.` after `FROM orders o`).
- `Ctrl Enter` runs the query, or only the selected text. It works from anywhere in the editor view (a variable box, the row filter), not only with the cursor in the editor.
- `Ctrl Shift Enter` runs just the statement the cursor is in. On SQL Server a `GO` line always ends a statement, and a `BEGIN ... END` block, a `CASE` or a trigger body is kept in one piece on every database.
- `Ctrl S` saves. `Shift Alt F` formats: keywords and built-in functions go to upper case, names and aliases stay exactly as typed, and `GO` stays on its own line.
- Tab accepts a suggestion; with a selection, Tab / Shift Tab indent and outdent.
- A red marker on the line the database blamed for an error, and a "Go to line" button in the error banner.
- Stop button with a running timer while a query is in flight.
- Tabs for several queries at once. Each tab has its own connection. An amber dot marks unsaved changes, and closing such a tab asks first. A tab the app filled in (a preview, a template, a past run) only counts as unsaved once you edit it. Tabs survive a reload.
- Tab keys: `Alt N` new, `Alt W` close, `Alt 1` to `Alt 8` jump to that tab, `Alt 9` the last tab, `Alt PageDown` / `Alt PageUp` next and previous. Middle-click closes. (A web page cannot take `Ctrl W` or `Ctrl Tab` from the browser.)
- Row limit picker (100 to 50,000) so a careless `SELECT *` cannot flood the page.
- Time limit picker (no limit, or 30 seconds to 30 minutes; 10 minutes to start with). The server stops a run that passes it, and the result says "Timed out".

**Ask (`Ctrl I`)**
- A side panel for questions about the connected database: find tables, write a query, explain or fix the one in the editor.
- Uses a chat model served from your Databricks workspace. Set the workspace host, chat endpoint, embedding endpoint and token under the cog in the panel.
- SQL in an answer gets Insert / New tab / Run in new tab buttons. Nothing runs until you press Run.
- "Ask how to fix it" on a failed query sends the query and its error.
- Ask can work the workbench, typed or spoken: "open the refund audit", "show me the first rows of orders", "switch to the fleetdesk connection", "go to the map", "run it", "tidy this query", "new tab", "close this tab", "save". It opens saved queries and templates, previews a table, changes the tab's connection, switches tabs, shows the editor, Builder, Map, Templates, Profiler, Library, Schema, History, Connections or Search, and runs, tidies or saves the open tab. Each thing done is listed above the answer, and so is anything it could not do ("There is no saved query called …"). Names are matched loosely, so "the refund audit file" finds "Refund audit".
- "Run it" through Ask only runs a query that reads. Anything else is refused with a note to run it yourself. Closing a tab with unsaved changes still asks first.
- Only table and column names and types, the names of your saved queries, templates, open tabs and connections, your question, and the query you choose to include are sent. Rows from your database are never sent. (With voice switched on, speech that starts with the wake phrase also goes to Deepgram, as sound.)
- The token is kept in memory unless "Remember the token" is ticked.

- "Replace query" on SQL in an answer swaps the whole query in the open tab for it, as one edit that `Ctrl Z` undoes.

**Voice: "Hey Seven of Nine" (the microphone in the header)**
- Switch it on, say "Hey Seven of Nine" and then what you want: "Hey Seven of Nine, add a limit of ten rows to this query", "Hey Seven of Nine, open the refund audit". The request goes to Ask with the query in the open tab. You can also say the phrase, wait for "Listening…", and then speak; it waits 8 seconds.
- The phrase is three everyday words on purpose: every speech model writes them correctly ("seven of nine", "7 of 9"). "Hey Quarry", the first phrase, is still answered, but "Quarry" is a rare word that the on-device model misspells, so it misses more often.
- Ask opens as soon as the phrase is heard, usually within a second, while you are still talking, and your words appear there as Deepgram writes them down (they arrive about once a second). When you stop, the request is written down once more from the whole recording, which is the more accurate of the two, and that is what Ask gets.
- A wake is checked twice. The on-device model decides quickly, and the accurate transcript must also start with the phrase or the request is dropped and Ask closes again. Speech the on-device model is unsure about ("Seven of nine, open…" with no "hey") is sent to Deepgram to decide, and nothing shows unless it agrees.
- Hover the microphone while it waits to see the last thing the on-device model heard. That explains a missed wake.
- Needs Ask to be set up, since that is where requests go. Until it is, the button reads "Set up Ask to use voice" and opens the Ask settings.
- A spoken request to change the query is carried out: the open tab's query is replaced and Ask says so; `Ctrl Z` brings the old query back. Voice can run a query only when asked to, and only when it just reads (see Ask).
- It listens only while Quarry is the window in front. When the tab is hidden, the window is minimised or another window has focus, the microphone is closed and the button says "Paused".
- The phrase is recognised on this computer by a small speech model, so ordinary talk does not leave it. Speech that starts with the phrase, or with something close to it, is sent to Deepgram.
- Needs a Deepgram key: `DEEPGRAM_API_KEY` in a `.env` file beside `package.json`. Without one the microphone button is not shown. The key stays on the local server.
- Off until you switch it on; the choice is remembered. The first time, the speech model (about 30 MB) is downloaded from Hugging Face and kept by the browser.

**Local index of tables and columns**
- "Build index" in the Ask panel embeds every table and column name of the current connection and stores the vectors on this machine (`~/.quarry/index/`). Works for any connected database.
- Ask uses it to pick the tables relevant to a question by meaning. Without an index it falls back to matching words.
- Rebuilding reuses the vectors of names that have not changed.

**Profiler (left rail)**
- Records what a backend does while you use the app normally: every request, the queries it ran, and how long each took. The backend reports this itself through the OpenTelemetry traces it already sends, so queries are tied to the right request even when requests overlap, and it works for every database the backend talks to.
- Needs the backend to put a trace span around each query (a small change; for Interactive Insight it is on the branch `temp/quarry-query-spans`). Quarry listens where the backend already sends traces locally (gRPC, port 30317), so `dotnet run` needs no settings changed.
- Projects keep the recordings of one backend together. A project can read the backend's routes (from the running backend's Swagger document, or a swagger.json in its folder) to show which endpoints a recording never reached.
- Report per recording: endpoints ranked slowest first, with typical and 95th-percentile time, time spent in the database, and queries per request. Each row's bar shows request time and the database's share of it.
- Flags: Slow, Slow query, N+1 (the same query many times in one request), Chatty, Database-bound, Errors. Hover a flag for its exact rule; the thresholds are in `shared/profilerAnalysis.ts`.
- Noise control: requests the browser cancelled are left out of every number (React StrictMode's cancelled halves, for one). Identical requests (same method, path and query string) collapse into one line with a count, and are marked "double-fired" when sent twice at once.
- Endpoint detail: queries costliest first with times-per-request, "Open in editor" for any query, the slowest request drawn as a timeline, and the list of distinct requests.
- Compare a recording with an earlier one to see what got faster or slower.
- Copy the report as Markdown, or export it as a standalone HTML page to send to someone.

**Schema map**
- "Map" in the left rail draws every table as a box with its columns, primary keys marked, and an arrow for each foreign key, labelled with the columns it joins.
- "Guess links from column names" adds dashed arrows for likely joins where the database declares no foreign key.
- Type to highlight tables or columns, click a table to see only what it connects to, double-click to preview its rows. Drag to rearrange, scroll to zoom.

**Variables and templates**
- `{{name}}` in any query adds an input under the editor. Types: text, number, date, ident, list, raw; defaults with `=`.
- Values are validated and quoted for the connected database. "Preview final SQL" shows what will be sent, and lists what is still wrong when a value is missing or does not fit.
- A variable inside quotes the query already wrote (`'%{{q}}%'`, `[{{t}}]`) is escaped for those quotes. Comments, strings and quoted names are read by each database's own rules.
- An empty box is an error unless the variable is written `{{name=}}`, which sends an empty string. The "null" tick beside a text, number or date variable sends NULL.
- Lists: items may be quoted (`'a', "Smith, John"`), and quoted items are always sent as text, so `'1', '2'` suits a text column.
- Templates screen: built-in templates in three groups (Explore a table, Data quality, Schema and size), with SQL written per database where it differs, plus your own.
- "Save as template" from any query.

**Library**
- Saved queries in folders, with tags and pins. Drag a query onto a folder, or use its menu.
- Filter by name, SQL text or `#tag`. Click a tag to filter by it.
- Run history: every run with rows, timing and errors; searchable; click to reopen.

**Schema panel**
- Tables, views and columns with types and primary keys; search across both.
- Click a column to insert its name; "Preview" runs a first-100-rows query.

**Query builder**
- Pick a table, tick columns, add joins, filters, count-by, sort and limit.
- Joins: any number, each to a table already in the query. Tables linked by a foreign key are listed first, and the join columns come from the foreign key, in whichever direction it points. Without one, a column named after the other table is used; with nothing to go on, the columns are left for you to pick.
- Filter values follow the column's type: true/false for yes/no columns, a number for number columns, and a date as `YYYY-MM-DD`. A value that does not fit is left out of the SQL and explained under it. A day typed against a date-and-time column means the whole day. "Contains" ignores case on every database.
- Names are quoted only where that database reserves the word (the lists come from the databases themselves).
- The SQL updates live; Run it or open it in the editor. A half-built query is still there when you come back.

**Results**
- Grid that stays fast on tens of thousands of rows: sort, filter, resize columns, arrow keys, `Ctrl C`, double-click or Enter to view a long value (JSON is pretty-printed; Enter or Escape closes it).
- Select a block of cells: drag, or click then `Shift` click; `Shift Arrow` extends, `Ctrl Arrow` jumps to the edge, `Ctrl Shift Arrow` extends to it. Click or drag row numbers for whole rows; `Ctrl` click a column header for a whole column (a plain click still sorts); `Ctrl Space` / `Shift Space` take the selection's columns or rows; `Ctrl A` or the `#` corner takes everything; Escape goes back to one cell.
- `Ctrl C` copies the selection tab-separated, with a header row when it spans more than one row or whole columns. The status line counts the selected cells and sums them when they are all numbers.
- Sorting is exact for very large integers and long decimals, ignores case in text and reads numbers inside it naturally (file2 before file10), and puts NULLs last either way.
- The status line names the connection the rows came from, and says so when the tab has since been pointed at another one. A run you stopped shows "Stopped", not "Done".
- Several result sets from one batch, each on its own button. `GO` separates batches on SQL Server.
- When a batch fails part-way, the results and messages from before the failure are still shown.
- Sort, filter, column widths and the chosen result are kept per tab.
- Bar chart of any numeric column. Negative values run the other way from a zero line; rows with no value are left out and counted.
- Copy as TSV, CSV, JSON or Markdown; export CSV. In CSV a NULL is an empty field and an empty string is `""`; in Markdown a NULL is *NULL*; in JSON a column is all numbers or all strings, never a mix.

**Search and commands (`Ctrl K`)**
- Jump to saved queries (searches their SQL too), tables, columns, templates and commands; switch connection.
- Enter opens or inserts; `Ctrl Enter` opens and runs.

**Connections and safety**
- The Schema panel files tables under their schema (`arbiter`, `cartographer`) when a database has more than one. Each heading folds, which is remembered per connection, and tables under a heading are shown by their own name. A search shows matches in every schema, folded or not.
- The arrow at the end of the tab bar closes several tabs at once: all of them (`Alt Shift W`), all but the open one, or those with nothing unsaved. If any tab being closed has unsaved changes, it asks once and names them. The same is in Search & commands, and Ask can be told "close all tabs".
- The library is saved as you work. If another Quarry window saves in between, this one stops saving and says so, so neither overwrites the other. A save that collides only with this same tab's own earlier save (the last save of the page before a reload, for one) is not a conflict: it goes again without a warning.
- SQL Server, PostgreSQL, MySQL/MariaDB, Snowflake, Databricks, SQLite files, and a built-in demo database.
- Snowflake: give the account, user, and where to run (warehouse, role, database, schema). Sign in with a password or access token, with single sign-on in the browser, or with a key pair (a private key file and its passphrase). The session is kept open, so `USE`, session variables and temporary tables carry from one run to the next.
- Databricks: give the workspace host, the SQL warehouse's HTTP path and a personal access token, and optionally a catalog and schema. Queries go to the warehouse over HTTPS; a warehouse that is stopped is started by the first query, which then takes as long as the warehouse takes to start.
- On both, a script is sent one statement at a time (neither takes several at once), each with its own result, stopping at the first error, which is reported against the right line of the script. Stop cancels the statement on the warehouse. Tables of the schema the connection names are shown and written without a prefix.
- Both have their own quoting, escaping, keywords, formatting, editor colouring, builder SQL and built-in templates. Snowflake names are left bare only when stored in capitals; Databricks text is escaped with a backslash, because `''` does not mean a quote there.
- A Snowflake address (`snowflake://user:pass@account/db/schema?warehouse=…&role=…`) or a Databricks JDBC address can be pasted to fill in the fields.
- Paste a connection string and the fields fill in; the pasted text, password included, is then cleared from the box.
- A connection can have a colour (red, amber, green, blue, violet) to mark a database that needs care. It tints that connection's tabs, the Run button (which then reads "Run on <name>") and the connection button in the header.
- New connections start with the usual settings for their database (encryption on for SQL Server, off for PostgreSQL and MySQL). When a test fails over SSL or a certificate, the message names the box to change. A connection that failed its test is saved but marked "Saved, not working yet".
- Passwords stay in memory unless "Remember the password" is ticked.
- Read-only connections refuse anything that could change data (on Postgres and MySQL this is also enforced by the database). On SQL Server that includes `NEXT VALUE FOR`, which moves a sequence on even inside a rolled-back transaction.
- On writable connections, UPDATE or DELETE with no WHERE, DROP and TRUNCATE ask first. The server checks this as well as the page, so nothing reaches the database without the question having been answered.
- Every run gets a clean session: a transaction left open is rolled back (with a message saying so), and `USE` or `SET` from one run does not carry into the next.
- The local API listens on this machine only and refuses web pages from any other origin. It is not a barrier against other programs running on this machine as you: they can call it as the app does.
- Two Quarry windows cannot silently overwrite each other's library: the second one to save is told and stops saving until reloaded.

## Changes from review rounds

### Round 1 (reviewers: Opus, Fable, Sonnet, Haiku against mock SQL Server and Postgres)

Haiku found no bugs but did not complete its read-only and reload checks. The rest, by reporter:

**Correctness and safety (Opus)**
- `SELECT ... FOR JSON` crashed the local server. Fixed; unexpected driver errors can no longer take it down.
- Read-only guard could be bypassed with a quote inside a bracketed name, nested comments, or `DBCC` / `DENY` / `BACKUP` after a SELECT. Rewritten as a proper tokenizer per database; all the reported bypasses are refused.
- Session state leaked between runs (`BEGIN`, `USE`, `SET search_path`). Each run now ends with a reset.
- Output produced before an error was thrown away. Now kept.
- No way to stop a query. Stop button added; it cancels on the server.
- Date variables on SQL Server could be read as day-month or month-day depending on server language. Now sent as `YYYYMMDD`.
- Other programs or web pages on this machine could call the local API. It now requires the app's own origin, a JSON content type and a client header.
- A held password was reused after the host or user of a connection changed. It is now dropped.

**Workflow (Fable)**
- Two windows overwrote each other's saved queries. Saves now carry a revision and conflicts are reported.
- Closing a tab with unsaved changes lost them without asking.
- Builder choices were lost on leaving the screen; so was the template being filled in.
- The active tab could be scrolled out of view in the tab bar.
- Sort, filter and widths reset on switching tabs.
- One connection for the whole app. Now per tab.
- No error line, no run-statement-at-cursor, no foreign keys shown anywhere. All added (the last as the schema map).

**Grid, builder, export (Sonnet)**
- Sorting descending no longer puts NULLs first.
- Big integers and decimals that arrive as text are treated as numbers: right-aligned, sorted numerically, usable in the chart.
- Arrow keys keep the selected cell in view.
- Builder, schema panel and `Ctrl K` quote reserved words (`order`, `user`), names with spaces, and mixed-case Postgres names.
- Builder "contains" / "starts with" work on non-text columns and treat `%` and `_` literally on every database.
- Builder ignores a non-whole-number limit and an empty "is one of" list instead of writing invalid SQL.
- `ident` variables accept names with spaces; suggestions offer schema-qualified names (`catalog.books`).
- "Search a text column" works on any column type; "Find a column by name" on Postgres skips system schemas and ignores case.
- CSV/TSV: text starting with `=`, `+`, `-` or `@` is neutralised so a spreadsheet does not run it as a formula.
- JSON copy: nested JSON stays JSON, duplicate column names no longer overwrite each other.
- SQL Server `date`, `time` and `datetime2` shown as the database prints them, not as ISO instants.
- Read-only guard no longer refuses harmless queries such as `SELECT 1 AS [Create Date]`.
- The server stops reading at the row limit, and stops a query that keeps sending rows far past it.
- Postgres materialized views appear in the schema. SQL Server types show their length and precision.
- A SELECT is no longer reported as "rows affected"; SQLite no longer shows a stale count.
- Viewing a NULL cell no longer says "4 characters".

### Round 2 (the gaps left after round 1)

- `Ctrl K` searches by meaning: once a connection has an index, a "Related by meaning" group lists tables and columns the index relates to what you typed, even when no name contains the words.
- `Ctrl K` says how many more matches a group has instead of silently cutting the list. New commands: "Open schema map", "Ask a question".
- Saved passwords and the saved AI token are encrypted on disk. On Windows this uses DPAPI, tied to your Windows login. Anything saved as plain text by an earlier version is encrypted the next time the server starts.
- MySQL tested against a live MySQL 8.4 server. That found and fixed a hang on batches of several statements. MySQL now reads rows one at a time, stops a runaway query, reports column types, warns about a transaction left open, and resets the session after each run.
- MySQL read-only connections are also enforced by the database, and `/*! ... */` comments (which MySQL runs as SQL) are refused on them.
- SQLite runs on its own thread: a slow SQLite query no longer holds up other connections, and Stop works on it.
- SQL Server: a message appears when a decimal has more digits than the driver can hold exactly, naming the column and how to see the exact value.
- Your own templates can hold different SQL per database ("SQL for: Any database / SQL Server / PostgreSQL / MySQL / SQLite / Snowflake / Databricks" in the template dialog).
- "Column profile" works on Postgres `uuid` columns. "Row counts, all tables" works on SQLite (exact counts).
- History shows the error text of failed runs, and it is searchable.
- Dropping a query onto a closed folder briefly marks the folder "Moved here".
- Builder and Templates: on a window narrower than about 1280 px the right-hand panel moves underneath instead of squeezing the middle.

### Round 3 (reviewers: Fable in a browser, Opus on the server, Sonnet on generated SQL and results, Haiku on a checklist; against mock SQL Server, Postgres and MySQL)

The features above describe the result. What was wrong, by reporter:

**Safety (Opus, Sonnet, Fable)**
- SQL Server read-only could be bypassed: `SELECT NEXT VALUE FOR` moved a sequence on for good. Refused now, with `nextval` / `setval` and `RAISERROR ... WITH LOG`.
- A variable after an apostrophe in `[it's]`, `"it's"`, a `#` comment or `$$...$$` was inserted without quotes, as live SQL. Variables now read SQL through the same scanner as the read-only guard.
- A past run reopened from History landed on whichever connection was active, not the one it ran on.
- The "ask first" check for DROP, TRUNCATE and UPDATE or DELETE with no WHERE ran only in the page. The server now checks too. It also no longer misses a T-SQL `DELETE FROM t` followed by a `SELECT ... WHERE` with no semicolon, and no longer asks about upserts (`ON CONFLICT ... DO UPDATE`, `ON DUPLICATE KEY UPDATE`).
- The read-only guard refused harmless queries: `SHOW CREATE TABLE`, `OPTION (MERGE JOIN)`, `SHOW transaction_read_only`, Postgres `E'it\'s'` strings, a column named `update`, MySQL's `insert()` function. All allowed now.

**Broken (Fable, Sonnet)**
- "New folder" stayed open showing the new folder's id as an error.
- Enter on a cell opened the viewer and closed it again in the same keystroke.
- New Postgres and MySQL connections failed their first test because encryption was pre-ticked for every database.
- "Run statement at cursor" ignored `GO` and `BEGIN ... END`.
- A stopped query was reported as "Done". Every tab the app opened counted as unsaved. "Preview final SQL" hid what was wrong with the variables.
- Query builder: joining a child table onto its parent wrote no JOIN (and on the demo database joined `id` to `id`); "equals true" on MySQL returned the rows where the flag was off; dates depended on the SQL Server login's language; most of MySQL's reserved words were left unquoted; a sort survived a change of grouping and produced invalid SQL.
- List variables double-quoted items pasted with quotes; a negative number variable broke `LIMIT`.

**Display and export (Sonnet, Opus)**
- SQL Server: `real` 3.14 showed as 3.140000104904175; large `money` and wide-scale decimals were rounded with no warning, or shown with digits the database never held. They are now shown to 15 significant digits with a message naming the column.
- SQL Server: a lone `BEGIN TRANSACTION` showed error 266 beside the rollback notice. A transaction can now span `GO` batches within one run.
- MySQL: `bit` showed as `0x01`; binary columns were labelled as text. PostgreSQL: `bit`, `inet`, ranges and enums had no type label.
- MySQL tables were always shown as `greenhouse.plants`; tables of the connection's own database are now shown bare.
- Sorting, JSON / CSV / Markdown export and the chart: see Results above.
- Built-in templates: "Column profile" failed on SQL Server `bit` columns; "Table sizes" on MySQL listed system tables; "Running queries" on MySQL listed itself; "Row counts" on Postgres included materialized views.

**Under the hood**
- One SQL scanner (`shared/sqlScan.ts`) where there were three, and one table of dialect facts (`shared/dialect.ts`).
- The drivers share one row collector and report a stop as a flag, not a message. Stop on Postgres and MySQL uses its own connection, so it works when every pooled connection is busy.
- Result columns carry a kind (integer, decimal, float, bool, date, json, binary, text) on every database; on SQLite it is worked out from the values.
- Tests went from 27 to 505, including the first server tests. `server/mocks.integration.test.ts` runs every built-in template, every builder operator on every column, and every foreign-key join against the mock databases; it is skipped unless `QUARRY_MOCK_PW_FILE` is set.

Not a bug after all: the Run button's tooltip was reported as naming the wrong key. On screen it already read `Ctrl Shift Enter`.

Reported and left alone: spatial values shown as the driver's raw structure, `GO 3` running its batch once, autocomplete for subquery and CTE aliases, a composite foreign key drawn as separate arrows, the layout at 480 px wide.

## Known gaps

- Profiler: built and tested against a mock ASP.NET backend using the real .NET trace exporter. It has not yet recorded the real Interactive Insight backend.
- Profiler: no replay of recorded requests yet, and no query-plan findings (scans, missing indexes). Timings come from the backend's own measurements only.
- Profiler: parameter values of queries are not recorded, only the SQL text, so "Open in editor" gives a query with its placeholders.
- Profiler: recordings are stored as plain JSON in `~/.quarry/projects`, including request paths and query strings.

- Voice: with Jesse's voice, "Hey Quarry" woke about one time in four, which is why the phrase became "Hey Seven of Nine" (2026-10-07; the button writes it "Hey 7 of 9"). The new phrase woke every time with recorded speech from two computer voices, and sentences like "seven of nine rows are null" did not wake it. It has not yet been tried with a real voice. If it misses, the microphone's tooltip shows what the on-device model heard.
- Voice: "Hey Quarry" is matched loosely ("Quarty", "quirti", "Courtie", "query", "Corey"), so "Hey, the query…" said to a colleague costs one short Deepgram request and is then dropped. The phrase cannot be changed in the app; it is set in `src/lib/wake.ts`.
- Voice: once in about twenty test requests, writing down the finished request took 8 seconds instead of half a second. The cause was not found; it did not recur when timed on its own.
- Ask's workbench actions and spoken edits depend on the model starting its answer with a marked line (`DO …`, `EDIT`). This was tested with a stand-in model that always does; how reliably the real Databricks model does it has not been measured.
- Voice: the live words lag the voice by about a second (Deepgram's pace), so a short request can finish before any appear.
- Voice: only English is recognised.
- Ask, the index and search by meaning have been tested against a stand-in for Databricks, not a real workspace.
- Run history and the library are stored as plain JSON in `~/.quarry`. Only passwords and the AI token are encrypted.
- Off Windows, saved secrets are encrypted with a key kept in the same folder (`secret.key`). That protects the settings file on its own, not the whole folder.
- SQL Server decimals and money beyond 15 significant digits are still rounded (the driver's limit); Quarry says so when it happens. `datetimeoffset` values are shown converted to UTC, not in their original offset.
- Snowflake and Databricks have never been run against a real account or workspace. Everything was checked against stand-ins written from their documentation: a stand-in Databricks API, and a stand-in for Snowflake's driver library (the real library loads and reports sign-in errors). The first real connection is the test; sign-in, column types, cancelling and the schema list are the parts most likely to need a fix.
- Snowflake and Databricks: read-only is the guard alone. Neither has a read-only session, so nothing in the database backs it up as on Postgres and MySQL. Use a role or token that can only read where it matters.
- Snowflake: an open transaction is not rolled back at the end of a run, and session changes are not undone, as they are on the other databases. Single sign-on has to be done again when the server restarts, unless Snowflake's own token cache is allowed on the account.
- Snowflake: an `ident` variable is always quoted, so a name must be typed in the case it is stored in, which is usually capitals.
- Databricks: each statement runs in its own session, so `USE`, `SET` and temporary views do not carry to the next statement or run. Set the catalog and schema on the connection instead. A result is cut short at about 16 MB as well as at the row limit. Table lists need Unity Catalog; a `hive_metastore`-only workspace shows none. "Row counts", "Table sizes" and "Running queries" have no Databricks version.
- Databricks: only a personal access token is supported, not sign-in through the browser.
- A Databricks schema that happens to be called `main`, `public` or `dbo` is written without its name, as those are on the older databases, which is wrong unless it is also the connection's schema.
- Two Quarry windows open at once still cannot both save: the second to save gets the yellow warning and has to reload. A tab made with the browser's "Duplicate tab" counts as the same tab, so the two can overwrite each other.
- Results do not survive a reload: tabs and their text come back, grids do not.
- The grid does not scroll by itself while you drag a selection past its edge; use the wheel while dragging, or `Shift` click.
- An `ident` variable is always quoted, so on Postgres a name typed with capitals must match the stored name exactly.
- A text variable inside a `LIKE` pattern does not escape `%` and `_` in the value.
- Run history keeps the SQL as it was sent, values filled in, not the template and its values.
- "Run statement at cursor" on SQL Server returns the whole batch when statements are not separated by semicolons.
- Stop on PostgreSQL sends its cancel request unencrypted before any TLS setup, as `psql` does. This has not been tried against a server that requires TLS.
- The new connection, toolbar and grid behaviour was checked in Chromium only.
- Stopping a SQLite query reloads its in-memory database, so changes made to it in this session are lost. The file on disk is never written either way.
- MySQL reports a line number only for syntax errors.
- "Copy to my templates" on a built-in template copies only the SQL for the current database.

## Code layout rules

- One component or hook per file. `src/ui/input.tsx` and `src/ui/dialog.tsx` are the exception: each holds one family of small styled primitives, as shadcn does.
- One database driver per file under `server/drivers/`. Adding a database means: its driver, its entries in `shared/dialect.ts` and `shared/sqlScan.ts`, and its fields in the connection dialog. The type-checker lists every other table that needs an entry once the name is added to `Dialect`.
- SQL is read only through `scan` in `shared/sqlScan.ts`. Anything that differs by database (quoting, reserved words, row limits, date and boolean literals) goes in `shared/dialect.ts`, not in the feature that needs it.
- A tab holding SQL the app wrote is opened with `openSql`, which takes the connection it belongs to. `newTab` is for a blank tab.
