// Gera dist/index.js empacotando o código do servidor e o pacote @nexus/shared
// (que é distribuído como TypeScript fonte dentro do monorepo).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  // @nexus/shared precisa ser empacotado (não tem build próprio).
  plugins: [
    {
      name: 'bundle-workspace-shared',
      setup(b) {
        b.onResolve({ filter: /^@nexus\/shared$/ }, () => ({
          path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
        }));
      },
    },
  ],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
console.info('server build: dist/index.js');
