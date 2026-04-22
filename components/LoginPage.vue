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
} from 'naive-ui';
import { getConfig, saveConfig, saveSubscriptionUrl } from '@/services/config';

const url = ref('');
const apiKey = ref('');
const message = ref('');
const currentHostname = ref('');
const isAutoConfiguring = ref(false);
const hasDomainPermission = ref(false);
// 控制"如何使用自动配置"内联提示的显示
const showAutoConfigHint = ref(false);

const emit = defineEmits<{
  loginSuccess: []
}>();

// 检查当前域名是否以 wegent. 开头
const isWegentDomain = computed(() => {
  return currentHostname.value.startsWith('wegent.');
});

// 获取当前标签页的域名
const getCurrentHostname = async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab.url) {
      const urlObj = new URL(tab.url);
      currentHostname.value = urlObj.hostname;
      // 检查域名权限状态
      await checkDomainPermission(urlObj.hostname);
    }
  } catch (error) {
    console.error('获取当前域名失败:', error);
  }
};

// 检查域名权限状态
const checkDomainPermission = async (domain: string) => {
  try {
    const hasPermission = await browser.permissions.contains({
      origins: [`https://${domain}/*`]
    });
    hasDomainPermission.value = hasPermission;
  } catch (error) {
    console.error('检查权限失败:', error);
    hasDomainPermission.value = false;
  }
};

/**
 * 检查并请求指定 origin 的权限。
 * 必须在用户手势上下文中调用（Chrome 扩展 popup 保持手势上下文足够长）。
 * @returns true 表示已拥有或成功授权，false 表示被拒绝
 */
const ensurePermission = async (origin: string): Promise<boolean> => {
  const hasPermission = await browser.permissions.contains({ origins: [origin] });
  if (hasPermission) return true;
  return browser.permissions.request({ origins: [origin] });
};

// 自动配置函数
const handleAutoConfig = async () => {
  if (isAutoConfiguring.value) return;

  const rawInput = url.value.trim();

  // ── 情况一：URL 输入框有内容，使用输入的地址执行自动配置 ──
  if (rawInput) {
    showAutoConfigHint.value = false;
    isAutoConfiguring.value = true;
    message.value = '正在自动配置...';

    try {
      // 用字符串分割处理 # 分隔符（new URL() 会把 # 后的内容当 hash 而非独立 URL）
      const hashIdx = rawInput.indexOf('#');
      const wegentRaw = hashIdx !== -1 ? rawInput.slice(0, hashIdx) : rawInput;
      const subscriptionRaw = hashIdx !== -1 ? rawInput.slice(hashIdx + 1).trim() : '';

      // 校验 wegentUrl 合法性
      let wegentUrlObj: URL;
      try {
        wegentUrlObj = new URL(wegentRaw);
      } catch {
        throw new Error('URL 格式无效，请输入以 https:// 或 http:// 开头的地址');
      }
      if (!wegentUrlObj.hostname.startsWith('wegent.')) {
        throw new Error('请输入 wegent.* 域名的地址（例如 https://wegent.xxx.com）');
      }

      // ── 步骤①：处理订阅 URL（如果 # 后有内容）──
      if (subscriptionRaw) {
        let subUrlObj: URL;
        try {
          subUrlObj = new URL(subscriptionRaw);
        } catch {
          throw new Error('# 后面的订阅 URL 格式无效，请检查后重试');
        }
        if (subUrlObj.protocol !== 'http:' && subUrlObj.protocol !== 'https:') {
          throw new Error('订阅 URL 仅支持 http 或 https 协议');
        }

        // 请求订阅 URL 所在域名的权限
        message.value = '正在请求订阅 URL 访问权限...';
        const subOrigin = `${subUrlObj.protocol}//${subUrlObj.host}/*`;
        const subGranted = await ensurePermission(subOrigin);
        if (!subGranted) {
          // 与 OptionsPage 行为一致：拒绝权限时警告但不中断主流程
          message.value = '已拒绝订阅 URL 访问权限，跳过订阅配置，继续执行自动配置...';
          await new Promise(r => setTimeout(r, 1200));
        } else {
          // 保存订阅 URL 并立即拉取
          await saveSubscriptionUrl(subscriptionRaw);
          message.value = '正在拉取订阅配置...';
          const fetchResp = await browser.runtime.sendMessage({
            action: 'fetchSubscription',
            url: subscriptionRaw,
          }) as { success: boolean; error?: string };
          if (!fetchResp?.success) {
            console.warn('订阅配置拉取失败:', fetchResp?.error);
          }
        }
      }

      // ── 步骤②：请求 wegent 域名权限 ──
      const wegentOrigin = `${wegentUrlObj.protocol}//${wegentUrlObj.host}/*`;
      message.value = '正在请求 wegent 域名访问权限...';
      const wegentGranted = await ensurePermission(wegentOrigin);
      if (!wegentGranted) {
        throw new Error('用户拒绝了 wegent 域名的访问权限');
      }

      // ── 步骤③：发送自动配置消息到 background ──
      const wegentUrl = `${wegentUrlObj.protocol}//${wegentUrlObj.host}`;
      message.value = '正在自动配置...';
      const response = await browser.runtime.sendMessage({
        action: 'autoConfig',
        url: wegentUrl,
      }) as { success: boolean; apiKey?: string; error?: string };

      if (response.success && response.apiKey) {
        // 回写表单（去掉 # 后内容，保持 URL 字段干净）
        url.value = wegentUrl;
        apiKey.value = response.apiKey;
        message.value = '自动配置成功！';
        emit('loginSuccess');
      } else {
        throw new Error(response.error || '自动配置失败');
      }

    } catch (error) {
      message.value = '自动配置失败：' + (error as Error).message;
      console.error('自动配置错误:', error);
    } finally {
      isAutoConfiguring.value = false;
    }
    return;
  }

  // ── 情况二：URL 为空，依赖当前 Tab 所在域名 ──
  if (!isWegentDomain.value) {
    // 不在 wegent.* 域名下，显示内联引导提示
    showAutoConfigHint.value = true;
    return;
  }

  // 当前 Tab 在 wegent.* 域名，走原有逻辑
  showAutoConfigHint.value = false;
  isAutoConfiguring.value = true;
  message.value = '正在自动配置...';

  try {
    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!currentTab?.url) {
      throw new Error('无法获取当前标签页');
    }

    const urlObj = new URL(currentTab.url);
    const domain = urlObj.hostname;

    message.value = '正在请求访问权限...';
    const origin = `https://${domain}/*`;
    const granted = await ensurePermission(origin);
    if (!granted) {
      throw new Error('用户拒绝了权限请求');
    }

    message.value = '正在自动配置...';
    const response = await browser.runtime.sendMessage({
      action: 'autoConfig',
      url: currentTab.url,
    }) as { success: boolean; apiKey?: string; error?: string };

    if (response.success && response.apiKey) {
      url.value = `${urlObj.protocol}//${urlObj.host}`;
      apiKey.value = response.apiKey;
      message.value = '自动配置成功！';
      emit('loginSuccess');
    } else {
      throw new Error(response.error || '自动配置失败');
    }

  } catch (error) {
    message.value = '自动配置失败：' + (error as Error).message;
    console.error('自动配置错误:', error);
  } finally {
    isAutoConfiguring.value = false;
  }
};

