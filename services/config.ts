/**
 * 浏览器本地存储配置
 * 统一管理所有存储在 browser.storage.local 中的配置项
 */

import type { ToolConfig } from './wegentApi';
import { encrypt, decrypt, isEncrypted } from './crypto';

/**
 * 扩展配置接口
 * 所有存储在 browser.storage.local 中的配置项的统一结构
 */
export interface ExtensionConfig {
  /** Wegent API 服务地址 */
  wegent_url?: string;
  /** Wegent API 密钥 */
  wegent_api_key?: string;
  /** API 密钥是否已加密（用于兼容旧版数据） */
  wegent_api_key_encrypted?: boolean;
  /** AI Mix 配置订阅 URL，填写后 AI Mix 配置由远程管理，本地不可手动编辑 */
  subscription_url?: string;
}

/**
 * AI Mix AiConfig 接口
 */
export interface AiConfig {
  /** prompt 模板，支持 {content} 占位符 */
  promptTemplate: string;
  /** 模型名称 */
  model?: string;
  /** 工具配置列表 */
  tools?: ToolConfig[];
}

/**
 * AI Mix Action Item 接口
 */
export interface AIMixActionItem {
  /** 操作类型: 'action' - 按钮/提交模式, 'input' - 对话/编码模式 */
  type: 'action' | 'input';
  /** AI 静态配置 */
  aiConfig?: AiConfig;
  /** 按钮标签（仅 type='action' 时生效） */
  buttonLabel?: string;
}

// Re-export types for convenience
export type { ToolConfig };

/**
 * AI Mix 配置接口
 */
export interface AIMixConfig {
  dingTalk: {
    actions: AIMixActionItem[];
  };
  gitLab: {
    actions: AIMixActionItem[];
  };
  jira: {
    actions: AIMixActionItem[];
  };
}

/**
 * AI Mix 存储配置接口（部分可选）
 */
export interface AIMixStorageConfig {
  dingTalk?: {
    actions?: AIMixActionItem[];
  };
  gitLab?: {
    actions?: AIMixActionItem[];
  };
  jira?: {
    actions?: AIMixActionItem[];
  };
}

/**
 * 存储配置的 key 常量
 */
export const STORAGE_KEY = 'extension_config';

/**
 * AI Mix 配置存储 key
 */
export const AI_MIX_CONFIG_KEY = 'ai_mix_config';

/**
 * 保存配置到本地存储
 * API 密钥会被加密存储
 * @param config 配置对象
 */
export async function saveConfig(config: Partial<ExtensionConfig>): Promise<void> {
  try {
    // 先获取原始存储数据（不经过解密处理）
    const rawData = await browser.storage.local.get(STORAGE_KEY) as {
      [STORAGE_KEY]?: ExtensionConfig;
    };
    const rawConfig = rawData[STORAGE_KEY] || {};

    // 合并配置
    const merged: ExtensionConfig = { ...rawConfig, ...config };

    // 加密敏感字段（API 密钥）
    if (merged.wegent_api_key) {
      // 如果传入的 api_key 已经是加密状态（来自 getConfig 的解密结果），需要重新加密
      // 如果传入的是明文新值，则需要加密
      merged.wegent_api_key = await encrypt(merged.wegent_api_key);
    }

    // 标记 API 密钥已加密
    merged.wegent_api_key_encrypted = true;

    // 保存
    await browser.storage.local.set({ [STORAGE_KEY]: merged });
  } catch (error) {
    console.error('保存配置失败:', error);
    throw error;
  }
}

/**
 * 从本地存储获取配置
 * API 密钥会被自动解密
 * @returns 配置对象（包含 wegent_api_key_encrypted 标记）
 */
export async function getConfig(): Promise<ExtensionConfig> {
  try {
    const data = await browser.storage.local.get(STORAGE_KEY) as {
      [STORAGE_KEY]?: ExtensionConfig;
    };
    const config = data[STORAGE_KEY] || {};

    // 兼容处理：如果没有加密标记，直接认为未加密（旧版数据）
    if (config.wegent_api_key_encrypted === undefined) {
      config.wegent_api_key_encrypted = false;
    }

    // 解密敏感字段（API 密钥）
    if (config.wegent_api_key && config.wegent_api_key_encrypted) {
      try {
        config.wegent_api_key = await decrypt(config.wegent_api_key);
      } catch (error) {
        console.error('解密 API 密钥失败，可能是数据损坏:', error);
        config.wegent_api_key = undefined;
        config.wegent_api_key_encrypted = false;
      }
    }

    return config;
  } catch (error) {
    console.error('获取配置失败:', error);
    throw error;
  }
}

/**
 * 清除配置中的指定字段
 * @param keys 要清除的字段名数组
 */
export async function clearConfigFields(keys: Array<keyof ExtensionConfig>): Promise<void> {
  try {
    const existing = await getConfig();
    keys.forEach(key => {
      delete existing[key];
    });
    await browser.storage.local.set({ [STORAGE_KEY]: existing });
  } catch (error) {
    console.error('清除配置字段失败:', error);
    throw error;
  }
}

/**
 * 清除所有配置
 */
export async function clearAllConfig(): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: {} });
  } catch (error) {
    console.error('清除所有配置失败:', error);
    throw error;
  }
}

