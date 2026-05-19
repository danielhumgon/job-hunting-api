# Job Hunting API

Backend service that **aggregates job listings from multiple external sources**, **scores** each posting with an LLM, **persists** everything in MongoDB, and **exposes** search-friendly HTTP APIs. The app is built **on top of the [ipfs-service-provider](https://github.com/Permissionless-Software-Foundation/ipfs-service-provider) boilerplate** (Koa, MongoDB, timers, Clean Architecture). See [PEDIGREE.md](./PEDIGREE.md) for upstream lineage.

---

## Multi-source ingestion strategy

The design goal is **many job boards and APIs, one pipeline**:

1. **Source adapters** live under `src/adapters/job-sources/`. Each adapter knows how to call an external site, normalize rows into a **canonical vacancy shape**, and expose `fetchVacancies()` (and optional `start()` for warmup).
2. **Registry** (`src/adapters/job-sources/index.js`) lists every active source. On each ingestion tick, the registry merges batches from all sources; failures in one source do not stop the others.
3. **Identity** is always `source` + `externalId`, so the same logical job updates in place when re-ingested, regardless of which batch it arrived in.

**Vacantes Digitales** (`vacantesdigitales`) is the **first** implemented source—it is not the architecture. Ingestion calls **[Vacantes Digitales `GET /api/search`](https://vacantesdigitales.com/api#endpoints)** several times with full-text queries defined in [`src/adapters/job-sources/vacantesdigitales.js`](./src/adapters/job-sources/vacantesdigitales.js) as `PROFILE_STACK_SEARCH_QUERIES` (aligned with the target stack in [`src/adapters/llm/vacancy-scoring-prompt.md`](./src/adapters/llm/vacancy-scoring-prompt.md)). Results are merged and **deduped by vacancy `id`**, then normalized to the canonical shape (the normalizer accepts both this JSON shape and the older `/api/vacancies`-style fields).

Each successful fetch logs how many **unique** vacancies were returned and, when duplicates appeared across queries, how many **raw** rows were returned before dedupe (`VacantesDigitales.fetchVacancies: …`).

**X API v2** (`x`) ingests hiring signals from **[`GET /2/tweets/search/recent`](https://developer.x.com/en/docs/twitter-api/tweets/search/api-reference/get-tweets-search-recent)** using an app-only **Bearer** token (`X_API_BEARER_TOKEN` → `xApiBearerToken` in [`config/env/common.js`](./config/env/common.js)). Ingestion runs one recent-search request per query in [`src/adapters/job-sources/x-api.js`](./src/adapters/job-sources/x-api.js) as `PROFILE_STACK_SEARCH_QUERIES` (stack keywords aligned with [`src/adapters/llm/vacancy-scoring-prompt.md`](./src/adapters/llm/vacancy-scoring-prompt.md), plus hiring keywords and `-is:retweet`). Tweets are merged across queries, **deduped by tweet `id`**, and normalized to the canonical shape (`sourceUrl` is the status on x.com; author display name becomes `company` when present). When the bearer token is missing, the source **no-ops** on each tick.

Each successful fetch logs how many **unique** tweets were returned and, when duplicates appeared across queries, how many **raw** rows were returned before dedupe (`XApiJobSource.fetchVacancies: …`).

New sources are added by implementing the same contract and registering the class in the `JobSources` registry. Field-level rules for the first source and the HTTP surface are documented in [dev-docs/vacantesdigitales/specs.md](./dev-docs/vacantesdigitales/specs.md) (note: the adapter’s live HTTP usage may be newer than portions of that doc—**`vacantesdigitales.js`** is the source of truth for which endpoints are called).

---

## Documentation and architecture

**[dev-docs/](./dev-docs/)** is the home for developer-facing documentation:

- **[dev-docs/README.md](./dev-docs/README.md)** — index of topical docs.
- **[dev-docs/vacantesdigitales/specs.md](./dev-docs/vacantesdigitales/specs.md)** — technical specification (API routes, data model, LLM contract, Vacantes Digitales adapter).
- **[dev-docs/vacantesdigitales/what-changed.md](./dev-docs/vacantesdigitales/what-changed.md)** — how job-hunting features sit on the boilerplate (layers, data flow, configuration, operations).

New features (additional sources, API changes, scoring behavior) should be **documented there** so the root README stays a short entry point.

---

## What you get

| Capability | Description |
|------------|-------------|
| **Ingestion** | Timer-driven pipeline: fetch → validate → LLM score → upsert into MongoDB. |
| **LLM scoring** | OpenAI-compatible chat API; prompt in `src/adapters/llm/vacancy-scoring-prompt.md`; retries and validation via `zod`. |
| **REST** | `GET /vacancies/:page` (paginated list) and `GET /vacancies/:id` when Mongo is enabled. |
| **Boilerplate** | Users, JWT auth, usage stats, IPFS/Helia integration, JSON-RPC, and existing `/api/v1/*` routes from upstream (see upstream README patterns). |

---

## Requirements

- **Node.js** ^20.16.0  
- **npm** ^10.8.1  
- **MongoDB** (local or remote) for vacancies and core app data  
- **Docker** / **Docker Compose** (optional, for production-style deployment with go-ipfs + Mongo + app)

---

## Installation

### Development

1. **Clone** this repository and enter the directory.

2. **MongoDB** — run a local instance matching `config/env/development.js` (default URI) or override with environment-specific settings (e.g. `DBURL` in production — see [`config/env/`](./config/env/) and any `install-mongo` helper from upstream if you use it).

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Environment** — copy `.env-example` to `.env` and edit. At minimum, for local job-hunting work you will typically set:

   - `DISABLE_IPFS=1` if you are not using the embedded IPFS node yet  
   - Ingestion: `INGEST_ON_BOOT`, `INGEST_INTERVAL_MS`  
   - X API (optional): `X_API_BEARER_TOKEN` — without it, the `x` source is skipped on each tick  
   - LLM: `LLM_API_URL`, `LLM_MODEL`, and `LLM_API_KEY` or `OLLAMA_API_KEY` as needed  

   All variables ultimately flow through **`config/env/common.js`** (single place to inspect defaults and names).

5. **Start**

   ```bash
   npm start
   ```

   Default HTTP port is **5020** unless overridden by `PORT`.

### Production (Docker Compose)

See **[production/docker/README.md](./production/docker/README.md)** for the three-container layout (go-ipfs, MongoDB, application), port notes, and bring-up/teardown commands (`docker-compose up -d`, `docker-compose down`).

---

## Usage

### npm scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run the server |
| `npm test` | Unit tests (`test:unit`) |
| `npm run test:unit` | Unit tests with coverage gates |
| `npm run test:all` | Unit + selected e2e |
| `npm run lint` | ESLint (Standard style) |
| `npm run docs` | Generate apidoc output into `docs/` |

### Ingestion behavior

- A **timer** runs vacancy ingestion on `INGEST_INTERVAL_MS` (default: three hours).  
- If **`INGEST_ON_BOOT=true`** and the environment is not `test`, one run happens shortly after timers start.  
- Logs include **metrics** for each tick (counts per source, LLM failures, persistence stats).  
- **Vacantes Digitales** also prints a line such as `VacantesDigitales.fetchVacancies: N unique vacancies` when that source finishes its `/api/search` batch (see multi-source section above).  
- **X API** prints a line such as `XApiJobSource.fetchVacancies: N unique tweets` when recent search completes (skipped when `X_API_BEARER_TOKEN` is unset).

### Vacancies API (examples)

Base URL assumes `http://localhost:5020`.

```bash
# Paginated list, sorted by relevance (llmScore) and recency by default
curl 'http://localhost:5020/vacancies/1'

# Second page (10 items per page)
curl 'http://localhost:5020/vacancies/2'

# Single document by Mongo _id
curl 'http://localhost:5020/vacancies/<id>'
```

Public vacancy routes do not require authentication in v1; other boilerplate routes may still enforce JWT—see **[dev-docs/vacantesdigitales/specs.md](./dev-docs/vacantesdigitales/specs.md)**.

### Generated API docs

Inline apidoc comments can be compiled with **`npm run docs`**. Open the generated site from the app's static docs path when running (often `http://localhost:5020/` for the doc bundle—match your local `PORT`).

---

## Configuration highlights

| Area | Where to look |
|------|----------------|
| Env vars / defaults | [`config/env/common.js`](./config/env/common.js) |
| Example `.env` | [`.env-example`](./.env-example) (copy to `.env`) |
| Ingest timing, LLM URL/model, retries, min score | `INGEST_*`, `LLM_*`, `JOB_INGESTION_VERSION`, `MIN_VACANCY_LLM_SCORE`, etc. |
| X API bearer token | `X_API_BEARER_TOKEN` → `xApiBearerToken` in [`config/env/common.js`](./config/env/common.js); search queries in [`src/adapters/job-sources/x-api.js`](./src/adapters/job-sources/x-api.js) |

---

## Project layout (conceptual)

The repo follows **Clean Architecture** conventions from the boilerplate (`src/adapters`, `src/use-cases`, `src/entities`, `src/controllers`). Job-hunting code adds **job-sources**, **LLM**, **vacancy** persistence, **ingestion** use case, **vacancies** REST routes, and **timer** wiring—see [dev-docs/vacantesdigitales/what-changed.md](./dev-docs/vacantesdigitales/what-changed.md) for the diagram and flow.

---

## Contributing / tests

- **Style:** [JavaScript Standard Style](https://standardjs.com) (`npm run lint`).  
- **Tests:** `npm run test:unit`; coverage thresholds are enforced via `c8`.  
- **New source adapter:** implement `fetchVacancies()` + normalization, register in `JobSources`, add tests under `test/unit/adapters/job-sources/`, and document behavior under `dev-docs/` (subfolder per source or a shared ingestion doc—follow the existing `vacantesdigitales` layout as a template).

---

## Dependencies (selected)

- **Runtime:** [Koa](https://koajs.com/), [Mongoose](https://mongoosejs.com/), [axios](https://axios-http.com/), [dotenv](https://github.com/motdotla/dotenv), [zod](https://zod.dev/), [helia-coord](https://www.npmjs.com/package/helia-coord), and other packages declared in [`package.json`](./package.json).

---

## License

[MIT](./LICENSE.md)
