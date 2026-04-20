<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { NMessageProvider, NDialogProvider } from 'naive-ui';
import LoginPage from '@/components/LoginPage.vue';
import GitLabPage from '@/components/GitLabPage.vue';
import JiraPage from '@/components/JiraPage.vue';
import DingTalkPage from '@/components/DingTalkPage.vue';

type PageType = 'login' | 'gitlab' | 'jira' | 'dingtalk';

const currentPage = ref<PageType>('login');
const isLoading = ref(true);

// 根据当前页面类型动态加载组件
// 根据当前页面类型动态加载组件
const currentComponent = computed(() => {
  switch (currentPage.value) {
    case 'gitlab':
      return GitLabPage;
    case 'jira':
      return JiraPage;
    case 'dingtalk':
      return DingTalkPage;
    default:
      return LoginPage;
  }
});
// 处理登录成功事件
const handleLoginSuccess = async () => {
  await determinePage();
};

import { getConfig } from '@/services/config';

// 确定应该显示哪个页面
const determinePage = async () => {
  try {
    isLoading.value = true;

    // 检查是否已登录
    const config = await getConfig();
    const isLoggedIn = config.wegent_url && config.wegent_api_key;

    if (!isLoggedIn) {
      currentPage.value = 'login';
      return;
    }

    // 获取当前活动标签页
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!activeTab || !activeTab.url) {
      currentPage.value = 'login';
      return;
    }

    // 解析URL域名
    const url = new URL(activeTab.url);
    const hostname = url.hostname.toLowerCase();

    // 根据域名判断显示哪个页面
    if (hostname.startsWith('git.') || hostname.startsWith('gitlab.')) {
      currentPage.value = 'gitlab';
    } else if (hostname.startsWith('issue.') || hostname.startsWith('jira.')) {
      currentPage.value = 'jira';
    } else if (hostname.includes('alidocs.dingtalk.com')) {
      currentPage.value = 'dingtalk';
    } else {
      currentPage.value = 'login';
    }
  } catch (error) {
    console.error('Error determining page:', error);
    currentPage.value = 'login';
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  determinePage();
});
</script>

<template>
  <n-dialog-provider>
    <n-message-provider>
      <div class="popup-container">
        <div v-if="isLoading" class="loading">
          加载中...
        </div>
        <component
          v-else
          :is="currentComponent"
          @login-success="handleLoginSuccess"
        />
      </div>
    </n-message-provider>
  </n-dialog-provider>
</template>

<style scoped>
.popup-container {
  width: 400px;
  min-height: 300px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #666;
  font-size: 14px;
}
</style>
