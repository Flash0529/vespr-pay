---
name: api-design
description: Design or review an HTTP API: resources, status codes, errors, pagination, idempotency, versioning, auth and rate limits. Use when adding or changing endpoints.
---
# API design

Decide each of these on purpose and write the answer down in the API's docs:

1. **Resources and verbs:** nouns in paths (`/orders/{id}`), verbs from HTTP. `GET` never changes anything; `PUT` replaces; `PATCH` changes part; `DELETE` is repeatable.
2. **Status codes:** 200/201 (with `Location`)/204 for success; 400 malformed, 401 not signed in, 403 signed in but not allowed, 404 missing, 409 conflict, 422 valid shape but rejected, 429 too many, 5xx only for our faults. Do not return 200 with an error inside.
3. **Errors:** one shape everywhere, e.g. `{ "error": { "code": "out_of_stock", "message": "...", "fields": {...} } }`. Messages help the developer; never leak stack traces, SQL or secrets.
4. **Input:** validate type, range, length and unknown fields at the edge; reject, do not guess. Limit body size. Treat every id as untrusted: check the caller may see that row (broken object-level authorisation is the most common hole).
5. **Lists:** pagination from the start (cursor preferred), a stable sort, a maximum page size, filters named after fields.
6. **Idempotency:** retries must be safe. Accept an `Idempotency-Key` on creates and payments; make `PUT`/`DELETE` naturally repeatable.
7. **Versioning and change:** add fields, never change meaning; version in the path or a header when you must break; deprecate with a date.
8. **Auth and limits:** short-lived tokens, scopes per endpoint, rate limits per caller with `Retry-After`, CORS only for known origins, no secrets in URLs or logs.
9. **Observability:** a request id returned and logged; log outcomes, not bodies.

Produce: the endpoint table (method, path, auth, request, responses), the error shape, and a list of decisions you made and why.
