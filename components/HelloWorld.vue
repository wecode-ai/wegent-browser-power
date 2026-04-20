<script lang="ts" setup>
import { ref } from 'vue';
import { NButton, NCard, NSpace, NText, NStatistic } from 'naive-ui';

defineProps({
  msg: String,
});

const count = ref(0);
</script>

<template>
  <div class="hello-world">
    <NCard title="Welcome" :bordered="false" size="large">
      <NSpace vertical :size="20">
        <NText tag="h1" style="font-size: 24px; font-weight: bold;">
          {{ msg }}
        </NText>

        <NCard size="small" :bordered="true">
          <NSpace vertical :size="16" align="center">
            <NStatistic label="计数" :value="count" />
            <NButton type="primary" @click="count++">
              点击增加计数
            </NButton>
          </NSpace>
        </NCard>

        <NText depth="3">
          编辑 <code>components/HelloWorld.vue</code> 来测试 HMR
        </NText>

        <NText depth="2">
          在你的 IDE 中安装
          <a href="https://github.com/vuejs/language-tools" target="_blank" style="color: #18a058;">Volar</a>
          以获得更好的开发体验
        </NText>

        <NText depth="3" class="read-the-docs">
          点击 WXT 和 Vue 标志了解更多信息
        </NText>
      </NSpace>
    </NCard>
  </div>
</template>

