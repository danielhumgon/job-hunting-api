# Job Hunter API — Technical Specification

## Purpose

Backend that aggregates, scores, and persists job listings from multiple external
sources. Built **on top of the `ipfs-service-provider` boilerplate**, following
its Clean Architecture patterns and Dependency Injection conventions.

The ingestion pipeline has three steps: **fetch** from external sources,
**score** with a local LLM, and **persist** to MongoDB.

The first implemented source is **VacantesDigitales**
(`https://vacantesdigitales.com/api`), fetching vacancies under the `desarrollo`
category and `remoto` modality.

**Inherited stack:** Node.js (ESM) · Koa2 · MongoDB + Mongoose · `setInterval`
for background jobs.

---

## 1) Core Requirements

- API base path: `/api/v1`
- Public read endpoints (no authentication in v1).
- Each vacancy is persisted in MongoDB with a compound unique key: `source + externalId`.
- Ingestion runs periodically via the existing `TimerControllers` system in the repo.
- Adding a new source only requires adding an adapter under `src/adapters/job-sources/`.
- Every ingested vacancy goes through LLM scoring before being stored.
- All dependencies are injected via constructor following the boilerplate pattern
  (`localConfig.adapters`, `localConfig.useCases`).

---

## 2) Configured Sources

| `sourceSlug`        | Display Name       | Base URL                            | Status   |
|---------------------|--------------------|-------------------------------------|----------|
| `vacantesdigitales` | Vacantes Digitales | `https://vacantesdigitales.com/api` | ✅ Active |

---

## 3) API Endpoints

| Method | Route                   | Description                          |
|--------|-------------------------|--------------------------------------|
| GET    | `/vacancies/:page`      | Paginated vacancy list (page is a positive integer; 10 per page) |
| GET    | `/vacancies/:id`        | Single vacancy detail by internal Mongo ID                      |
| PUT    | `/vacancies/:id`        | Update a vacancy                                                |
| DELETE | `/vacancies/:id`        | Delete a vacancy                                                |

List responses are sorted by `llmScore` desc, then `datePosted` desc. Query strings on the list route are ignored.

### Historical note

Earlier drafts described filters (`q`, `category`, etc.) on the list endpoint; the current implementation exposes **path-based pagination only** on `GET /vacancies/:page`.

> The `/api/v1/health` and `/api/v1/users` endpoints already exist in the
> boilerplate and are not modified.

---

## 4) Architecture Layers (Clean Architecture)

The repo is split into 4 layers. Changes for this project are distributed as follows.

### 4.1 Entities — `src/entities/`

Add `vacancy.js` with the Vacancy entity validation class (no external dependencies).

### 4.2 Use Cases — `src/use-cases/`

Add `vacancy.js` with the business logic:
- Save / upsert normalized and scored vacancies.
- Query vacancies with filters and pagination.

Update `src/use-cases/index.js` to instantiate and expose `this.vacancy`.

### 4.3 Adapters — `src/adapters/`

**Mongoose model** → add `src/adapters/localdb/models/vacancy.js`.
Update `src/adapters/localdb/index.js` to expose the model.

**External sources** → create `src/adapters/job-sources/`:
- `index.js` — registry of active source adapters.
- `vacantesdigitales.js` — VacantesDigitales adapter.

**LLM** → create `src/adapters/llm/index.js` — adapter that handles
communication with the local LLM and loads the scoring prompt file.

Update `src/adapters/index.js` to instantiate `this.jobSources` and `this.llm`.

### 4.4 Controllers — `src/controllers/`

**REST** → create `src/controllers/rest-api/vacancies/` with the route handlers.
Update `src/controllers/rest-api/index.js` to mount the vacancies routes.

**Timer** → add the ingestion job to the existing `TimerControllers`
(`src/controllers/timer-controllers.js`), following the same `setInterval`
pattern already used by `cleanUsage` and `backupUsage`.

---

## 5) Data Model — `src/adapters/localdb/models/vacancy.js`

Uniqueness enforced by `{ source, externalId }`.

### 5.1 Source metadata fields

`externalId`, `source`, `title`, `slug`, `company`, `category`, `locationType`,
`addressLocality`, `addressCountry`, `experienceLevel`, `datePosted`,
`validThrough`, `keywords`, `skills`, `summary`, `content`, `applyUrl`,
`sourceUrl`, `fetchedAt`, `ingestionVersion`

### 5.2 LLM scoring fields

| Field            | Type     | Description                                          |
|------------------|----------|------------------------------------------------------|
| `llmScore`       | Number   | Relevance score from 0 to 1                          |
| `llmReasons`     | [String] | Short reasons that justify the score                 |
| `llmFlags`       | [String] | Red flags detected (e.g. `requires_relocation`)      |
| `llmModel`       | String   | Model used (e.g. `gemma4`)                           |
| `llmPromptVersion` | String | Version of the scoring prompt file used              |
| `llmStatus`      | String   | `pending` · `completed` · `failed`                   |
| `llmClassifiedAt`| Date     | When the LLM scoring ran                             |
| `llmRawOutput`   | Mixed    | Raw LLM response, stored for debugging               |

### 5.3 Indexes

- `{ source, externalId }` — unique
- `{ category, datePosted }`
- `{ locationType, datePosted }`
- `{ llmScore, datePosted }` — for sorting by relevance
- `{ llmStatus }` — to find unscored vacancies
- Text index on `title + summary + keywords`

---

## 6) VacantesDigitales Adapter — `src/adapters/job-sources/vacantesdigitales.js`

Fetches the following endpoint, paginating until all results are exhausted:

