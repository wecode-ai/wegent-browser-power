<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NText, useMessage } from 'naive-ui';
import AIMix from './include/AIMix.vue';
import { getAIMixConfig } from '../services/config';
import type { AIMixActionItem } from '../services/config';

const message = useMessage();
const isDingTalkDoc = ref(false);

// AI 操作配置数组（动态加载）
const aiMixActions = ref<AIMixActionItem[]>([]);

// 加载 AI Mix 配置
const loadAIMixConfig = async () => {
  try {
    const config = await getAIMixConfig();
    aiMixActions.value = config.dingTalk.actions;
  } catch (error) {
    console.error('加载 AI Mix 配置失败:', error);
    aiMixActions.value = [];
  }
};

// 检查当前页面是否是钉钉文档页面
const checkDingTalkDoc = async () => {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url) {
      isDingTalkDoc.value = activeTab.url.includes('alidocs.dingtalk.com');
    }
  } catch (error) {
    console.error('Error checking DingTalk document:', error);
  }
};

/**
 * 显示错误提示
 */
const showError = (error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  message.error(errorMessage);
  console.error('钉钉文档操作失败:', error);
};

/**
 * 获取钉钉文档 Markdown 内容
 * 封装：触发导出 → 监听下载 → 读取文件内容
 * 返回对象，key 对应 prompt 模板中的变量名 {content}
 */
const getDingTalkMarkdown = (): Promise<Record<string, string>> => {
  return new Promise(async (resolve, reject) => {
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!activeTab || !activeTab.id) {
        const error = new Error('无法获取当前标签页');
        showError(error);
        reject(error);
        return;
      }

      // 获取当前页面域名用于验证下载来源
      const pageUrl = new URL(activeTab.url || 'https://alidocs.dingtalk.com');
      const pageOrigin = pageUrl.origin;

      // 监听下载
      browser.runtime.sendMessage({ action: 'waitForDingMarkdownDownload', origin: pageOrigin }, async (response) => {
        console.log('下载对象:', response);
        if (!response?.success || !response?.downloadItem?.finalUrl) {
          const error = new Error('未获取到下载文件');
          showError(error);
          reject(error);
          return;
        }

        try {
          const res = await fetch(response.downloadItem.finalUrl);

          if (!res.ok) {
            const error = new Error(`下载失败: ${res.status}`);
            showError(error);
            reject(error);
            return;
          }

          const blob = await res.blob();
          const text = await blob.text();
          console.log('Markdown 内容:', text);
          resolve({ content: text });
        } catch (error) {
          showError(error);
          reject(error);
        }
      });

      // 在页面中执行导出操作
      const [scriptResult] = await browser.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          return new Promise<void>((resolve, reject) => {
            const iframe = document.getElementById('wiki-doc-iframe') as HTMLIFrameElement;
            const targetDocument = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;

            const headerButton = targetDocument.querySelector('button[data-role="headerMoreMenu"]');
            if (!headerButton) {
              reject(new Error('未找到 headerMoreMenu 按钮'));
              return;
            }

            // 点击菜单按钮展开选项
            (headerButton as HTMLElement).click();

            let attempts = 0;
            const maxAttempts = 20;
            const interval = 500;

            const checkExportButton = () => {
              attempts++;
              const exportButton = targetDocument.querySelector('[data-role="operationBar_export"]');

              if (exportButton) {
                // 检测类名中是否包含以 -disabled 结尾的类名
                const classList = Array.from(exportButton.classList);
                const hasDisabledClass = classList.some(cls => cls.endsWith('-disabled'));

                if (hasDisabledClass) {
                  reject(new Error('您没有当前文档的下载权限，请联系文档所有者申请"可查看/可下载"权限'));
                  return;
                }

                // 有权限，继续导出流程
                const rect = (exportButton as HTMLElement).getBoundingClientRect();
                const events = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'];
                events.forEach(type => {
                  (exportButton as HTMLElement).dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    view: window,
                  }));
                });

                setTimeout(() => {
                  const exportMdButton = targetDocument.querySelector('[data-role="operationBar__export_exportAsMd"]');
                  if (exportMdButton) {
                    (exportMdButton as HTMLElement).click();
                    resolve();
                  } else {
                    reject(new Error('未找到导出为 Markdown 按钮'));
                  }
                }, 500);
              } else if (attempts >= maxAttempts) {
                reject(new Error('查找导出按钮超时，最多尝试20次'));
              } else {
                setTimeout(checkExportButton, interval);
              }
            };

            checkExportButton();
          });
        },
      });

      // 检查脚本执行结果 - 如果页面内 Promise reject，结果会包含异常信息
      if (scriptResult?.error) {
        const error = new Error(scriptResult.error.message || '页面脚本执行失败');
        showError(error);
        throw error;
      }
    } catch (error) {
      showError(error);
      reject(error);
    }
  });
};

onMounted(() => {
  checkDingTalkDoc();
  loadAIMixConfig();
});
</script>

<template>
  <div class="dingtalk-container">
    <NCard title="钉钉文档集成" :bordered="false" size="large">
      <NSpace vertical :size="20">
        <div v-if="isDingTalkDoc" class="dingtalk-doc-section">
          <!-- 使用 AIMix 组件统一管理 AI 操作 -->
          <AIMix
            :actions="aiMixActions"
            :get-business-data="getDingTalkMarkdown"
          />
        </div>

        <NText v-else depth="3">
          当前页面不是钉钉文档页面
        </NText>
      </NSpace>
    </NCard>
  </div>
</template>
