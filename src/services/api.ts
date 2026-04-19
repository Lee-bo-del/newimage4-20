const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3325/api'
    : '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, "");

// Helper to ensure header values contain only ISO-8859-1 (ASCII) characters
const sanitizeHeader = (val: string) => val.replace(/[^\x00-\x7F]/g, "").trim();

// Helper to determine model based on size
export const getModelBySize = (size: string): string => {
    switch (size.toLowerCase()) {
        case '4k': return 'nano-banana-2-4k';
        case '2k': return 'nano-banana-2-2k';
        case '1k':
        default: return 'nano-banana-2';
    }
};

interface GeneratePayload {
    model: string;
    prompt: string;
    size: string;
    aspect_ratio: string;
    n: number;
    image?: string; // Base64 for Image-to-Image (Legacy/V1)
    images?: string[]; // Array of Base64 (V2/V3 wrapper compatibility)
    mask?: string;
}

export interface TaskStatusResponse {
    id: string;
    status: string; // SUCCESS, FAILED, PROCESSING, PENDING
    state?: string; // minimal API returns 'state' sometimes
    output?: any;
    data?: any;
    [key: string]: any;
}

// Extract URLs helper
export function findAllUrlsInObject(obj: any, results: string[] = []) {
    if (!obj) return;
    if (Array.isArray(obj)) {
        obj.forEach(item => findAllUrlsInObject(item, results));
        return;
    }
    if (typeof obj !== 'object') return;

    if (obj.output && typeof obj.output === 'string' && (obj.output.startsWith('http') || obj.output.startsWith('data:'))) {
        results.push(obj.output);
    }
    else if (obj.url && typeof obj.url === 'string' && (obj.url.startsWith('http') || obj.url.startsWith('data:'))) {
        results.push(obj.url);
    }
    else if (obj.image_url && typeof obj.image_url === 'string' && (obj.image_url.startsWith('http') || obj.image_url.startsWith('data:'))) {
        results.push(obj.image_url);
    }

    for (let key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (typeof val === 'object') {
                findAllUrlsInObject(val, results);
            }
        }
    }
}

// Helper to handle API errors consistently
const handleApiError = async (response: Response, fallbackMsg: string) => {
    const errText = await response.text();
    let errJson;
    try { errJson = JSON.parse(errText); } catch (e) { }

    const lowerErr = (errJson?.error?.message || errJson?.error || errText).toLowerCase();

    // Specific check for "pre-consume" failures
    if (lowerErr.includes("pre_consume_token_quota_failed") || lowerErr.includes("pre-consume")) {
        throw new Error("谷歌账户预扣额度失败，请联系管理员");
    }

    // Recognition of "Insufficient balance/quota"
    if (
        lowerErr.includes("token quota is not enough") ||
        lowerErr.includes("insufficient balance") ||
        lowerErr.includes("quota")
    ) {
        throw new Error("你的密钥额度不足，请充值后重试");
    }

    if (response.status === 401) {
        throw new Error("密钥错误：请检查 API Key 是否完整（需以 sk- 开头）");
    }

    throw new Error(errJson?.error?.message || errJson?.error || `${fallbackMsg} (${response.status})`);
};

export const generateImageApi = async (apiKey: string, payload: any): Promise<{ taskId: string, url?: string }> => {
    if (!apiKey) throw new Error("API Key is missing.");
    const endpoint = `${cleanUrl(API_BASE_URL)}/generate`;
    const authHeader = sanitizeHeader(apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        await handleApiError(response, "提交失败");
    }

    const resJson = await response.json();
    // Support both async (taskId) and sync (url) returns
    if (resJson.url || resJson.image_url) {
        return { taskId: '', url: resJson.url || resJson.image_url };
    }
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);
    if (!taskId && !resJson.url) throw new Error("No Task ID or URL received from API.");
    return { taskId: taskId || '', ...resJson };
};

export const editImageApi = async (apiKey: string, payload: any): Promise<{ taskId: string }> => {
    if (!apiKey) throw new Error("API Key is missing.");
    const endpoint = `${cleanUrl(API_BASE_URL)}/edit`;
    const authHeader = sanitizeHeader(apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        await handleApiError(response, "重绘失败");
    }

    const resJson = await response.json();
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);
    if (!taskId) throw new Error("No Task ID received from API.");
    return { taskId };
};

export const getTaskStatusApi = async (apiKey: string, taskId: string): Promise<TaskStatusResponse> => {
    const url = `${cleanUrl(API_BASE_URL)}/task/${taskId}`;
    const authHeader = sanitizeHeader(apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Polling HTTP error: ${response.status}`);
    }

    return await response.json();
};

export const checkTaskStatus = getTaskStatusApi;

export const checkVideoTaskStatus = async (apiKey: string, taskId: string): Promise<TaskStatusResponse> => {
    const url = `${cleanUrl(API_BASE_URL)}/video/task/${taskId}`;
    const authHeader = sanitizeHeader(apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Video Polling HTTP error: ${response.status}`);
    }

    return await response.json();
};

// ==================== Gemini 原生图片生成 ====================

export const generateGeminiImage = async (
    apiKey: string,
    payload: any // Fully controlled by caller for native format
): Promise<any> => {
    if (!apiKey) throw new Error("API Key is missing.");

    // Route through local proxy to ensure model/size mapping and logging
    const endpoint = `${cleanUrl(API_BASE_URL)}/gemini/generate`;
    const authHeader = sanitizeHeader(apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);

    console.log(`[Gemini API] Calling local proxy: ${endpoint} for model: ${payload.model || 'gemini-3-pro-image-preview'}`);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        await handleApiError(response, "生成失败");
    }

    return await response.json();
};
