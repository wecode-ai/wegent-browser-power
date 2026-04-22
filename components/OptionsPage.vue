<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NSpace,
  NAlert,
  NText,
  NDivider,
  NRadioGroup,
  NRadio,
  useMessage,
} from 'naive-ui';
import { getConfig, saveConfig, saveSubscriptionUrl, getSubscriptionUrl } from '@/services/config';
import {
  getAIMixConfig,
  importAIMixConfig,
  resetAIMixConfig,
  loadDefaultAIMixConfig,
  type AIMixConfig,
} from '@/services/config';

const message = useMessage();

// 原有配置
const url = ref('');
const apiKey = ref('');
const configMessage = ref('');

// 订阅 URL
const subscriptionUrl = ref('');
const subscriptionStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
const subscriptionError = ref('');

// AI Mix 配置
const aiMixJson = ref('');
const importMode = ref<'merge' | 'replace'>('merge');

// 当填写了订阅 URL 时，JSON 编辑器只读
const isAiMixReadonly = computed(() => !!subscriptionUrl.value.trim());

// 加载配置
const loadConfig = async () => {
  // 加载原有配置
  const config = await getConfig();
  url.value = config.wegent_url || '';
  apiKey.value = config.wegent_api_key || '';

  // 加载订阅 URL
  subscriptionUrl.value = await getSubscriptionUrl();

  // 加载 AI Mix 配置（优先本地存储，无则加载默认配置）
  const aiMixConfig = await getAIMixConfig();
  aiMixJson.value = JSON.stringify(aiMixConfig, null, 2);
};

// 拉取订阅配置（通过 background script 绕过 CORS）
const fetchSubscription = async (subUrl: string): Promise<boolean> => {
  subscriptionStatus.value = 'loading';
  subscriptionError.value = '';
  try {
    const resp = await browser.runtime.sendMessage({
      action: 'fetchSubscription',
      url: subUrl,
    }) as { success: boolean; error?: string };
    if (!resp.success) {
      throw new Error(resp.error || '未知错误');
    }
    subscriptionStatus.value = 'success';
    // 重新加载 AI Mix 配置展示
    const aiMixConfig = await getAIMixConfig();
    aiMixJson.value = JSON.stringify(aiMixConfig, null, 2);
    return true;
  } catch (error) {
    subscriptionStatus.value = 'error';
    subscriptionError.value = (error as Error).message;
    return false;
  }
};

// 保存原有配置
const handleSubmit = async () => {
  if (!url.value || !apiKey.value) {
    configMessage.value = '请填写所有字段';
    return;
  }

  try {
    await saveConfig({
      wegent_url: url.value,
      wegent_api_key: apiKey.value
    });

    // 同步保存订阅 URL
    await saveSubscriptionUrl(subscriptionUrl.value.trim());

    configMessage.value = '保存成功';

    // 如果填写了订阅 URL，立即拉取一次
    const subUrl = subscriptionUrl.value.trim();
    if (subUrl) {
      const ok = await fetchSubscription(subUrl);
      if (ok) {
        message.success('订阅配置已更新');
      } else {
        message.error('订阅配置拉取失败: ' + subscriptionError.value);
      }
    }
  } catch (error) {
    configMessage.value = '保存失败' + error;
  }
};

// 导入 AI Mix 配置
const handleImport = async () => {
  try {
    const config = JSON.parse(aiMixJson.value) as Partial<AIMixConfig>;
    await importAIMixConfig(config, {
      merge: importMode.value === 'merge',
    });
    message.success('配置导入成功');
    await loadConfig();
  } catch (error) {
    message.error('导入失败: ' + error);
  }
};

// 重置为默认配置
const handleReset = async () => {
  try {
    await resetAIMixConfig();
    // 重新加载默认配置
    const defaultConfig = await loadDefaultAIMixConfig();
    aiMixJson.value = JSON.stringify(defaultConfig, null, 2);
    message.success('已重置为默认配置');
  } catch (error) {
    message.error('重置失败: ' + error);
  }
};

onMounted(loadConfig);
</script>

<template>
  <div class="options-container">
    <NCard :bordered="false" size="large">
      <NSpace vertical :size="20">
        <!-- 原有配置表单 -->
        <NForm @submit.prevent="handleSubmit" label-placement="left" label-width="80">
          <NSpace vertical :size="16">
            <NFormItem label="URL" required>
              <NInput
                v-model:value="url"
                placeholder="请输入URL"
                size="large"
              />
            </NFormItem>

            <NFormItem label="API KEY" required>
              <NInput
                v-model:value="apiKey"
                type="password"
                placeholder="请输入API KEY"
                show-password-on="click"
                size="large"
              />
            </NFormItem>

            <NFormItem label="订阅URL">
              <NInput
                v-model:value="subscriptionUrl"
                placeholder="可选，填写后 AI Mix 配置将由此 URL 远程管理（支持 http / https）"
                size="large"
                clearable
              />
            </NFormItem>

            <NButton
              type="primary"
              size="large"
              block
              @click="handleSubmit"
            >
              保存基础配置
            </NButton>
          </NSpace>
        </NForm>

        <NAlert
          v-if="configMessage"
          :type="configMessage.includes('成功') ? 'success' : 'error'"
          :title="configMessage"
        />

        <NDivider />

        <!-- AI Mix 配置管理 -->
        <NText strong>AI Mix 配置管理</NText>

        <!-- 订阅模式提示 -->
        <NAlert
          v-if="isAiMixReadonly"
          type="info"
          title="当前配置由订阅 URL 管理，不可手动编辑"
          :description="`订阅地址：${subscriptionUrl}`"
        />
        <NAlert
          v-if="subscriptionStatus === 'error'"
          type="error"
          :title="`订阅配置拉取失败：${subscriptionError}`"
        />

        <NSpace vertical :size="16">
          <!-- 非订阅模式才显示合并/替换选项 -->
          <NRadioGroup v-if="!isAiMixReadonly" v-model:value="importMode">
            <NSpace>
              <NRadio value="merge">合并（不影响其他配置）</NRadio>
              <NRadio value="replace">替换（完全覆盖）</NRadio>
            </NSpace>
          </NRadioGroup>

          <!-- JSON 编辑区 -->
          <NFormItem label="配置 JSON">
            <NInput
              v-model:value="aiMixJson"
              type="textarea"
              :rows="20"
              placeholder="AI Mix 配置 JSON"
              style="font-family: monospace;"
              :disabled="isAiMixReadonly"
            />
          </NFormItem>

          <!-- 非订阅模式才显示操作按钮 -->
          <NSpace v-if="!isAiMixReadonly">
            <NButton type="primary" @click="handleImport">保存</NButton>
            <NButton type="error" @click="handleReset">重置为默认</NButton>
          </NSpace>
        </NSpace>
      </NSpace>
    </NCard>
  </div>
</template>

<style scoped>
.options-container {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: #f5f5f5;
}

.options-container :deep(.n-card) {
  width: 100%;
  max-width: 800px;
}
</style>
