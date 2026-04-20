/**
 * Wegent API 服务
 * 用于调用 Wegent 的响应 API
 */

// ==================== 类型定义 ====================

/**
 * 消息类型
 */
export interface Message {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 输入类型 - 支持简单字符串或对话历史数组
 */
export type InputType = string | Message[];

/**
 * MCP 服务器配置
 */
export interface McpServer {
  url: string;
  type: 'http' | 'sse';
}

/**
 * Git 工作区配置
 */
export interface GitWorkspace {
  git_url: string;
  branch: string;
  git_repo?: string;
}

/**
 * 工具配置
 */
export interface ToolConfig {
  type: 'wegent_chat_bot' | 'wegent_code_bot' | 'mcp' | 'skill';
  workspace?: GitWorkspace;
  mcp_servers?: Record<string, McpServer>;
  preload_skills?: string[];
}

/**
 * 创建响应请求体
 */
export interface CreateResponseRequest {
  model: string;
  input: InputType;
  stream?: boolean;
  previous_response_id?: string;
  tools?: ToolConfig[];
}

/**
 * 输出文本内容
 */
export interface OutputText {
  type: 'output_text';
  text: string;
  annotations: any[];
}

/**
 * 输出消息
 */
export interface OutputMessage {
  type: 'message';
  id: string;
  status: 'completed' | 'in_progress' | 'pending';
  role: 'user' | 'assistant';
  content: OutputText[];
}

/**
 * 响应状态
 */
export type ResponseStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * 创建响应响应体
 */
export interface CreateResponseResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: ResponseStatus;
  model: string;
  output: OutputMessage[];
  error: null | {
    type: string;
    message: string;
  };
  previous_response_id: string | null;
}

/**
 * API 错误响应
 */
export interface ApiError {
  error?: {
    type?: string;
    message?: string;
  };
  detail?: string;
}

// ==================== API 服务类 ====================

export class WegentApiService {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾的斜杠
    this.apiKey = apiKey;
  }

  /**
   * 创建新的响应
   * @param request 请求参数
   * @returns 响应结果
   */
  async createResponse(request: CreateResponseRequest): Promise<CreateResponseResponse> {
    const url = `${this.baseUrl}/api/v1/responses`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData: ApiError = await response.json();
        // 优先提取 detail 字段，其次是 error.message，最后是 statusText
        const errorMessage = errorData.detail || errorData.error?.message || response.statusText;
        throw new Error(`API 请求失败 (${response.status}): ${errorMessage}`);
      }

      const data: CreateResponseResponse = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('未知错误');
    }
  }

  /**
   * 获取响应状态（用于轮询）
   * @param responseId 响应 ID
   * @returns 响应结果
   */
  async getResponse(responseId: string): Promise<CreateResponseResponse> {
    const url = `${this.baseUrl}/api/v1/responses/${responseId}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData: ApiError = await response.json();
        // 优先提取 detail 字段，其次是 error.message，最后是 statusText
        const errorMessage = errorData.detail || errorData.error?.message || response.statusText;
        throw new Error(`API 请求失败 (${response.status}): ${errorMessage}`);
      }

      const data: CreateResponseResponse = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('未知错误');
    }
  }

  /**
   * 轮询等待响应完成
   * @param responseId 响应 ID
   * @param interval 轮询间隔（毫秒）
   * @param maxAttempts 最大尝试次数
   * @returns 完成的响应
   */
  async waitForCompletion(
    responseId: string,
    interval: number = 1000,
    maxAttempts: number = 60
  ): Promise<CreateResponseResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.getResponse(responseId);
      
      if (response.status === 'completed') {
        return response;
      }
      
      if (response.status === 'failed' || response.status === 'cancelled') {
        throw new Error(`响应${response.status}: ${response.error?.message || '未知错误'}`);
      }
      
      // 等待下一次轮询
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error('响应超时');
  }

  /**
   * 创建响应并等待完成（适用于非 Chat Shell）
   * @param request 请求参数
   * @param interval 轮询间隔（毫秒）
   * @param maxAttempts 最大尝试次数
   * @returns 完成的响应
   */
  async createAndWait(
    request: CreateResponseRequest,
    interval: number = 1000,
    maxAttempts: number = 60
  ): Promise<CreateResponseResponse> {
    const response = await this.createResponse(request);
    
    // 如果已经完成，直接返回
    if (response.status === 'completed') {
      return response;
    }
    
    // 否则轮询等待完成
    return this.waitForCompletion(response.id, interval, maxAttempts);
  }
}

import { getConfig } from './config';

// ==================== 工厂函数 ====================

/**
 * 从浏览器存储创建 Wegent API 服务实例
 * @returns WegentApiService 实例
 */
export async function createWegentApiService(): Promise<WegentApiService | null> {
  try {
    const config = await getConfig();

    if (!config.wegent_url || !config.wegent_api_key) {
      console.warn('Wegent API 配置未找到');
      return null;
    }

    return new WegentApiService(config.wegent_url, config.wegent_api_key);
  } catch (error) {
    console.error('创建 Wegent API 服务失败:', error);
    return null;
  }
}

// ==================== 使用示例 ====================

/*
// 示例 1: 简单对话
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'default#my-assistant',
    input: '你好，最近怎么样？',
    stream: false
  });
  console.log(response);
}

// 示例 2: 多轮对话
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'default#my-assistant',
    input: [
      { type: 'message', role: 'user', content: '2+2 等于多少？' },
      { type: 'message', role: 'assistant', content: '2+2 等于 4。' },
      { type: 'message', role: 'user', content: '那 3+3 呢？' }
    ],
    stream: false
  });
  console.log(response);
}

// 示例 3: 使用工具（启用所有服务端能力）
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'default#my-assistant',
    input: '帮我搜索最新的科技新闻',
    stream: false,
    tools: [
      { type: 'wegent_chat_bot' }
    ]
  });
  console.log(response);
}

// 示例 4: 使用代码任务工具
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'my-group#coding-agent',
    input: '帮我修复这个 bug',
    stream: false,
    tools: [
      {
        type: 'wegent_code_bot',
        workspace: {
          git_url: 'https://github.com/user/repo.git',
          branch: 'main',
          git_repo: 'user/repo'
        }
      }
    ]
  });
  console.log(response);
}

// 示例 5: 使用 MCP 服务器
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'default#my-assistant',
    input: '使用 MCP 工具帮我处理数据',
    stream: false,
    tools: [
      {
        type: 'mcp',
        mcp_servers: {
          'my-server': { url: 'http://localhost:3000', type: 'http' },
          'another': { url: 'http://localhost:3001', type: 'sse' }
        }
      }
    ]
  });
  console.log(response);
}

// 示例 6: 预加载技能
const api = await createWegentApiService();
if (api) {
  const response = await api.createResponse({
    model: 'default#my-assistant',
    input: '使用预加载的技能帮我完成任务',
    stream: false,
    tools: [
      { type: 'skill', preload_skills: ['skill_a', 'skill_b'] }
    ]
  });
  console.log(response);
}

// 示例 7: 轮询等待完成（适用于非 Chat Shell）
const api = await createWegentApiService();
if (api) {
  const response = await api.createAndWait({
    model: 'default#my-assistant',
    input: '这是一个长时间任务',
    stream: false
  });
  console.log(response);
}
*/
