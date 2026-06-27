import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  external: [
    '@fd/shared',
    'bcryptjs',
    'sharp',
    'minio',
    'ioredis',
    'ws',
    'postgres',
  ],
  banner: {
    js: [
      `import { createRequire } from 'module';`,
      `const require = createRequire(import.meta.url);`,
    ].join('\n'),
  },
  sourcemap: true,
});

console.log('[build] Server bundled to dist/index.js');

await esbuild.build({
  entryPoints: ['src/db/migrate.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/migrate.js',
  external: ['postgres'],
  banner: {
    js: [
      `import { createRequire } from 'module';`,
      `const require = createRequire(import.meta.url);`,
    ].join('\n'),
  },
});

console.log('[build] Migrate bundled to dist/migrate.js');
