<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
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
  applySubscriptionData,
  AI_MIX_CONFIG_KEY,
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

// 订阅 URL 使用 http 时提示安全风险（用户仍可强制保存）
const isSubscriptionInsecure = computed(() =>
  subscriptionUrl.value.trim().toLowerCase().startsWith('http://')
);

/** AI Mix 帮助文档链接 */
const AI_MIX_HELP_URL = 'https://github.com/wecode-ai/wegent-browser-power/wiki/%E9%AB%98%E7%BA%A7%E4%BD%BF%E7%94%A8';

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

// 拉取订阅配置
// 直接在 Options 页面（扩展页）发起 fetch：
// permissions.request() 在此页面授权后立即生效，无需等待 Service Worker 同步权限
// 避免了 Chrome MV3 中权限刚授予但 Service Worker 尚未感知的竞态问题
const fetchSubscription = async (subUrl: string): Promise<boolean> => {
  subscriptionStatus.value = 'loading';
  subscriptionError.value = '';
  try {
    const response = await fetch(subUrl, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as AIMixConfig;
    // 简单校验：至少包含一个已知平台字段
    if (!data || (!data.dingTalk && !data.gitLab && !data.jira)) {
      throw new Error('订阅数据格式错误：缺少 dingTalk / gitLab / jira 字段');
    }
    await applySubscriptionData(data);
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

  // 同步提取订阅 URL（必须在任何 await 之前完成，保持用户手势上下文）
  const subUrl = subscriptionUrl.value.trim();

  // 若填写了订阅 URL，立即申请对应域名的访问权限
  // permissions.request() 必须是第一个 await，Chrome 才能识别用户手势并弹出授权弹框
  if (subUrl) {
    let origin: string;
    try {
      const urlObj = new URL(subUrl);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        configMessage.value = '订阅URL仅支持 http 或 https 协议';
        return;
      }
      origin = `${urlObj.protocol}//${urlObj.host}/*`;
    } catch {
      configMessage.value = '订阅URL格式无效，请检查后重试';
      return;
    }

    // ⚠️ 此处是整个函数的第一个 await，Chrome 的用户手势上下文仍然有效
    const granted = await browser.permissions.request({ origins: [origin] });
    if (!granted) {
      // 用户点了"拒绝"，提示但仍继续保存基础配置
      message.warning('已拒绝访问权限，订阅配置将无法拉取，基础配置仍会保存');
    }
  }

  try {
    await saveConfig({
      wegent_url: url.value,
      wegent_api_key: apiKey.value
    });

    // 同步保存订阅 URL
    await saveSubscriptionUrl(subUrl);

    configMessage.value = '保存成功';

    // 权限已申请，立即拉取一次订阅配置
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

// 监听 background onStartup 拉取后 storage 的变化
// 解决竞态：用户打开页面时 onStartup fetch 可能尚未完成，
// fetch 完成写入 storage 后，此监听器自动刷新 AI Mix 配置展示
const onStorageChanged = (
  changes: Record<string, browser.storage.StorageChange>,
  area: string
) => {
  if (area === 'local' && AI_MIX_CONFIG_KEY in changes) {
    getAIMixConfig().then(config => {
      aiMixJson.value = JSON.stringify(config, null, 2);
    });
  }
};

onMounted(() => {
  browser.storage.onChanged.addListener(onStorageChanged);
});

onUnmounted(() => {
  browser.storage.onChanged.removeListener(onStorageChanged);
});
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

            <!-- http 不安全提示：用户可忽略，仍可保存 -->
            <NAlert
              v-if="isSubscriptionInsecure"
              type="warning"
              title="订阅地址使用http，配置内容将通过未加密连接传输，存在安全风险！建议用https"
              description="建议将地址改为 https://，也可忽略此提示并直接保存。"
            />

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
        <NSpace align="center" :size="6">
          <NText strong>AI Mix 配置管理</NText>
          <a
            :href="AI_MIX_HELP_URL"
            target="_blank"
            rel="noopener noreferrer"
            title="查看帮助文档"
            class="help-icon"
          >?</a>
        </NSpace>

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

.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #2080f0;
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  text-decoration: none;
  line-height: 1;
  flex-shrink: 0;
}

.help-icon:hover {
  background-color: #4098fc;
}
</style>