```
GET https://vacantesdigitales.com/api/vacancies
  ?category=desarrollo
  &location_type=remoto
  &limit=100
  &page={n}
```

Every adapter must implement two methods: `fetchVacancies()` and `normalize()`.
The `normalize()` method maps the source response fields to the internal
canonical schema (e.g. `location_type` → `locationType`,
`date_posted` → `datePosted`, etc.).

---

## 7) LLM Scoring — `src/adapters/llm/index.js`

### 7.1 Purpose

After a vacancy is fetched and normalized, it is passed through a local LLM
(e.g. Gemma4) before being stored. The LLM reads a scoring prompt file and
uses it to evaluate the vacancy, returning a relevance score and any red flags.

This step is the last stage of the ingestion pipeline, and its output is stored
alongside the source metadata in the same MongoDB document.

### 7.2 Prompt file

The scoring instructions live in a Markdown file versioned with the repo:

```
src/adapters/llm/vacancy-scoring-prompt.md
```

This file defines the criteria the LLM must use to evaluate a vacancy — for
example: how relevant the tech stack is, whether the remote policy is genuine,
seniority requirements, etc. Updating the criteria only requires editing this
file and bumping `llmPromptVersion` in the config.

### 7.3 Input sent to the LLM

The adapter sends a combination of structured metadata and the vacancy text:

- `title`
- `company`
- `category`
- `locationType`
- `experienceLevel`
- `keywords`
- `skills`
- `summary`
- `content` (full description in Markdown)

### 7.4 Expected LLM response

The LLM must return **valid JSON only**, with this exact shape:

```json
{
  "score": 0.87,
  "reasons": ["strong_tech_match", "fully_remote_confirmed"],
  "flags": ["requires_latam_timezone"]
}
```

| Field     | Type     | Description                               |
|-----------|----------|-------------------------------------------|
| `score`   | Number   | Relevance from `0` (irrelevant) to `1` (perfect match) |
| `reasons` | [String] | Short machine-readable strings that explain the score |
| `flags`   | [String] | Any red flags or caveats detected         |

### 7.5 Response validation and normalization

After the LLM responds:

1. Validate JSON shape with `zod`.
2. Clamp `score` to `[0, 1]`.
3. Lowercase and deduplicate `reasons` and `flags`.
4. Map validated output to the `llm*` fields in the vacancy document.
5. Set `llmStatus: "completed"` and `llmClassifiedAt: new Date()`.
6. Store raw response in `llmRawOutput` for debugging.

If validation fails:

- Set `llmStatus: "failed"` and `llmScore: null`.
- Log the error — do not throw, do not block persistence.

### 7.6 Scoring criteria (defined in the prompt file)

The `vacancy-scoring-prompt.md` file should instruct the LLM to consider:

- Relevance of the tech stack for a software developer role.
- Whether the remote modality is genuine or has hidden location restrictions.
- Seniority requirements vs. accessibility for different levels.
- Clarity and quality of the job description.
- Presence of compensation information (positive signal).

---

## 8) Ingestion Pipeline — `src/controllers/timer-controllers.js`

### 8.1 Timer setup

A new timer is added to the existing `startTimers()` method:

```js
this.ingestVacanciesInterval = 1000 * 60 * 60 * 3  // every 3 hours
this.ingestVacanciesHandle = setInterval(
  this.ingestVacancies,
  this.ingestVacanciesInterval
)
```

### 8.2 Ingestion steps

The `ingestVacancies()` method executes the full pipeline in order:

1. Iterate over the active adapters in `this.adapters.jobSources`.
2. Call `fetchVacancies()` on each adapter to get normalized vacancies.
3. For each vacancy, call `this.adapters.llm.score(vacancy)` to get the LLM output.
4. Merge source metadata + LLM output into a single document.
5. Delegate upsert to `this.useCases.vacancy.saveMany(vacancies)`.
6. Log tick metrics: fetched, inserted, updated, skipped, llm errors.
7. Never throw if a source or the LLM fails — log and continue.

---

## 9) File Structure (changes on top of the boilerplate)

```
src/
├── adapters/
│   ├── job-sources/                   ← NEW
│   │   ├── index.js                   ← Active adapter registry
│   │   └── vacantesdigitales.js       ← VacantesDigitales adapter
│   ├── llm/                           ← NEW
│   │   ├── index.js                   ← LLM adapter (loads prompt, calls model)
│   │   └── vacancy-scoring-prompt.md ← LLM scoring instructions
│   ├── localdb/
│   │   ├── models/
│   │   │   ├── users.js               (existing)
│   │   │   ├── usage.js               (existing)
│   │   │   └── vacancy.js             ← NEW — Mongoose model
│   │   └── index.js                   (update — expose vacancy model)
│   └── index.js                       (update — add this.jobSources, this.llm)
├── controllers/
│   ├── rest-api/
│   │   ├── vacancies/                 ← NEW
│   │   │   └── index.js               ← Handlers for /vacancies routes
│   │   └── index.js                   (update — mount vacancies routes)
│   └── timer-controllers.js           (update — add ingestVacancies timer)
├── use-cases/
│   ├── vacancy.js                     ← NEW — business logic
│   └── index.js                       (update — expose this.vacancy)
└── entities/
    ├── user.js                        (existing)
    └── vacancy.js                     ← NEW — entity validation
```

---

## 10) Environment Variables

Added to the existing `config/` of the boilerplate:

```bash
INGEST_ON_BOOT=true           # Run ingestion on server startup
INGEST_INTERVAL_MS=10800000   # 3 hours in ms (default)

LLM_MODEL=gemma4              # LLM model to use for scoring

```