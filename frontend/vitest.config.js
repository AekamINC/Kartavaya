import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    // Co-located suites count. The previous glob was anchored at
    // `src/__tests__/**`, so `src/pages/client/__tests__/smoke.test.jsx` — six
    // tests asserting the client portal never renders a staff email, an
    // assignee name or an internal approval row — was written, passing, and
    // never run by `npm test`. A test that does not run is not a test.
    include: ['src/**/__tests__/**/*.test.{js,jsx,ts,tsx}'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
      },
    },
  },
  define: {
    // Vitest doesn't inject import.meta.env automatically for tests
    'import.meta.env.VITE_BACKEND_URL': JSON.stringify('http://localhost:8000'),
    'import.meta.env.DEV': JSON.stringify(false),
    'import.meta.env.PROD': JSON.stringify(false),
    'import.meta.env.MODE': JSON.stringify('test'),
  },
});
