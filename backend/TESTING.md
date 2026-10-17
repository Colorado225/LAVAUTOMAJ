# Backend tests

The PostgreSQL-backed integration tests are opt-in. From `backend/`, create a separate disposable database with `test` in its database name, then run:

```sh
TEST_DATABASE_URL='postgresql://<user>:<password>@<host>:<port>/<database>_test?sslmode=disable' go test ./...
```

`TestMain` refuses to start if `TEST_DATABASE_URL` is absent, does not contain `test` in the database name, or resolves to the same database as `DATABASE_URL`. Without `TEST_DATABASE_URL`, database integration tests are skipped; database-independent handler tests still run.

The test setup applies migrations only to `TEST_DATABASE_URL`. It never falls back to `DATABASE_URL`, runs migration rollback, truncates tables, or deletes unscoped user/organization rows. Individual fixtures use random IDs and clean up only those IDs. Resetting the disposable database, if needed, is an explicit operator action outside the test process.
