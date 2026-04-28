<script lang="ts" setup>
import { h, ref, computed, onMounted } from 'vue';
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NSpace,
  NAlert,
  NText,
  useDialog,
} from 'naive-ui';
import {
  getConfig,
  saveConfig,
  saveSubscriptionUrl,
  PENDING_AUTO_CONFIG_KEY,
  type PendingAutoConfig,
} from '@/services/config';

const dialog = useDialog();

const url = ref('');
const apiKey = ref('');
const message = ref('');
const currentHostname = ref('');
const isAutoConfiguring = ref(false);
const hasDomainPermission = ref(false);

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
    // 用字符串分割处理 # 分隔符（new URL() 会把 # 后的内容当 hash 而非独立 URL）
    const hashIdx = rawInput.indexOf('#');
    const wegentRaw = hashIdx !== -1 ? rawInput.slice(0, hashIdx) : rawInput;
    const subscriptionRaw = hashIdx !== -1 ? rawInput.slice(hashIdx + 1).trim() : '';

    // ── 前置同步校验（不启动 loading，保持 UX 轻量）──
    let wegentUrlObj: URL;
    try {
      wegentUrlObj = new URL(wegentRaw);
    } catch {
      message.value = '自动配置失败：URL 格式无效，请输入以 https:// 或 http:// 开头的地址';
      return;
    }
    if (!wegentUrlObj.hostname.startsWith('wegent.')) {
      message.value = '自动配置失败：请输入 wegent.* 域名的地址（例如 https://wegent.xxx.com）';
      return;
    }

    // 当前 Tab 已在 wegent.* 域名时，禁止与输入地址不一致的操作
    if (isWegentDomain.value && wegentUrlObj.hostname !== currentHostname.value) {
      dialog.warning({
        title: '域名不一致',
        content: () => h('div', { style: 'line-height: 1.8; font-size: 13px;' }, [
          h('p', { style: 'margin: 0 0 6px;' }, [
            '当前浏览器页面已打开 ',
            h('strong', null, currentHostname.value),
            '，与您输入的 ',
            h('strong', null, wegentUrlObj.hostname),
            ' 不一致。',
          ]),
          h('p', { style: 'margin: 0; color: #666;' },
            '请修改输入地址与当前页面保持一致，或关闭当前 wegent 页面后再重试。'
          ),
        ]),
        positiveText: '知道了',
      });
      return;
    }

    // ── 异步操作阶段，启动 loading ──
    isAutoConfiguring.value = true;
    message.value = '正在自动配置...';

    try {
      const wegentOrigin = `${wegentUrlObj.protocol}//${wegentUrlObj.host}/*`;

      // ── 步骤①：解析订阅 URL（如果 # 后有内容），收集所需权限 ──
      // 先解析订阅URL对象，以便后续判断是否与wegent同域
      let subUrlObj: URL | null = null;
      let subOrigin = '';
      if (subscriptionRaw) {
        try {
          subUrlObj = new URL(subscriptionRaw);
        } catch {
          throw new Error('# 后面的订阅 URL 格式无效，请检查后重试');
        }
        if (subUrlObj.protocol !== 'http:' && subUrlObj.protocol !== 'https:') {
          throw new Error('订阅 URL 仅支持 http 或 https 协议');
        }
        subOrigin = `${subUrlObj.protocol}//${subUrlObj.host}/*`;
      }

      // ── 步骤②：一次性批量申请所有缺失权限 ──
      // 收集尚未授权的 origin，两个域名不同时合并进同一个 permissions.request 调用
      const missingOrigins: string[] = [];
      const wegentAlreadyGranted = await browser.permissions.contains({ origins: [wegentOrigin] });
      if (!wegentAlreadyGranted) missingOrigins.push(wegentOrigin);

      let subAlreadyGranted = true;
      if (subOrigin && subOrigin !== wegentOrigin) {
        subAlreadyGranted = await browser.permissions.contains({ origins: [subOrigin] });
        if (!subAlreadyGranted) missingOrigins.push(subOrigin);
      }

      if (missingOrigins.length > 0) {
        message.value = missingOrigins.length > 1
          ? `正在请求访问权限（${missingOrigins.length} 个域名）...`
          : '正在请求访问权限...';

        // 在调用 permissions.request() 前写入挂起状态。
        // 若授权弹框导致 popup 关闭，background 的 permissions.onAdded 监听器会在
        // 300ms 后读取此状态并接力执行；若 popup 存活，finally 块会先清除它。
        await browser.storage.session.set({
          [PENDING_AUTO_CONFIG_KEY]: {
            wegentUrl: `${wegentUrlObj.protocol}//${wegentUrlObj.host}`,
            subscriptionUrl: subscriptionRaw,
            timestamp: Date.now(),
          } as PendingAutoConfig,
        });

        let granted: boolean;
        try {
          granted = await browser.permissions.request({ origins: missingOrigins });
        } finally {
          // popup 执行到此说明仍存活，清除挂起状态以防 background 重复执行
          await browser.storage.session.remove(PENDING_AUTO_CONFIG_KEY);
        }

        if (!granted) {
          if (!wegentAlreadyGranted) {
            // wegent 域名权限被拒，无法继续
            throw new Error('用户拒绝了 wegent 域名的访问权限');
          }
          // 仅订阅 URL 权限被拒：非致命，跳过订阅，继续自动配置
          message.value = '已拒绝订阅 URL 访问权限，跳过订阅配置，继续执行自动配置...';
          await new Promise(r => setTimeout(r, 1200));
          subUrlObj = null;
        }
      }

      // ── 步骤③：拉取订阅配置（如果订阅 URL 有效且权限已获取）──
      if (subUrlObj) {
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

      // ── 步骤④：发送自动配置消息到 background ──
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
    // 不在 wegent.* 域名下，弹出引导对话框
    dialog.info({
      title: '如何使用自动配置',
      content: () => h('div', { style: 'font-size: 13px; line-height: 1.8;' }, [
        h('p', { style: 'margin: 0 0 8px;' }, '满足以下任一条件即可：'),
        h('ol', { style: 'margin: 0; padding-left: 18px;' }, [
          h('li', null, [
            '在上方 ', h('strong', null, 'URL'), ' 输入框填写 wegent 应用地址，然后重新点击「自动配置」',
            h('p', { style: 'font-size: 12px; color: #999; margin: 2px 0 6px;' }, '例如：https://wegent.xxx.com'),
          ]),
          h('li', null, [
            '在浏览器地址栏打开 wegent 应用页面，然后重新点击「自动配置」',
            h('p', { style: 'font-size: 12px; color: #999; margin: 2px 0 0;' }, '在地址栏访问您的 wegent 应用网址即可'),
          ]),
        ]),
      ]),
      positiveText: '知道了',
    });
    return;
  }

  // 当前 Tab 在 wegent.* 域名，走原有逻辑
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

