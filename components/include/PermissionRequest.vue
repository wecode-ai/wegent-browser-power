<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { NSpace, NText, NButton, useMessage } from 'naive-ui';

const props = defineProps<{
  domain: string;
}>();

const emit = defineEmits<{
  granted: [];
}>();

const message = useMessage();
const hasPermission = ref(false);

// 格式化显示域名（移除协议前缀和路径）
const displayDomain = computed(() => {
  try {
    if (props.domain.startsWith('http://') || props.domain.startsWith('https://')) {
      return new URL(props.domain).hostname;
    }
    return props.domain;
  } catch {
    return props.domain;
  }
});

// 检查是否已有权限
const checkPermission = async () => {
  if (!props.domain) return;

  try {
    const domain = displayDomain.value;
    hasPermission.value = await browser.permissions.contains({
      origins: [`https://${domain}/*`]
    });
  } catch (error) {
    console.error('检查权限失败:', error);
    hasPermission.value = false;
  }
};

// 处理授权按钮点击
const handleGrant = async () => {
  try {
    const domain = displayDomain.value;

    message.info('正在请求访问权限...');

    // 请求权限（必须在用户手势中调用）
    const granted = await browser.permissions.request({
      origins: [`https://${domain}/*`, `http://${domain}/*`]
    });

    if (granted) {
      message.success('授权成功');
      hasPermission.value = true;
      emit('granted');
    } else {
      message.error('需要授权才能继续');
    }
  } catch (error) {
    console.error('请求权限失败:', error);
    message.error('请求权限失败');
  }
};

onMounted(() => {
  checkPermission();
});
</script>

<template>
  <!-- 已授权：显示插槽内容 -->
  <slot v-if="hasPermission" />

  <!-- 未授权：显示授权界面 -->
  <NSpace v-else vertical :size="12">
    <NSpace vertical :size="4">
      <NText>需要授权才能访问</NText>
      <NText type="info" strong>{{ displayDomain }}</NText>
    </NSpace>
    <NButton type="primary" @click="handleGrant">
      同意授权
    </NButton>
  </NSpace>
</template>
