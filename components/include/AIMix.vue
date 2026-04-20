<script lang="ts" setup>
import AIAction from './AIAction.vue';
import AIInput from './AIInput.vue';
import type { ToolConfig } from '../../services/wegentApi';

export interface AiConfig {
  /** prompt 模板，支持 {content} 占位符 */
  promptTemplate: string;
  /** 模型名称 */
  model?: string;
  /** 工具配置列表 */
  tools?: ToolConfig[];
}

export interface AIMixActionItem {
  /** 操作类型: 'action' - 按钮/提交模式, 'input' - 对话/编码模式 */
  type: 'action' | 'input';
  /** AI 静态配置 */
  aiConfig?: AiConfig;
  /**
   * 动态获取 AI 配置的方法
   * - 可单独使用，或与 aiConfig 组合使用
   * - 组合时：getAiConfig 返回的配置优先级更高，tools 数组会合并
   */
  getAiConfig?: () => Promise<Partial<AiConfig>>;
  /** 按钮标签（仅 type='action' 时生效） */
  buttonLabel?: string;
}

interface Props {
  /** AI 操作配置数组 */
  actions: AIMixActionItem[];
  /** 获取业务数据的回调函数，返回 key-value map，key 对应 prompt 中的变量名 */
  getBusinessData?: () => Promise<Record<string, string>>;
}

const props = defineProps<Props>();
</script>

<template>
  <div class="ai-mix-container">
    <template v-for="(action, index) in actions" :key="index">
      <AIAction
        v-if="action.type === 'action'"
        :button-label="action.buttonLabel"
        :ai-config="action.aiConfig"
        :get-ai-config="action.getAiConfig"
        :get-business-data="getBusinessData"
      />
      <AIInput
        v-else-if="action.type === 'input'"
        :ai-config="action.aiConfig"
        :get-business-data="getBusinessData"
      />
    </template>
  </div>
</template>

<style scoped>
.ai-mix-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
