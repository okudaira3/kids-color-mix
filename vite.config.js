import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/kids-color-mix/',
  plugins: [react()],
});