/**
 * 加载默认 AI Mix 配置（从静态 JSON 文件）
 */
export async function loadDefaultAIMixConfig(): Promise<AIMixConfig> {
  try {
    const response = await fetch('/config/ai-mix-defaults.json');
    if (!response.ok) {
      throw new Error('Failed to load default AI Mix config');
    }
    return response.json();
  } catch (error) {
    console.error('加载默认 AI Mix 配置失败:', error);
    throw error;
  }
}

/**
 * 获取 AI Mix 配置（优先本地存储，无则加载默认配置）
 */
export async function getAIMixConfig(): Promise<AIMixConfig> {
  try {
    // 1. 尝试从本地存储读取
    const data = await browser.storage.local.get(AI_MIX_CONFIG_KEY) as {
      [AI_MIX_CONFIG_KEY]?: AIMixStorageConfig;
    };

    if (data[AI_MIX_CONFIG_KEY]) {
      const stored = data[AI_MIX_CONFIG_KEY]!;
      // 合并确保结构完整（本地存储可能只有部分配置）
      const defaultConfig = await loadDefaultAIMixConfig();
      return {
        dingTalk: {
          actions: stored.dingTalk?.actions || defaultConfig.dingTalk.actions,
        },
        gitLab: {
          actions: stored.gitLab?.actions || defaultConfig.gitLab.actions,
        },
        jira: {
          actions: stored.jira?.actions || defaultConfig.jira.actions,
        },
      };
    }

    // 2. 本地无配置，加载默认 JSON 配置
    return loadDefaultAIMixConfig();
  } catch (error) {
    console.error('获取 AI Mix 配置失败:', error);
    // 失败时尝试加载默认配置
    return loadDefaultAIMixConfig();
  }
}

/**
 * 保存 AI Mix 配置
 */
export async function saveAIMixConfig(config: AIMixStorageConfig): Promise<void> {
  try {
    await browser.storage.local.set({ [AI_MIX_CONFIG_KEY]: config });
  } catch (error) {
    console.error('保存 AI Mix 配置失败:', error);
    throw error;
  }
}

/**
 * 导出完整 AI Mix 配置（当前生效的配置）
 */
export async function exportAIMixConfig(): Promise<AIMixConfig> {
  return getAIMixConfig();
}

/**
 * 导入 AI Mix 配置
 * @param config 导入的配置
 * @param options 导入选项
 */
export async function importAIMixConfig(
  config: Partial<AIMixConfig>,
  options: {
    importDingTalk?: boolean;
    importGitLab?: boolean;
    merge?: boolean;
  } = {}
): Promise<void> {
  const { importDingTalk = true, importGitLab = true, merge = true } = options;

  try {
    let newConfig: AIMixStorageConfig = {};

    if (merge) {
      // 合并模式：读取现有配置并合并
      const existing = await browser.storage.local.get(AI_MIX_CONFIG_KEY) as {
        [AI_MIX_CONFIG_KEY]?: AIMixStorageConfig;
      };
      newConfig = existing[AI_MIX_CONFIG_KEY] || {};
    }

    if (importDingTalk && config.dingTalk?.actions) {
      newConfig.dingTalk = {
        actions: config.dingTalk.actions,
      };
    }

    if (importGitLab && config.gitLab?.actions) {
      newConfig.gitLab = {
        actions: config.gitLab.actions,
      };
    }

    if (config.jira?.actions) {
      newConfig.jira = {
        actions: config.jira.actions,
      };
    }

    await saveAIMixConfig(newConfig);
  } catch (error) {
    console.error('导入 AI Mix 配置失败:', error);
    throw error;
  }
}

/**
 * 重置 AI Mix 配置（清除本地存储，下次加载将使用默认配置）
 */
export async function resetAIMixConfig(): Promise<void> {
  try {
    await browser.storage.local.remove(AI_MIX_CONFIG_KEY);
  } catch (error) {
    console.error('重置 AI Mix 配置失败:', error);
    throw error;
  }
}

/**
 * 获取订阅 URL
 */
export async function getSubscriptionUrl(): Promise<string> {
  const config = await getConfig();
  return config.subscription_url || '';
}

/**
 * 保存订阅 URL
 */
export async function saveSubscriptionUrl(url: string): Promise<void> {
  try {
    const rawData = await browser.storage.local.get(STORAGE_KEY) as {
      [STORAGE_KEY]?: ExtensionConfig;
    };
    const rawConfig = rawData[STORAGE_KEY] || {};
    await browser.storage.local.set({
      [STORAGE_KEY]: { ...rawConfig, subscription_url: url },
    });
  } catch (error) {
    console.error('保存订阅 URL 失败:', error);
    throw error;
  }
}

/**
 * 将从订阅 URL 获取到的数据写入 AI Mix 配置（完整替换）
 */
export async function applySubscriptionData(data: AIMixConfig): Promise<void> {
  const config: AIMixStorageConfig = {};
  if (data.dingTalk?.actions) config.dingTalk = { actions: data.dingTalk.actions };
  if (data.gitLab?.actions) config.gitLab = { actions: data.gitLab.actions };
  if (data.jira?.actions) config.jira = { actions: data.jira.actions };
  await saveAIMixConfig(config);
}