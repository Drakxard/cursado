import { defineConfig } from '@playwright/test'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export default defineConfig({
  testDir:'./tests/browser',
  workers:1,
  use:{baseURL:'http://127.0.0.1:4173',channel:process.env.CI?undefined:'chrome',headless:true,viewport:{width:1366,height:900}},
  webServer:{command:npm+' run preview -- --host 127.0.0.1 --port 4173 --strictPort'+(process.env.PIZARRA_TEST_PREVIEW==='1'?' --outDir dist-fase1':''),url:'http://127.0.0.1:4173',reuseExistingServer:false},
})
