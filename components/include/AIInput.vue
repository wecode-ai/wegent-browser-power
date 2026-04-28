<script lang="ts" setup>
import { ref, h } from 'vue';
import { NButton, NSpace, NIcon, useMessage } from 'naive-ui';
import { Chat, Code } from '@vicons/carbon';
import { createWegentApiService } from '../../services/wegentApi';
import type { ToolConfig } from '../../services/wegentApi';

interface AiConfig {
  /** prompt 模板，支持业务变量占位符 {content} */
  promptTemplate: string;
  /** 模型名称（保留字段，暂不使用） */
  model?: string;
  /** 工具配置列表（保留字段，暂不使用） */
  tools?: ToolConfig[];
}

interface Props {
  /** AI 配置 */
  aiConfig: AiConfig;
  /** 获取业务变量的方法，返回 Promise<Record<string, string>>，key 对应 prompt 中的变量名 */
  getBusinessData: () => Promise<Record<string, string>>;
}

const props = defineProps<Props>();

const message = useMessage();
const isChatLoading = ref(false);
const isCodeLoading = ref(false);

const renderIcon = (icon: any) => () => h(NIcon, null, { default: () => h(icon) });

/**
 * 将 promptTemplate 中所有 {key} 占位符替换为 dataMap 中对应的值
 * 若 map 中不含该 key，则保留原始占位符
 */
const buildContent = (template: string, dataMap: Record<string, string>): string => {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(dataMap, key) ? dataMap[key] : match;
  });
};

const handleExportAndOpen = async (pageType: 'chat' | 'code') => {
  if (pageType === 'chat') {
    isChatLoading.value = true;
  } else {
    isCodeLoading.value = true;
  }

  try {
    const wegentApi = await createWegentApiService();
    if (!wegentApi) {
      message.error('Wegent API 未配置，请先在登录页面配置');
      return;
    }

    const rawContent = await props.getBusinessData();
    const content = buildContent(props.aiConfig.promptTemplate, rawContent);
    const wegentBaseUrl = (wegentApi as any)['baseUrl'];
    const targetUrl = `${wegentBaseUrl}/${pageType}`;

    console.log('准备打开页面:', targetUrl);
    console.log('内容长度:', content.length);

    browser.runtime.sendMessage(
      { action: 'openAndFillInput', url: targetUrl, content },
      (openResponse) => {
        console.log('打开页面响应:', openResponse);
        if (openResponse?.success) {
          message.success(`${pageType === 'chat' ? '对话' : '编码'}页面已打开`);
        } else {
          message.error('打开页面失败: ' + (openResponse?.error || '未知错误'));
        }
      }
    );
  } catch (error) {
    console.error('操作失败:', error);
    message.error(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    isChatLoading.value = false;
    isCodeLoading.value = false;
  }
};
</script>

<template>
  <div class="ai-input-container">
    <NButton
      secondary
      type="info"
      size="large"
      block
      :loading="isChatLoading"
      :disabled="isChatLoading || isCodeLoading"
      :render-icon="renderIcon(Chat)"
      @click="handleExportAndOpen('chat')"
    >
      对话
    </NButton>
    <NButton
      secondary
      type="info"
      size="large"
      block
      :loading="isCodeLoading"
      :disabled="isChatLoading || isCodeLoading"
      :render-icon="renderIcon(Code)"
      @click="handleExportAndOpen('code')"
    >
      编码
    </NButton>
  </div>
</template>

<style scoped>
.ai-input-container {
  width: 100%;
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.ai-input-container :deep(.n-button) {
  flex: 1;
}
</style>
