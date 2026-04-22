import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    permissions: ['storage', 'tabs', 'scripting', 'notifications', 'downloads', 'alarms'],
    host_permissions: ['https://alidocs.dingtalk.com/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
  webExt: {
    disabled: true, // 禁用 WXT 自动启动浏览器
  },
});
