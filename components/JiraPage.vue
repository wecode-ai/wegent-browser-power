<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NText, useMessage } from 'naive-ui';
import AIMix from './include/AIMix.vue';
import PermissionRequest from './include/PermissionRequest.vue';
import { getAIMixConfig } from '../services/config';
import type { AIMixActionItem } from '../services/config';

const isJiraPage = ref(false);
const currentUrl = ref('');
const currentDomain = ref('');
const message = useMessage();

// AI 操作配置数组（动态加载）
const aiMixActions = ref<AIMixActionItem[]>([]);

// 检查当前页面是否是 Jira 页面，并检查权限状态
const checkJiraPage = async () => {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url) {
      currentUrl.value = activeTab.url;
      // 检查 URL 是否以 jira. 开头
      const urlObj = new URL(activeTab.url);
      isJiraPage.value = urlObj.hostname.startsWith('jira.');

      // 如果是 Jira 页面，保存域名
      if (isJiraPage.value) {
        currentDomain.value = urlObj.hostname;
      }
    }
  } catch (error) {
    console.error('Error checking Jira page:', error);
  }
};

// 从页面提取 Jira 信息
const extractJiraInfo = async (): Promise<{
  title: string;
  environment: string;
  description: string;
}> => {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!activeTab.id) {
      return { title: '', environment: '', description: '' };
    }

    // 注入脚本到页面提取信息
    const results = await browser.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        // 提取标题
        const titleElement = document.querySelector('#summary-val');
        const title = titleElement?.textContent?.trim() || '';

        // 提取环境信息
        const floodedElement = document.querySelector('#environment-val .flooded');
        let environment = '';
        if (floodedElement) {
          // 获取环境信息的文本内容，保留格式
          environment = floodedElement.textContent?.trim() || '';
        }

        // 提取描述
        const descriptionElement = document.querySelector('#description-val');
        let description = '';
        if (descriptionElement) {
          // 获取描述的文本内容
          description = descriptionElement.textContent?.trim() || '';
        }

        return {
          title,
          environment,
          description,
        };
      },
    });

    if (results && results[0] && results[0].result) {
      return results[0].result as {
        title: string;
        environment: string;
        description: string;
      };
    }

    return { title: '', environment: '', description: '' };
  } catch (error) {
    console.error('提取 Jira 信息失败:', error);
    message.error('提取 Jira 信息失败，请检查权限');
    return { title: '', environment: '', description: '' };
  }
};

// 获取业务数据（返回 map，key 对应 prompt 中的变量名）
const getJiraBusinessData = async (): Promise<Record<string, string>> => {
  try {
    const jiraInfo = await extractJiraInfo();
    return {
      title: jiraInfo.title,
      environment: jiraInfo.environment,
      description: jiraInfo.description,
    };
  } catch (error) {
    console.error('获取 Jira 业务数据失败:', error);
    return { title: '', environment: '', description: '' };
  }
};

// 加载 AI Mix 配置
const loadAIMixConfig = async () => {
  try {
    const config = await getAIMixConfig();

    // 直接使用 Jira 配置
    aiMixActions.value = config.jira.actions;
  } catch (error) {
    console.error('加载 AI Mix 配置失败:', error);
    aiMixActions.value = [];
  }
};

onMounted(() => {
  checkJiraPage();
  loadAIMixConfig();
});
</script>

<template>
  <div class="jira-container">
    <NCard title="Jira 集成" :bordered="false" size="large">
      <NSpace vertical :size="20">
        <div v-if="isJiraPage" class="jira-section">
          <!-- 权限检查和授权组件 -->
          <PermissionRequest :domain="currentDomain">
            <AIMix :actions="aiMixActions" :get-business-data="getJiraBusinessData" />
          </PermissionRequest>
        </div>

        <NText v-else depth="3">
          当前页面不是 Jira 页面
        </NText>
      </NSpace>
    </NCard>
  </div>
</template>
