<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { NCard, NSpace, NText } from 'naive-ui';
import AIMix from './include/AIMix.vue';
import { getAIMixConfig } from '../services/config';
import type { AIMixActionItem } from '../services/config';

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
 * 获取钉钉文档 Markdown 内容
 * 封装：触发导出 → 监听下载 → 读取文件内容
 * 返回对象，key 对应 prompt 模板中的变量名 {content}
 */
const getDingTalkMarkdown = (): Promise<Record<string, string>> => {
  return new Promise(async (resolve, reject) => {
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!activeTab || !activeTab.id) {
        reject(new Error('无法获取当前标签页'));
        return;
      }

      // 获取当前页面域名用于验证下载来源
      const pageUrl = new URL(activeTab.url || 'https://alidocs.dingtalk.com');
      const pageOrigin = pageUrl.origin;

      // 监听下载
      browser.runtime.sendMessage({ action: 'waitForDingMarkdownDownload', origin: pageOrigin }, async (response) => {
        console.log('下载对象:', response);
        if (!response?.success || !response?.downloadItem?.finalUrl) {
          reject(new Error('未获取到下载文件'));
          return;
        }

        try {
          const res = await fetch(response.downloadItem.finalUrl);

          if (!res.ok) {
            reject(new Error(`下载失败: ${res.status}`));
            return;
          }

          const blob = await res.blob();
          const text = await blob.text();
          console.log('Markdown 内容:', text);
          resolve({ content: text });
        } catch (error) {
          reject(error);
        }
      });

      // 在页面中执行导出操作
      let scriptResult;
      try {
        [scriptResult] = await browser.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            return new Promise<{ success: boolean; error?: string }>((resolve) => {
              const iframe = document.getElementById('wiki-doc-iframe') as HTMLIFrameElement;
              const targetDocument = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;

              // 处理导出按钮的函数
              const handleExportButton = (exportButton: HTMLElement) => {
                // 检测类名中是否包含以 -disabled 结尾的类名
                const classList = Array.from(exportButton.classList);
                const hasDisabledClass = classList.some(cls => cls.endsWith('-disabled'));

                if (hasDisabledClass) {
                  resolve({ success: false, error: '您没有当前文档的下载权限，请联系文档所有者申请"可查看/可下载"权限' });
                  return;
                }

                // 有权限，继续导出流程
                const rect = exportButton.getBoundingClientRect();
                const events = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'];
                events.forEach(type => {
                  exportButton.dispatchEvent(new PointerEvent(type, {
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
                    resolve({ success: true });
                  } else {
                    resolve({ success: false, error: '未找到导出为 Markdown 按钮' });
                  }
                }, 500);
              };

              // 先检查导出按钮是否已可见（菜单已打开）
              const existingExportButton = targetDocument.querySelector('[data-role="operationBar_export"]') as HTMLElement;
              if (existingExportButton) {
                // 菜单已打开，直接处理
                handleExportButton(existingExportButton);
                return;
              }

              const headerButton = targetDocument.querySelector('button[data-role="headerMoreMenu"]');
              if (!headerButton) {
                resolve({ success: false, error: '未找到 headerMoreMenu 按钮' });
                return;
              }

              // 点击菜单按钮展开选项
              (headerButton as HTMLElement).click();

              let attempts = 0;
              const maxAttempts = 20;
              const interval = 500;

              const checkExportButton = () => {
                attempts++;
                const exportButton = targetDocument.querySelector('[data-role="operationBar_export"]') as HTMLElement;

                if (exportButton) {
                  handleExportButton(exportButton);
                } else if (attempts >= maxAttempts) {
                  resolve({ success: false, error: '查找导出按钮超时，最多尝试20次' });
                } else {
                  setTimeout(checkExportButton, interval);
                }
              };

              checkExportButton();
            });
          },
        });
      } catch (execError) {
        // executeScript 本身抛出异常
        const errorMessage = execError instanceof Error ? execError.message : String(execError);
        throw new Error(`脚本执行异常: ${errorMessage}`);
      }

      // 检查脚本执行结果
      if (!scriptResult?.result?.success) {
        const errorMessage = scriptResult?.result?.error || '页面脚本执行失败';
        throw new Error(errorMessage);
      }
    } catch (error) {
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
