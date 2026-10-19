# Local container integration testing

This setup builds the current frontend and Go backend into one new-api image and reuses the MySQL and Redis services from `docker-compose.local.yml`. The additional service is defined in `docker-compose.integration.yml`.

## Prerequisites

- Docker Desktop is running.
- The local `docker-compose.local.yml` exists. It is ignored by Git in this workspace.
- Root `.env` contains `SQL_DSN` pointing to `mysql:3306` and `REDIS_CONN_STRING` pointing to `redis:6379`. Their credentials must match the existing local services. Hostnames such as `localhost` refer to the application container and cannot reach these dependency containers.
- For login sessions to survive application replacements, set a fixed, random `SESSION_SECRET` in `.env` before first use. Generate a value with `openssl rand -hex 32`.

## Start the complete local stack

From the repository root:

```sh
make local-up
```

This starts existing dependency containers with `--no-recreate`, waits for MySQL health, builds the frontend/backend image, then replaces only the application with `--no-deps`. Existing MySQL/Redis container definitions, credentials and volumes remain unchanged. Missing dependencies are created on first use.

Open `http://localhost:3000`, complete initialization if needed, then visit `http://localhost:3000/pelican-test`. The Go server serves the compiled frontend, so a separate frontend development server is unnecessary.

The default project name is `new-api`, matching this machine's existing local containers and `new-api_local_mysql_data` volume. If your existing containers use a different Compose project name, pass the matching `LOCAL_PROJECT` to every command. A different project name selects different named volumes; it does not reuse the old database.

## Replace the application after code changes

```sh
make local-update
```

This checks that MySQL and Redis are running, builds the current frontend/backend using Docker's build cache, and runs `up --no-deps --force-recreate --wait new-api`. It does not start, rebuild or replace MySQL/Redis. Application startup can still migrate the database schema as required by the new code.

Run `make local-up` if dependencies have been stopped. No shutdown is necessary between test runs. While the application is being replaced, requests can be briefly interrupted. If building fails, the existing application container remains running. If the replacement fails its health check, inspect `make local-logs`; there is no automatic rollback.

## Ports and operations

```sh
make local-status
make local-logs
make local-stop

# Alternate application port; use the same setting for subsequent commands.
make local-up LOCAL_APP_PORT=3001
make local-update LOCAL_APP_PORT=3001
```

`local-stop` stops only new-api. MySQL and Redis keep running. Application data is stored in the separate `local_api_data` named volume. MySQL retains its existing `local_mysql_data` volume. The existing local Redis configuration has no persistent volume; replacing that Redis container can lose its cache. These targets preserve it.

Do not use `docker compose down -v` to refresh code: it removes named volumes. Avoid mixing the default deployment Compose file into this project's local test stack; it defines different database/cache images and storage.

## Pelican model discovery and generation through the backend

Each connection has an explicit **Request method**. New connections default to **Server proxy**; existing saved connections retain **Browser direct** until changed. The chosen method applies to both model discovery and SVG generation and is saved with history for reruns. A batch can compare connections using different API addresses and request methods.

In **Server proxy** mode, sign in on this application origin. Model discovery uses `POST /api/pelican-test/models`; generation uses `POST /api/pelican-test/run`. The backend sends the supplied key only to the configured upstream and does not persist it. Generation supports native Responses and Chat Completions formats with the fixed benchmark prompt. Each request makes one upstream attempt, with no automatic retry or redirect. Cancelling the batch cancels the upstream HTTP context, although an upstream may already have started processing or billing.

Generation is bounded to five minutes and a 4 MiB upstream response. Each signed-in user can have four concurrent generations per application process, with a process-wide limit of 32. The server applies its configured fetch/SSRF policy; a blocked address must be allowed by the deployment's policy before it can be used. Model discovery retains its shorter timeout and separate rate limit.

After updating this code, run `make local-update` (or `make local-up` if dependencies are stopped), sign in at `http://localhost:3000`, and open `/pelican-test`. Choose **Server proxy**, enter the upstream Base URL and key, fetch models, select reasoning efforts, and start the batch. This replaces only the application container and preserves the running MySQL and Redis containers. The public `/pelican-test-preview` page can use the proxy after signing in on the same application origin. A frontend running on port 5173 needs the updated backend running at its configured proxy target, which defaults to port 3000.

In **Browser direct** mode, the browser sends requests to the configured upstream, which must allow CORS. There is no automatic switch between request methods after a failure. To test the local gateway directly from the browser, use `http://localhost:3000/v1`, configure a usable channel, and create an API token in the local dashboard. Inside Docker, a proxy target of `localhost` refers to the application container; private targets are also subject to the server fetch policy.

Each connection supports up to 16 named API keys sharing the same Base URL, request method, API format and selected models. Add keys with **Add API key**, give them names and enable the keys to include in the batch. The request total is the sum of enabled keys × selected models × reasoning efforts × repeat count across enabled connections, capped at 64 requests per batch. **Key for model discovery** selects the key used to fetch the model list; it does not restrict which enabled keys run the batch. Model access can vary between keys, and failures appear on the corresponding key’s result card without stopping other tests.

Results show the connection and key names and can be filtered by connection, key and model. Existing single-key profiles and history migrate automatically. API keys are remembered independently in this browser only when **Remember key on this browser** is enabled for that key. Names and key identities are included in history; secret values are excluded. A rerun restores the request method and reuses a current key only when the connection ID, normalized upstream endpoint and key ID match, even after keys have been reordered or renamed. Removed or unremembered keys require re-entry before rerunning.


### Streaming generation

Pelican tests request native SSE streaming by default for both Responses and Chat Completions, through either transport. In server proxy mode, the backend flushes complete upstream events immediately, sends a heartbeat every 15 seconds while waiting, and disables response compression and proxy buffering for this route. The gallery updates text and first-token latency as output arrives; open a result's raw response to inspect live text. SVG previews appear after the full response finishes.

A missing terminal event or a provider failure marks the result as failed and preserves received text in history. Cancelling stops both the browser reader and the upstream request. There is no automatic retry. Providers that ignore `stream` and return JSON remain compatible, but cannot show incremental text. The server proxy retains its five-minute request timeout; SSE readers in both transports enforce a 4 MiB response limit. A gateway between the backend and the provider can still return 504 before any upstream event; local heartbeats cannot extend that gateway's timeout.

After `make local-update`, test one Responses endpoint and one Chat Completions endpoint. In browser Network tools, the `/api/pelican-test/run` response should have `Content-Type: text/event-stream`, an initial `: pelican-ready` comment, incremental events, and a terminal model event. Confirm the raw text updates before completion, usage appears at completion, and stopping a run retains partial text without marking it successful.
