/**
 * GitLab API 服务
 * 用于获取 Merge Request 信息
 */

// ==================== 类型定义 ====================

/**
 * GitLab Merge Request 信息
 */
export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  source_project_id: number;
  target_project_id: number;
}

/**
 * GitLab Project 信息
 */
export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  web_url: string;
}

/**
 * MR 详细信息（包含项目信息）
 */
export interface MergeRequestDetails {
  mergeRequest: GitLabMergeRequest;
  sourceProject: GitLabProject;
  targetProject: GitLabProject;
}

// ==================== GitLab API 服务类 ====================

export class GitLabApiService {
  private baseUrl: string;
  private csrfToken: string;

  constructor(baseUrl: string, csrfToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾的斜杠
    this.csrfToken = csrfToken;
  }

  /**
   * 获取 Merge Request 信息
   * @param projectId 项目 ID 或路径（如 "namespace/project"）
   * @param mrIid Merge Request IID
   * @returns MR 信息
   */
  async getMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest> {
    const encodedProjectId = encodeURIComponent(projectId);
    const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mrIid}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-CSRF-Token': this.csrfToken,
        },
        credentials: 'include', // 包含 cookies
      });

      if (!response.ok) {
        throw new Error(`获取 MR 信息失败 (${response.status}): ${response.statusText}`);
      }

      const data: GitLabMergeRequest = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('未知错误');
    }
  }

  /**
   * 获取项目信息
   * @param projectId 项目 ID
   * @returns 项目信息
   */
  async getProject(projectId: number): Promise<GitLabProject> {
    const url = `${this.baseUrl}/api/v4/projects/${projectId}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-CSRF-Token': this.csrfToken,
        },
        credentials: 'include', // 包含 cookies
      });

      if (!response.ok) {
        throw new Error(`获取项目信息失败 (${response.status}): ${response.statusText}`);
      }

      const data: GitLabProject = await response.json();
      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('未知错误');
    }
  }

  /**
   * 获取 MR 的完整详细信息（包含源项目和目标项目）
   * @param projectId 项目 ID 或路径
   * @param mrIid Merge Request IID
   * @returns MR 详细信息
   */
  async getMergeRequestDetails(projectId: string, mrIid: number): Promise<MergeRequestDetails> {
    // 获取 MR 信息
    const mergeRequest = await this.getMergeRequest(projectId, mrIid);
    
    // 获取源项目和目标项目信息
    const [sourceProject, targetProject] = await Promise.all([
      this.getProject(mergeRequest.source_project_id),
      this.getProject(mergeRequest.target_project_id),
    ]);
    
    return {
      mergeRequest,
      sourceProject,
      targetProject,
    };
  }
}

// ==================== 辅助函数 ====================

/**
 * 从 GitLab 页面提取 CSRF Token
 * @param tabId 标签页 ID
 * @returns CSRF Token
 */
export async function extractCsrfToken(tabId: number): Promise<string | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 尝试从 meta 标签获取
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
          return metaTag.getAttribute('content');
        }

        // 尝试从全局变量获取
        if ((window as any).gon && (window as any).gon.csrf_token) {
          return (window as any).gon.csrf_token;
        }

        return null;
      }
    });

    return result?.result || null;
  } catch (error) {
    console.error('提取 CSRF Token 失败:', error);
    return null;
  }
}

/**
 * 从 MR URL 解析项目路径和 MR IID
 * @param url MR URL
 * @returns { projectPath, mrIid } 或 null
 */
export function parseMergeRequestUrl(url: string): { projectPath: string; mrIid: number; baseUrl: string } | null {
  try {
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    
    // 匹配 URL 格式: https://gitlab.com/namespace/project/-/merge_requests/123
    const match = urlObj.pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)/);
    
    if (!match) {
      return null;
    }
    
    const projectPath = match[1];
    const mrIid = parseInt(match[2], 10);
    
    return { projectPath, mrIid, baseUrl };
  } catch (error) {
    console.error('解析 MR URL 失败:', error);
    return null;
  }
}

/**
 * 从当前活动标签页创建 GitLab API 服务
 * @returns GitLabApiService 实例或 null
 */
export async function createGitLabApiService(): Promise<{ service: GitLabApiService; baseUrl: string } | null> {
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (!activeTab || !activeTab.id || !activeTab.url) {
      console.warn('未找到活动标签页');
      return null;
    }
    
    // 解析 URL 获取 baseUrl
    const parsed = parseMergeRequestUrl(activeTab.url);
    if (!parsed) {
      console.warn('当前页面不是 GitLab MR 页面');
      return null;
    }
    
    // 提取 CSRF Token
    const csrfToken = await extractCsrfToken(activeTab.id);
    if (!csrfToken) {
      console.warn('未找到 CSRF Token');
      return null;
    }
    
    return {
      service: new GitLabApiService(parsed.baseUrl, csrfToken),
      baseUrl: parsed.baseUrl
    };
  } catch (error) {
    console.error('创建 GitLab API 服务失败:', error);
    return null;
  }
}
