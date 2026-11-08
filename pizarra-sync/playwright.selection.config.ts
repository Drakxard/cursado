import { defineConfig } from '@playwright/test';
import navigation from './playwright.navigation.config';

export default defineConfig({
  ...navigation,
  grep: /blank background selection/,
  outputDir: 'selection-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'selection-report' }]],
});
