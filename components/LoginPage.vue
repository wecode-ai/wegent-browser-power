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
  useDialog
} from 'naive-ui';
import { getConfig, saveConfig } from '@/services/config';

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

// 自动配置函数
const handleAutoConfig = async () => {
  if (isAutoConfiguring.value) return;

  // 如果不是 wegent 域名，弹层提示
  if (!isWegentDomain.value) {
    dialog.warning({
      title: '提示',
      content: '请切换到 wegent.* 域名的页面后再使用自动配置功能',
      positiveText: '确定'
    });
    return;
  }

  isAutoConfiguring.value = true;
  message.value = '正在自动配置...';
  
  try {
    // 获取当前标签页
    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!currentTab?.url) {
      throw new Error('无法获取当前标签页');
    }
    
    const urlObj = new URL(currentTab.url);
    const domain = urlObj.hostname;
    
    console.log('检查域名权限:', domain);
    
    // 检查是否已有权限
    const hasPermission = await browser.permissions.contains({
      origins: [`https://${domain}/*`]
    });
    
    if (!hasPermission) {
      console.log('请求域名权限:', domain);
      message.value = '正在请求权限...';
      
      // 请求权限（必须在用户手势中调用）
      const granted = await browser.permissions.request({
        origins: [`https://${domain}/*`, `http://${domain}/*`]
      });
      
      if (!granted) {
        throw new Error('用户拒绝了权限请求');
      }
      
      console.log('权限请求成功');
    }
    
    console.log('发送自动配置请求到 background script');
    
    // 发送消息到 background script 执行自动配置
    const response = await browser.runtime.sendMessage({
      action: 'autoConfig',
      url: currentTab.url
    }) as { success: boolean; apiKey?: string; error?: string };
    
    if (response.success && response.apiKey) {
      // 自动配置成功
      url.value = `${new URL(currentTab.url).protocol}//${new URL(currentTab.url).host}`;
      apiKey.value = response.apiKey;
      message.value = '自动配置成功！';
      
      // 通知父组件登录成功
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

            <NText
              v-if="isWegentDomain && !hasDomainPermission"
              type="tertiary"
              size="small"
              style="display: block; text-align: center;"
            >
              自动配置需授权。授权后，回来重新点击 [自动配置]
            </NText>
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

