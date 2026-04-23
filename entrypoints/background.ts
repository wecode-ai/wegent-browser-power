import {
  saveConfig,
  saveSubscriptionUrl,
  getSubscriptionUrl,
  applySubscriptionData,
  type AIMixConfig,
  PENDING_AUTO_CONFIG_KEY,
  PENDING_AUTO_CONFIG_EXPIRY_MS,
  type PendingAutoConfig,
} from '@/services/config';

/** 订阅配置定时轮询的 Alarm 名称 */
const SUBSCRIPTION_ALARM_NAME = 'subscription-config-sync';

/** 轮询间隔（分钟），6 小时 */
const SUBSCRIPTION_ALARM_INTERVAL_MINUTES = 6 * 60;

export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  // 注册/恢复定时轮询 Alarm
  // Alarm 在 Service Worker 休眠期间由系统维护，唤醒后自动触发
  const ensureAlarm = async () => {
    const existing = await browser.alarms.get(SUBSCRIPTION_ALARM_NAME);
    if (!existing) {
      browser.alarms.create(SUBSCRIPTION_ALARM_NAME, {
        periodInMinutes: SUBSCRIPTION_ALARM_INTERVAL_MINUTES,
      });
      console.log(`订阅轮询 Alarm 已注册，间隔 ${SUBSCRIPTION_ALARM_INTERVAL_MINUTES} 分钟`);
    }
  };

  // 监听扩展安装或更新事件
  browser.runtime.onInstalled.addListener(() => {
    console.log('Extension installed or updated');
    ensureAlarm();
    // 安装/更新时立即拉取一次，确保第一次使用即最新配置
    fetchSubscriptionConfig().catch(err =>
      console.error('安装/更新时拉取订阅配置失败:', err)
    );
  });

  // 监听扩展启动事件
  browser.runtime.onStartup.addListener(() => {
    console.log('Extension started');
    ensureAlarm();
    // 浏览器启动时自动拉取订阅配置
    fetchSubscriptionConfig().catch(err =>
      console.error('启动时拉取订阅配置失败:', err)
    );
  });

  // 监听定时 Alarm，触发订阅配置轮询
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SUBSCRIPTION_ALARM_NAME) {
      console.log('定时轮询触发，开始拉取订阅配置');
      fetchSubscriptionConfig().catch(err =>
        console.error('定时轮询拉取订阅配置失败:', err)
      );
    }
  });

  // 监听权限授予事件：在 popup 因授权弹框关闭时接力执行挂起的自动配置任务
  // 延迟 300ms 读取：若 popup 仍存活，其 finally 块会先清除挂起任务；
  // 若 popup 已关闭，300ms 后挂起任务依然存在，background 接力执行。
  browser.permissions.onAdded.addListener(() => {
    setTimeout(() => {
      resumePendingAutoConfig().catch(err =>
        console.error('接力执行自动配置失败:', err)
      );
    }, 300);
  });

  // 监听来自 popup 的消息
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 验证发送者是扩展自身，防止恶意内容脚本或第三方扩展发送伪造消息
    if (sender.id !== browser.runtime.id) {
      console.warn('拒绝未知来源的消息:', sender);
      sendResponse({ success: false, error: 'Invalid sender' });
      return false;
    }

    // 自动配置事件
    if (message.action === 'autoConfig') {
      handleAutoConfig(message.url).then(sendResponse);
      return true; // 保持消息通道开放以支持异步响应
    }

    // 拉取订阅 URL 并更新 AI Mix 配置
    if (message.action === 'fetchSubscription') {
      handleFetchSubscription(message.url).then(sendResponse);
      return true;
    }

    // 启动钉钉Markdown下载监听事件
    if (message.action === 'waitForDingMarkdownDownload') {
      handleDingMarkdownDownload(message.origin).then(sendResponse);
      return true; // 保持消息通道开放以支持异步响应
    }

    // 打开页面并填充输入框
    if (message.action === 'openAndFillInput') {
      handleOpenAndFillInput(message.url, message.content).then(sendResponse);
      return true; // 保持消息通道开放以支持异步响应
    }
  });

  // 接力执行因 popup 关闭而中断的自动配置任务
  // 由 permissions.onAdded 触发，读取 storage.session 中的挂起任务并执行
  async function resumePendingAutoConfig() {
    const data = await browser.storage.session.get(PENDING_AUTO_CONFIG_KEY) as {
      [PENDING_AUTO_CONFIG_KEY]?: PendingAutoConfig;
    };
    const pending = data[PENDING_AUTO_CONFIG_KEY];

    if (!pending) {
      // popup 仍存活且已清除挂起任务，无需接力
      console.log('无挂起的自动配置任务（popup 已自行处理）');
      return;
    }

    // 过期校验：超过 5 分钟视为用户已取消，不再执行
    if (Date.now() - pending.timestamp > PENDING_AUTO_CONFIG_EXPIRY_MS) {
      console.warn('挂起的自动配置任务已过期，清除');
      await browser.storage.session.remove(PENDING_AUTO_CONFIG_KEY);
      return;
    }

    // 立即清除，防止 onAdded 多次触发时重复执行
    await browser.storage.session.remove(PENDING_AUTO_CONFIG_KEY);

    const { wegentUrl, subscriptionUrl } = pending;
    console.log('接力执行自动配置，目标:', wegentUrl);

    // 验证 wegent 域名权限是否确实已授予
    const wegentUrlObj = new URL(wegentUrl);
    const wegentOrigin = `${wegentUrlObj.protocol}//${wegentUrlObj.host}/*`;
    const wegentGranted = await browser.permissions.contains({ origins: [wegentOrigin] });
    if (!wegentGranted) {
      // 用户拒绝了 wegent 域名权限，无法继续
      console.error('wegent 域名权限未获取，终止接力执行:', wegentOrigin);
      await browser.notifications.create({
        type: 'basic',
        iconUrl: 'icon/128.png',
        title: '自动配置失败',
        message: `未获得 ${wegentUrlObj.host} 的访问权限，请重新点击「自动配置」`,
      });
      return;
    }

    // 处理订阅 URL（若有）：检查权限已授予后再保存和拉取
    if (subscriptionUrl) {
      try {
        const subUrlObj = new URL(subscriptionUrl);
        const subOrigin = `${subUrlObj.protocol}//${subUrlObj.host}/*`;
        const subGranted = await browser.permissions.contains({ origins: [subOrigin] });
        if (subGranted) {
          await saveSubscriptionUrl(subscriptionUrl);
          await handleFetchSubscription(subscriptionUrl);
        } else {
          console.log('订阅 URL 权限未获取，跳过订阅配置:', subOrigin);
        }
      } catch (err) {
        // 订阅失败不阻断主流程
        console.warn('处理订阅 URL 失败，继续执行自动配置:', err);
      }
    }

    // 执行核心自动配置
    await handleAutoConfig(wegentUrl);
  }

  // 从订阅 URL 拉取并应用 AI Mix 配置
  // Background Service Worker 拥有扩展 Host Permission，fetch 不受目标服务器 CORS 限制
  async function handleFetchSubscription(url: string) {
    try {
      console.log('开始拉取订阅配置:', url);
      const response = await fetch(url, {
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
      console.log('订阅配置已更新');
      return { success: true };
    } catch (error) {
      console.error('拉取订阅配置失败:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // 在后台静默拉取订阅配置（不要求成功）
  // onStartup 无用户手势，无法调用 permissions.request()
  // 需先用 permissions.contains() 确认用户已在 Options 页授权，否则跳过
  async function fetchSubscriptionConfig() {
    const url = await getSubscriptionUrl();
    if (!url) {
      console.log('未配置订阅 URL，跳过更新');
      return;
    }

    try {
      const urlObj = new URL(url);
      const origin = `${urlObj.protocol}//${urlObj.host}/*`;
      const hasPermission = await browser.permissions.contains({ origins: [origin] });
      if (!hasPermission) {
        console.log('订阅URL尚未获得访问授权，跳过自动拉取:', origin);
        return;
      }
    } catch (error) {
      console.error('检查订阅URL权限失败:', error);
      return;
    }

    await handleFetchSubscription(url);
  }

  // 自动配置函数
  async function handleAutoConfig(currentUrl: string) {
    try {
      console.log('开始自动配置，当前 URL:', currentUrl);
      
      const urlObj = new URL(currentUrl);
      const settingsUrl = `${urlObj.protocol}//${urlObj.host}/settings?section=api-keys&tab=api-keys`;
      
      console.log('正在打开设置页面:', settingsUrl);
      
      // 打开设置页面
      const settingsTab = await browser.tabs.create({ url: settingsUrl });
      
      if (!settingsTab.id) {
        throw new Error('无法创建设置标签页');
      }
      
      // 等待页面加载完成
      console.log('等待页面加载...');
      await waitForTabComplete(settingsTab.id);
      
      // 查找并点击 API 按钮（内部已包含轮询等待）
      console.log('查找 API 按钮...');
      console.log('settingsTab.id:', settingsTab.id);
      console.log('settingsTab:', settingsTab);
      
      // 确认标签页状态
      const tabCheck = await browser.tabs.get(settingsTab.id);
      console.log('标签页状态:', tabCheck.status, 'URL:', tabCheck.url);
      
      // 点击创建 API 密钥按钮
      const apiButtonClicked = await clickElementByRoleId(settingsTab.id, 'api-key-create-button', 15000);

      if (!apiButtonClicked) {
        throw new Error('未找到 API 创建按钮');
      }

      console.log('API 创建按钮点击成功');

      // 等待输入框出现（弹层中的输入框）
      console.log('等待输入框出现...');
      const inputFound = await waitForElementByRoleId(settingsTab.id, 'api-key-name-input', 10000);

      if (!inputFound) {
        throw new Error('输入框未出现');
      }

      // 生成密钥名称
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const day = now.getDate().toString().padStart(2, '0');
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const seconds = now.getSeconds().toString().padStart(2, '0');
      const keyName = `wegent-power-${year}${month}${day}${hours}${minutes}${seconds}`;

      console.log('密钥名称:', keyName);

      // 填写密钥名称
      await fillInputByRoleId(settingsTab.id, 'api-key-name-input', keyName);

      // 等待输入框值被正确设置（轮询检测）
      console.log('等待输入框值被正确设置...');
      const inputValueSet = await waitForInputValueByRoleId(settingsTab.id, 'api-key-name-input', keyName);

      if (!inputValueSet) {
        throw new Error('输入框值未正确设置');
      }

      // 等待创建按钮启用（轮询检测）
      console.log('等待创建按钮启用...');
      const createButtonEnabled = await waitForButtonEnabledByRoleId(settingsTab.id, 'api-key-submit-button');

      if (!createButtonEnabled) {
        console.warn('创建按钮可能未启用，但继续尝试点击');
      }

      // 点击创建按钮
      console.log('点击创建按钮...');
      const createButtonClicked = await clickElementByRoleId(settingsTab.id, 'api-key-submit-button', 5000);

      if (!createButtonClicked) {
        throw new Error('未找到创建提交按钮');
      }

      console.log('创建按钮点击成功');

      // 等待 API 密钥显示（轮询检测）
      console.log('等待 API 密钥显示...');
      const apiKey = await waitForAndExtractApiKeyByRoleId(settingsTab.id);

      if (!apiKey) {
        throw new Error('未找到 API 密钥');
      }
      
      // API 密钥获取成功（不在日志中输出敏感信息）

      // 保存到本地存储
      await saveConfig({
        wegent_url: `${urlObj.protocol}//${urlObj.host}`,
        wegent_api_key: apiKey
      });

      console.log('保存成功');
      
      // 显示弹层提示
      await browser.notifications.create({
        type: 'basic',
        iconUrl: 'icon/128.png',
        title: '配置成功',
        message: 'API 密钥已成功保存到本地存储'
      });
      
      
      return { success: true, apiKey };
      
    } catch (error) {
      console.error('自动配置失败:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // 处理钉钉 Markdown 下载
  async function handleDingMarkdownDownload(expectedOrigin?: string) {
    console.log('开始监听钉钉 Markdown 下载...', expectedOrigin);

    return new Promise((resolve, reject) => {
      const timeout = 60000; // 1分钟超时
      let downloadListener: ((downloadItem: any) => void) | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      // 设置超时
      timeoutId = setTimeout(() => {
        if (downloadListener) {
          browser.downloads.onCreated.removeListener(downloadListener);
        }
        console.error('等待下载超时（1分钟）');
        reject(new Error('等待下载超时'));
      }, timeout);

      // 监听下载事件
      downloadListener = (downloadItem: any) => {
        const downloadUrl = downloadItem.finalUrl || downloadItem.url;
        if (!downloadUrl) return;

        // 只接受 blob: 开头的下载链接
        if (!downloadUrl.startsWith('blob:')) {
          console.warn('拒绝非 blob URL 的下载:', downloadUrl);
          return; // 继续等待有效下载
        }

        // 如果提供了预期的 origin，验证 blob URL 中的来源域名
        if (expectedOrigin) {
          try {
            // blob URL 格式: blob:https://alidocs.dingtalk.com/uuid
            const blobSource = downloadUrl.slice(5); // 移除 'blob:' 前缀
            const sourceUrl = new URL(blobSource);
            const expectedUrl = new URL(expectedOrigin);

            if (sourceUrl.origin !== expectedUrl.origin) {
              console.warn('下载来源与预期域名不匹配:', sourceUrl.origin, '!==', expectedUrl.origin);
              return; // 继续等待有效下载
            }
          } catch (error) {
            console.error('验证下载来源失败:', error);
            return;
          }
        }

        // 清理监听器和超时
        if (downloadListener) {
          browser.downloads.onCreated.removeListener(downloadListener);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        resolve({ success: true, downloadItem });
      };

      browser.downloads.onCreated.addListener(downloadListener);
    });
  }

  // 处理打开页面并填充输入框
  async function handleOpenAndFillInput(url: string, content: string) {
    try {
      console.log('开始打开页面并填充输入框...');
      console.log('URL:', url);
      console.log('内容长度:', content.length);
      
      // 打开新标签页
      const newTab = await browser.tabs.create({ url });
      
      if (!newTab.id) {
        throw new Error('无法创建新标签页');
      }
      
      console.log('新标签页已创建，ID:', newTab.id);
      
      // 等待页面加载完成
      await waitForTabComplete(newTab.id, 30);
      
      // 等待输入框出现并填充内容
      console.log('等待输入框出现...');
      const filled = await waitForAndFillMessageInput(newTab.id, content);
      
      if (!filled) {
        console.warn('填充输入框可能失败，但页面已打开');
      } else {
        console.log('输入框填充成功');
      }
      
      return { success: true };
    } catch (error) {
      console.error('打开页面并填充输入框失败:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  // 辅助函数：等待并填充消息输入框
  async function waitForAndFillMessageInput(tabId: number, text: string, maxAttempts = 30) {
    console.log('开始等待消息输入框出现');
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        console.log(`第 ${i + 1} 次尝试查找并填充输入框...`);
        
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: (content: string) => {
            try {
              // 查找输入框元素
              const inputEl = document.querySelector('[data-testid="message-input"]');
              
              if (!inputEl) {
                console.log('未找到输入框');
                return false;
              }
              
              console.log('找到输入框，开始填充内容');
              
              // 聚焦输入框
              (inputEl as HTMLElement).focus();
              
              // 修改内容
              (inputEl as HTMLElement).innerText = content;
              
              // 使用 setTimeout 确保渲染完成后再触发 input 事件
              setTimeout(() => {
                // 触发 input 事件通知 React 更新内部 state
                const inputEvent = new Event('input', { bubbles: true, cancelable: true });
                inputEl.dispatchEvent(inputEvent);
                console.log('input 事件已触发');
              }, 1000);
              
              console.log('内容填充完成');
              return true;
            } catch (err) {
              console.error('填充输入框时出错:', err);
              return false;
            }
          },
          args: [text]
        });
        
        if (result?.result) {
          console.log(`输入框填充成功，尝试次数: ${i + 1}`);
          return true;
        }
        
        await sleep(500);
      } catch (error) {
        console.error(`第 ${i + 1} 次尝试失败:`, error);
      }
    }
    
    console.error('超时：未能填充输入框');
    return false;
  }

  // 辅助函数：等待标签页加载完成
  async function waitForTabComplete(tabId: number, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === 'complete') {
        console.log('页面加载完成');
        return;
      }
      await sleep(500);
    }
    console.warn('页面加载超时，继续执行');
  }

  // 辅助函数：通过 data-roleid 等待元素出现
  async function waitForElementByRoleId(tabId: number, roleId: string, timeout = 10000) {
    const startTime = Date.now();
    let attempts = 0;

    console.log(`开始等待元素 [data-roleid="${roleId}"] 出现`);

    while (Date.now() - startTime < timeout) {
      attempts++;
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: (id: string) => {
            const element = document.querySelector(`[data-roleid="${id}"]`);
            return !!element;
          },
          args: [roleId]
        });

        if (result?.result) {
          console.log(`元素 [data-roleid="${roleId}"] 出现，尝试次数: ${attempts}`);
          return true;
        }

        await sleep(500);
      } catch (error) {
        console.error(`第 ${attempts} 次检查元素失败:`, error);
      }
    }

    console.error(`超时：元素 [data-roleid="${roleId}"] 未出现`);
    return false;
  }

  // 辅助函数：通过 data-roleid 点击元素
  async function clickElementByRoleId(tabId: number, roleId: string, timeout = 10000) {
    const startTime = Date.now();
    let attempts = 0;

    console.log(`开始查找并点击元素 [data-roleid="${roleId}"]`);

    while (Date.now() - startTime < timeout) {
      attempts++;
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: (id: string) => {
            const element = document.querySelector(`[data-roleid="${id}"]`) as HTMLElement;
            if (element) {
              element.click();
              return { success: true };
            }
            return { success: false };
          },
          args: [roleId]
        });

        if (result?.result?.success) {
          console.log(`成功点击元素 [data-roleid="${roleId}"]，尝试次数: ${attempts}`);
          return true;
        }

        await sleep(500);
      } catch (error) {
        console.error(`第 ${attempts} 次点击失败:`, error);
      }
    }

    console.error(`超时：未找到元素 [data-roleid="${roleId}"]`);
    return false;
  }

  // 辅助函数：通过 data-roleid 填写输入框
  async function fillInputByRoleId(tabId: number, roleId: string, value: string) {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: (id: string, val: string) => {
        const input = document.querySelector(`[data-roleid="${id}"]`) as HTMLInputElement;
        if (input) {
          input.value = val;
          input.focus();

          // 触发多个事件确保值被正确设置
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

          console.log('输入框填写成功:', val);
          return true;
        } else {
          console.error('未找到输入框');
          return false;
        }
      },
      args: [roleId, value]
    });

    if (!result?.result) {
      throw new Error(`未找到输入框 [data-roleid="${roleId}"]`);
    }
  }

  // 辅助函数：通过 data-roleid 等待输入框值被正确设置
  async function waitForInputValueByRoleId(tabId: number, roleId: string, expectedValue: string, maxAttempts = 20) {
    console.log(`开始等待输入框 [data-roleid="${roleId}"] 值设置为: ${expectedValue}`);

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: (id: string, expected: string) => {
            const input = document.querySelector(`[data-roleid="${id}"]`) as HTMLInputElement;
            if (input) {
              return input.value === expected;
            }
            return false;
          },
          args: [roleId, expectedValue]
        });

        if (result?.result) {
          console.log(`输入框值已正确设置，尝试次数: ${i + 1}`);
          return true;
        }

        await sleep(500);
      } catch (error) {
        console.error(`第 ${i + 1} 次检查输入框值失败:`, error);
      }
    }

    console.error('超时：输入框值未正确设置');
    return false;
  }

  // 辅助函数：通过 data-roleid 等待按钮启用
  async function waitForButtonEnabledByRoleId(tabId: number, roleId: string, maxAttempts = 20) {
    console.log(`开始等待按钮 [data-roleid="${roleId}"] 启用`);

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: (id: string) => {
            const button = document.querySelector(`[data-roleid="${id}"]`) as HTMLButtonElement;
            if (button) {
              return !button.disabled;
            }
            return false;
          },
          args: [roleId]
        });

        if (result?.result) {
          console.log(`按钮已启用，尝试次数: ${i + 1}`);
          return true;
        }

        await sleep(500);
      } catch (error) {
        console.error(`第 ${i + 1} 次检查按钮状态失败:`, error);
      }
    }

    console.error('超时：按钮未启用');
    return false;
  }

  // 辅助函数：通过 data-roleid 等待并提取 API 密钥
  async function waitForAndExtractApiKeyByRoleId(tabId: number, maxAttempts = 20) {
    console.log('开始等待 API 密钥显示');

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: () => {
            const element = document.querySelector('[data-roleid="api-key-display"]');
            if (!element) {
              return null;
            }

            const apiKey = element.textContent?.trim() || null;
            // 确保 API 密钥不为空且有合理的长度
            return apiKey && apiKey.length > 10 ? apiKey : null;
          }
        });

        if (result?.result) {
          console.log(`API 密钥已显示，尝试次数: ${i + 1}`);
          return result.result;
        }

        await sleep(500);
      } catch (error) {
        console.error(`第 ${i + 1} 次提取 API 密钥失败:`, error);
      }
    }

    console.error('超时：未找到 API 密钥');
    return null;
  }

  // 辅助函数：睡眠
  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
});
