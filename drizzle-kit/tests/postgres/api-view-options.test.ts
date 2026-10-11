import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';

const skipDistTests = process.env.DRIZZLE_KIT_SKIP_DIST_TESTS === '1';

const loaders = {
	module: `
const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api-postgres');
const { integer, pgMaterializedView, pgTable, pgView } = await import('drizzle-orm/pg-core');
`,
	commonjs: `
const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api-postgres');
const { integer, pgMaterializedView, pgTable, pgView } = require('drizzle-orm/pg-core');
`,
};

beforeAll(() => {
	if (skipDistTests) return;

	for (const bundle of ['api-postgres.mjs', 'api-postgres.js']) {
		const path = resolve(process.cwd(), 'dist', bundle);
		if (!existsSync(path)) {
			throw new Error(
				`View option regressions require ${path}. Run pnpm --filter drizzle-kit build first, `
					+ 'or set DRIZZLE_KIT_SKIP_DIST_TESTS=1 to opt out locally.',
			);
		}
	}
});

const runApiProgram = (script: string) => {
	const output = execFileSync(process.execPath, ['--eval', script], {
		// Resolve the public exports from the built package, rather than the source package's manifest.
		cwd: resolve(process.cwd(), 'dist'),
		encoding: 'utf8',
		env: { ...process.env, NODE_OPTIONS: '' },
	});
	return JSON.parse(output);
};

test.skipIf(skipDistTests).each(['module', 'commonjs'] as const)(
	'a fresh Node program loading the %s API creates a view with options',
	(format) => {
		const statements = runApiProgram(`
(async () => {
${loaders[format]}
const table = pgTable('test', { id: integer('id').primaryKey() });
const empty = await generateDrizzleJson({});
const declared = await generateDrizzleJson({
  table,
  view: pgView('view').with({ securityInvoker: true, checkOption: 'local' }).as((qb) => qb.select().from(table)),
});
process.stdout.write(JSON.stringify(await generateMigration(empty, declared)));
})().catch((error) => { console.error(error); process.exit(1); });
`);

		expect(statements).toContain(
			'CREATE VIEW "view" WITH (check_option = local, security_invoker = true) AS (select "id" from "test");',
		);
	},
);

test.skipIf(skipDistTests).each(['module', 'commonjs'] as const)(
	'a fresh Node program loading the %s API creates a materialized view with storage options',
	(format) => {
		const statements = runApiProgram(`
(async () => {
${loaders[format]}
const table = pgTable('test', { id: integer('id').primaryKey() });
const empty = await generateDrizzleJson({});
const declared = await generateDrizzleJson({
  table,
  view: pgMaterializedView('view').with({ autovacuumEnabled: true, toastTupleTarget: 128 })
    .as((qb) => qb.select().from(table)),
});
process.stdout.write(JSON.stringify(await generateMigration(empty, declared)));
})().catch((error) => { console.error(error); process.exit(1); });
`);

		expect(statements).toContain(
			'CREATE MATERIALIZED VIEW "view" WITH (autovacuum_enabled = true, toast_tuple_target = 128) AS (select "id" from "test");',
		);
	},
);

test.skipIf(skipDistTests).each(['module', 'commonjs'] as const)(
	'a fresh Node program loading the %s API sets and resets materialized view storage options',
	(format) => {
		const statements = runApiProgram(`
(async () => {
${loaders[format]}
const table = pgTable('test', { id: integer('id').primaryKey() });
const before = await generateDrizzleJson({
  table,
  view: pgMaterializedView('view').with({ autovacuumEnabled: true }).as((qb) => qb.select().from(table)),
});
const after = await generateDrizzleJson({
  table,
  view: pgMaterializedView('view').with({ toastTupleTarget: 128 }).as((qb) => qb.select().from(table)),
});
process.stdout.write(JSON.stringify(await generateMigration(before, after)));
})().catch((error) => { console.error(error); process.exit(1); });
`);

		expect(statements).toStrictEqual([
			'ALTER MATERIALIZED VIEW "view" SET (toast_tuple_target = 128);',
			'ALTER MATERIALIZED VIEW "view" RESET (autovacuum_enabled);',
		]);
	},
);

test.skipIf(skipDistTests).each(['module', 'commonjs'] as const)(
	'a fresh Node program loading the %s API sets and resets view options',
	(format) => {
		const statements = runApiProgram(`
(async () => {
${loaders[format]}
const table = pgTable('test', { id: integer('id').primaryKey() });
const before = await generateDrizzleJson({
  table,
  view: pgView('view').with({ securityBarrier: true }).as((qb) => qb.select().from(table)),
});
const after = await generateDrizzleJson({
  table,
  view: pgView('view').with({ securityInvoker: true }).as((qb) => qb.select().from(table)),
});
process.stdout.write(JSON.stringify(await generateMigration(before, after)));
})().catch((error) => { console.error(error); process.exit(1); });
`);

		expect(statements).toStrictEqual([
			'ALTER VIEW "view" SET (security_invoker = true);',
			'ALTER VIEW "view" RESET (security_barrier);',
		]);
	},
);
