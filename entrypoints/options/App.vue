<script lang="ts" setup>
import { NMessageProvider } from 'naive-ui';
import OptionsPage from '@/components/OptionsPage.vue';
</script>

<template>
  <n-message-provider>
    <OptionsPage />
  </n-message-provider>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
</style>
