<script lang="ts" setup>
import { ref } from 'vue';
import { NButton, NInput, NSpace, NCard, useMessage } from 'naive-ui';
import { createWegentApiService } from '../../services/wegentApi';
import type { ToolConfig } from '../../services/wegentApi';

interface AiConfig {
  /** prompt 模板，支持业务变量占位符 {content} */
  promptTemplate: string;
  /** 模型名称 */
  model?: string;
  /** 工具配置列表 */
  tools?: ToolConfig[];
}

interface Props {
  /** 按钮名称，默认 'AI技术评估' */
  buttonLabel?: string;
  /** AI 配置 */
  aiConfig?: AiConfig;
  /** 动态获取 AI 配置的方法（优先级高于 aiConfig） */
  getAiConfig?: () => Promise<AiConfig>;
  /** 获取业务变量的方法，返回 Promise<Record<string, string>>，key 对应 prompt 中的变量名 */
  getBusinessData?: () => Promise<Record<string, string>>;
}

const props = withDefaults(defineProps<Props>(), {
  buttonLabel: 'AI技术评估',
});

const message = useMessage();
const showConfirmDialog = ref(false);
const isLoading = ref(false);
const isSubmitting = ref(false);
const renderedPrompt = ref('');
const resolvedAiConfig = ref<AiConfig | null>(null);

/**
 * 合并两个 AI 配置
 * - getAiConfig 返回的配置优先级更高
 * - tools 数组进行合并
 */
const mergeAiConfig = (base: AiConfig, override: Partial<AiConfig>): AiConfig => {
  return {
    promptTemplate: override.promptTemplate ?? base.promptTemplate,
    model: override.model ?? base.model,
    tools: [...(base.tools || []), ...(override.tools || [])],
  };
};

/**
 * 获取最终的 AI 配置
 * - 如果同时提供 aiConfig 和 getAiConfig，则进行合并
 * - getAiConfig 返回的配置优先级更高
 * - tools 数组进行合并
 */
const resolveAiConfig = async (): Promise<AiConfig> => {
  // 如果只有 getAiConfig，直接使用
  if (props.getAiConfig && !props.aiConfig) {
    return await props.getAiConfig();
  }

  // 如果只有 aiConfig，直接使用
  if (props.aiConfig && !props.getAiConfig) {
    return props.aiConfig;
  }

  // 如果两者都有，进行合并
  if (props.aiConfig && props.getAiConfig) {
    const dynamicConfig = await props.getAiConfig();
    return mergeAiConfig(props.aiConfig, dynamicConfig);
  }

  throw new Error('需要提供 aiConfig 或 getAiConfig');
};

/**
 * 构建最终的 prompt
 * 将 template 中所有 {key} 形式的占位符替换为 businessData map 中对应的值
 */
const buildFinalPrompt = async (config: AiConfig): Promise<string> => {
  const template = config.promptTemplate;

  if (props.getBusinessData) {
    const dataMap = await props.getBusinessData();
    // 替换 template 中所有 {key} 占位符
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(dataMap, key) ? dataMap[key] : match;
    });
  }

  return template;
};

// 点击按钮：获取配置和数据后展示确认弹窗
const handleClick = async () => {
  isLoading.value = true;
  try {
    // 获取 AI 配置
    const config = await resolveAiConfig();
    resolvedAiConfig.value = config;

    // 构建最终的 prompt
    renderedPrompt.value = await buildFinalPrompt(config);
    showConfirmDialog.value = true;
  } catch (error) {
    console.error('获取配置/数据失败:', error);
    message.error(`获取配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    isLoading.value = false;
  }
};

// 确认提交：调用 Wegent API 创建任务
const handleConfirmSubmit = async () => {
  if (!resolvedAiConfig.value) {
    message.error('AI 配置未加载');
    return;
  }

  isSubmitting.value = true;
  try {
    const wegentApi = await createWegentApiService();
    if (!wegentApi) {
      message.error('Wegent API 未配置，请先在登录页面配置');
      return;
    }

    const requestBody = {
      model: resolvedAiConfig.value.model,
      input: renderedPrompt.value,
      stream: false,
      ...(resolvedAiConfig.value.tools && resolvedAiConfig.value.tools.length > 0
        ? { tools: resolvedAiConfig.value.tools }
        : {}),
    };

    message.info('正在创建 AI 任务...');
    const apiResponse = await wegentApi.createResponse(requestBody);

    const wegentBaseUrl = (wegentApi as any)['baseUrl'];
    const taskId = apiResponse.id.replace('resp_', '');
    const chatUrl = `${wegentBaseUrl}/chat?taskId=${taskId}`;

    message.success('AI 任务已创建！');
    console.log('任务已创建，ID:', apiResponse.id);
    console.log('任务链接:', chatUrl);

    await browser.tabs.create({ url: chatUrl });
    showConfirmDialog.value = false;
  } catch (error) {
    console.error('提交失败:', error);
    message.error(`提交失败: ${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div>
    <NButton
      type="primary"
      size="large"
      block
      :loading="isLoading"
      :disabled="isLoading"
      @click="handleClick"
    >
      {{ buttonLabel }}
    </NButton>

    <!-- 确认对话框 -->
    <NCard
      v-if="showConfirmDialog"
      title="确认提交"
      :bordered="true"
      size="medium"
      style="margin-top: 12px;"
    >
      <NSpace vertical :size="15">
        <NInput
          v-model:value="renderedPrompt"
          type="textarea"
          placeholder="请输入 prompt"
          :autosize="{ minRows: 3, maxRows: 6 }"
        />
        <NSpace :size="10">
          <NButton
            type="primary"
            :loading="isSubmitting"
            :disabled="isSubmitting"
            @click="handleConfirmSubmit"
          >
            {{ isSubmitting ? '提交中...' : '确认提交' }}
          </NButton>
          <NButton
            :disabled="isSubmitting"
            @click="showConfirmDialog = false"
          >
            取消
          </NButton>
        </NSpace>
      </NSpace>
    </NCard>
  </div>
</template>
