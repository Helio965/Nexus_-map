import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'server',
          root: './server',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      './client/vite.config.ts',
    ],
  },
});