const handleSubmit = async () => {
  if (!url.value || !apiKey.value) {
    message.value = '请填写所有字段';
    return;
  }

  try {
    await saveConfig({
      wegent_url: url.value,
      wegent_api_key: apiKey.value
    });
    message.value = '保存成功！';

    // 通知父组件登录成功
    emit('loginSuccess');

    url.value = '';
    apiKey.value = '';
  } catch (error) {
    message.value = '保存失败：' + error;
  }
};

// 打开高级设置页面
const handleOpenSettings = () => {
  browser.runtime.openOptionsPage();
};

onMounted(async () => {
  getCurrentHostname();

  // 从本地存储读取配置并填充到表单
  try {
    const config = await getConfig();
    if (config.wegent_url) {
      url.value = config.wegent_url;
    }
    if (config.wegent_api_key) {
      apiKey.value = config.wegent_api_key;
    }
  } catch (error) {
    console.error('读取本地存储失败:', error);
  }
});
</script>

<template>
  <div class="login-container">
    <NCard title="登录配置" :bordered="false" size="large">
      <NSpace vertical :size="12">
        <NForm @submit.prevent="handleSubmit">
          <NSpace vertical :size="8">
            <NFormItem label="URL" required>
              <NInput
                v-model:value="url"
                placeholder="请输入 URL"
                size="large"
              />
            </NFormItem>
            
            <NFormItem label="API KEY" required>
              <NInput
                v-model:value="apiKey"
                type="password"
                placeholder="请输入 API KEY"
                show-password-on="click"
                size="large"
              />
            </NFormItem>
            
            <NButton
              type="primary"
              size="large"
              block
              @click="handleSubmit"
            >
              保存
            </NButton>

            <!-- 自动配置前置引导提示：URL 为空且不在 wegent.* 域名时展示 -->
            <NAlert
              v-if="showAutoConfigHint"
              type="info"
              :bordered="false"
              closable
              style="font-size: 13px;"
              @close="showAutoConfigHint = false"
            >
              <template #header>
                <NText strong>使用「自动配置」，请先完成以下任一操作：</NText>
              </template>
              <ol style="margin: 6px 0 2px; padding-left: 18px; line-height: 2;">
                <li>
                  在上方 <NText strong>URL</NText> 输入框填写 wegent 应用地址，然后重新点击「自动配置」
                  <NText depth="3" style="display: block; font-size: 12px; line-height: 1.6;">
                    例如：https://wegent.xxx.com
                  </NText>
                </li>
                <li>
                  在浏览器地址栏打开 wegent 应用页面，然后重新点击「自动配置」
                  <NText depth="3" style="display: block; font-size: 12px; line-height: 1.6;">
                    在地址栏访问您的 wegent 应用网址即可
                  </NText>
                </li>
              </ol>
            </NAlert>

            <!-- 在 wegent.* 域名但未授权时的提示 -->
            <NText
              v-if="isWegentDomain && !hasDomainPermission"
              type="tertiary"
              size="small"
              style="display: block; text-align: center;"
            >
              自动配置需授权。授权后，回来重新点击 [自动配置]
            </NText>

            <div style="display: flex; gap: 8px;">
              <NButton
                secondary
                type="info"
                size="large"
                style="flex: 1;"
                :loading="isAutoConfiguring"
                :disabled="isAutoConfiguring"
                @click="handleAutoConfig"
              >
                {{ isAutoConfiguring ? '配置中...' : '自动配置' }}
              </NButton>

              <NButton
                secondary
                size="large"
                style="flex: 1;"
                @click="handleOpenSettings"
              >
                高级设置
              </NButton>
            </div>
          </NSpace>
        </NForm>
        
        <NAlert
          v-if="message"
          :type="message.includes('成功') ? 'success' : 'error'"
          :title="message"
        />
      </NSpace>
    </NCard>
  </div>
</template>

