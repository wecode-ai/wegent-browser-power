<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NText } from 'naive-ui';
import AIMix from './include/AIMix.vue';
import PermissionRequest from './include/PermissionRequest.vue';
import type { ToolConfig } from '../services/wegentApi';
import { createGitLabApiService, parseMergeRequestUrl } from '../services/gitlabApi';
import { getAIMixConfig } from '../services/config';
import type { AIMixActionItem } from '../services/config';

const isMergeRequest = ref(false);
const currentUrl = ref('');
const currentDomain = ref('');

// AI 操作配置数组（动态加载）
const aiMixActions = ref<AIMixActionItem[]>([]);

// 检查当前页面是否是 MergeRequest 格式
const checkMergeRequest = async () => {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url) {
      currentUrl.value = activeTab.url;
      // 检查 URL 是否包含 /-/merge_requests/
      isMergeRequest.value = activeTab.url.includes('/-/merge_requests/');

      // 如果是 MR 页面，保存域名
      if (isMergeRequest.value) {
        const urlObj = new URL(activeTab.url);
        currentDomain.value = urlObj.hostname;
      }
    }
  } catch (error) {
    console.error('Error checking merge request:', error);
  }
};

// 清理 MR URL（移除 /diff 等后缀）
const cleanMrUrl = (url: string): string => {
  // 匹配到 merge_requests/数字 后的内容并移除
  return url.replace(/(\/merge_requests\/\d+).*$/, '$1');
};

// 获取 MR 详细信息
const getMrDetails = async (projectPath: string, mrIid: string) => {
  const gitlabApi = await createGitLabApiService();

  if (!gitlabApi) {
    throw new Error('无法创建 GitLab API 服务，请确保在 GitLab 页面上');
  }

  return await gitlabApi.service.getMergeRequestDetails(projectPath, mrIid);
};

// 动态获取 AI Review 配置（仅返回动态 tools）
const getAiReviewDynamicConfig = async () => {
  // 1. 解析当前 MR URL
  const cleanedUrl = cleanMrUrl(currentUrl.value);
  const parsed = parseMergeRequestUrl(cleanedUrl);

  if (!parsed) {
    throw new Error('无法解析 Merge Request URL');
  }

  const { projectPath, mrIid } = parsed;

  // 2. 获取 MR 详细信息
  const mrDetails = await getMrDetails(projectPath, mrIid);

  // 3. 返回动态配置（仅动态 tools）
  return {
    tools: [
      {
        type: 'wegent_code_bot' as const,
        workspace: {
          git_url: mrDetails.sourceProject.http_url_to_repo,
          branch: mrDetails.mergeRequest.source_branch,
          git_repo: mrDetails.sourceProject.path_with_namespace,
        },
      },
    ] as ToolConfig[],
  };
};

// 获取业务数据（返回 map，key 对应 prompt 中的变量名）
const getMrBusinessData = async (): Promise<Record<string, string>> => {
  const cleanedUrl = cleanMrUrl(currentUrl.value);
  const parsed = parseMergeRequestUrl(cleanedUrl);

  if (!parsed) {
    return { mrUrl: cleanedUrl, mrTitle: '' };
  }

  const { projectPath, mrIid } = parsed;

  try {
    const mrDetails = await getMrDetails(projectPath, mrIid);
    return {
      mrUrl: cleanedUrl,
      mrTitle: mrDetails.mergeRequest.title || '',
    };
  } catch (error) {
    console.error('获取 MR 详情失败:', error);
    return { mrUrl: cleanedUrl, mrTitle: '' };
  }
};

// 加载 AI Mix 配置并注入动态方法
const loadAIMixConfig = async () => {
  try {
    const config = await getAIMixConfig();

    // 为 GitLab 配置注入动态 getAiConfig 方法
    aiMixActions.value = config.gitLab.actions.map(action => {
      if (action.buttonLabel === 'AI协助Review') {
        return {
          ...action,
          getAiConfig: getAiReviewDynamicConfig,
        };
      }
      return action;
    });
  } catch (error) {
    console.error('加载 AI Mix 配置失败:', error);
    aiMixActions.value = [];
  }
};

onMounted(() => {
  checkMergeRequest();
  loadAIMixConfig();
});
</script>

<template>
  <div class="gitlab-container">
    <NCard title="GitLab 集成" :bordered="false" size="large">
      <NSpace vertical :size="20">
        <div v-if="isMergeRequest" class="merge-request-section">
          <!-- 权限检查和授权组件 -->
          <PermissionRequest :domain="currentDomain">
            <AIMix :actions="aiMixActions" :get-business-data="getMrBusinessData" />
          </PermissionRequest>
        </div>

        <NText v-else depth="3">
          当前页面不是 Merge Request 页面
        </NText>
      </NSpace>
    </NCard>
  </div>
</template>
