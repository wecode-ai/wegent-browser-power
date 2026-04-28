/**
 * 加密服务模块
 * 提供敏感数据的加密和解密功能
 *
 * 使用 Web Crypto API 进行 AES-GCM 加密
 * 密钥通过扩展 ID 派生，确保每个扩展实例使用不同的密钥
 */

// 加密算法配置
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_STORAGE_KEY = 'wegent_api_key_salt';
const DEFAULT_SALT = 'wegnet-power-extension-salt';

/**
 * 从 storage 获取或创建 salt
 * 如果 storage 中不存在，生成一个新的 salt 并存储（仅加密时调用）
 */
async function getOrCreateSalt(): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  // 尝试从 storage 读取已存在的 salt
  const result = await browser.storage.local.get(SALT_STORAGE_KEY);
  const storedSalt = result[SALT_STORAGE_KEY] as string | undefined;
  if (storedSalt) {
    // 将存储的字符串转回 Uint8Array
    return new Uint8Array(
      atob(storedSalt).split('').map(char => char.charCodeAt(0))
    );
  }

  // 生成新的随机 salt
  const newSalt = crypto.getRandomValues(new Uint8Array(16));

  // 将 salt 转为 Base64 存储
  const saltBase64 = btoa(String.fromCharCode(...newSalt));
  await browser.storage.local.set({ [SALT_STORAGE_KEY]: saltBase64 });

  return newSalt;
}

/**
 * 从 storage 获取 salt（用于解密）
 * 优先使用存储的 salt，如果没有则使用默认 salt
 */
async function getSaltForDecrypt(): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  // 尝试从 storage 读取已存在的 salt
  const result = await browser.storage.local.get(SALT_STORAGE_KEY);
  const storedSalt = result[SALT_STORAGE_KEY] as string | undefined;
  if (storedSalt) {
    // 将存储的字符串转回 Uint8Array
    return new Uint8Array(
      atob(storedSalt).split('').map(char => char.charCodeAt(0))
    );
  }

  // 使用默认 salt（兼容旧数据）
  return encoder.encode(DEFAULT_SALT);
}

/**
 * 从扩展 ID 派生加密密钥
 * 使用 PBKDF2 算法派生密钥，增加安全性
 */
async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const extensionId = browser.runtime.id;

  // 使用扩展 ID 作为基础材料
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(extensionId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 派生 AES-GCM 密钥
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密字符串数据
 * @param plaintext 要加密的明文
 * @returns 加密后的数据（Base64 格式，包含 IV 和密文）
 */
export async function encrypt(plaintext: string): Promise<string> {
  try {
    // 获取或创建 salt（首次加密时创建并存储）
    const salt = await getOrCreateSalt();
    const key = await deriveKey(salt);
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // 生成随机 IV
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // 加密数据
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv
      },
      key,
      data
    );

    // 将 IV 和密文合并，并转换为 Base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('加密失败:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * 解密字符串数据
 * @param ciphertext 加密后的数据（Base64 格式）
 * @returns 解密后的明文
 */
export async function decrypt(ciphertext: string): Promise<string> {
  try {
    // 获取 salt（优先使用存储的，兼容旧数据则使用默认）
    const salt = await getSaltForDecrypt();
    const key = await deriveKey(salt);

    // 从 Base64 解码
    const combined = new Uint8Array(
      atob(ciphertext).split('').map(char => char.charCodeAt(0))
    );

    // 分离 IV 和密文
    const iv = combined.slice(0, IV_LENGTH);
    const encrypted = combined.slice(IV_LENGTH);

    // 解密数据
    const decrypted = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv
      },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('解密失败:', error);
    throw new Error('Decryption failed');
  }
}

/**
 * 检查字符串是否已被加密
 * 通过尝试 Base64 解码并检查长度来粗略判断
 */
export function isEncrypted(data: string): boolean {
  try {
    const decoded = atob(data);
    // 加密数据至少包含 IV + 一些密文
    return decoded.length > IV_LENGTH;
  } catch {
    return false;
  }
}
