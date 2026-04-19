// API Configuration
// 生产环境建议使用相对路径 /api，本地开发使用 http://localhost:3323/api
const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3325/api'
    : '/api';
// Helper to determine model based on size
const getModelBySize = (size: string): string => {
    switch (size.toLowerCase()) {
        case '4k': return 'nano-banana-2-4k';
        case '2k': return 'nano-banana-2-2k';
        case '1k':
        default: return 'nano-banana-2';
    }
};

// Helper to wait between polling requests
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const cleanUrl = (url: string) => url.replace(/\/$/, "");

// Helper to extract raw Base64 from data URL
const extractBase64 = (dataUrl: string) => {
    if (dataUrl.includes(',')) {
        return dataUrl.split(',')[1];
    }
    return dataUrl;
};

// Recursive function to find ALL URLs in the object
function findAllUrlsInObject(obj: any, results: string[] = []) {
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

function findStatusInObject(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.status && typeof obj.status === 'string') return obj.status;
    if (obj.state && typeof obj.state === 'string') return obj.state;
    if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
    return null;
}

// 轮询任务状态 - 通过后端代理
const pollTask = async (apiKey: string, taskId: string, onProgress?: (progress: number) => void): Promise<string[]> => {
    const url = `${cleanUrl(API_BASE_URL)}/task/${taskId}`;
    const maxAttempts = 450; // 15 minutes (450 * 2s = 900s)

    // 确保 Authorization header 格式正确
    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const startTime = Date.now();

    for (let i = 0; i < maxAttempts; i++) {
        await sleep(2000);

        // Simulated Progress (Target 90% at 80s)
        const elapsed = (Date.now() - startTime) / 1000;
        // k ≈ 0.028 for 90% at 80s
        const simulated = (1 - Math.exp(-0.028 * elapsed)) * 100;
        const displayProgress = Math.min(Math.floor(simulated), 99);
        if (onProgress) onProgress(displayProgress);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) continue;
                console.warn(`Polling HTTP error: ${response.status}`);
                continue;
            }

            const data = await response.json();
            console.log(`Polling [${i}/${maxAttempts}]`, data);

            let statusRaw = (data.status || data.state || "").toUpperCase();
            if (!statusRaw || statusRaw === "UNKNOWN") {
                const innerStatus = findStatusInObject(data);
                if (innerStatus) statusRaw = innerStatus.toUpperCase();
            }

            const isSuccess = statusRaw === 'SUCCESS' || statusRaw === 'SUCCEEDED' || statusRaw === 'COMPLETED';
            const isFailed = statusRaw === 'FAILURE' || statusRaw === 'FAILED';

            if (isSuccess) {
                const foundUrls: string[] = [];
                findAllUrlsInObject(data, foundUrls);
                const uniqueUrls = Array.from(new Set(foundUrls));

                if (uniqueUrls.length > 0) {
                    console.log("Images found:", uniqueUrls);
                    return uniqueUrls;
                }
            } else if (isFailed) {
                throw new Error(`Task failed: ${JSON.stringify(data)}`);
            }

        } catch (error) {
            console.warn("Polling error:", error);
        }
    }

    throw new Error("Task timed out. No images returned.");
};

// Helper to handle API errors and customize specific messages
const handleApiError = async (response: Response) => {
    const errText = await response.text();
    
    // Handle authentication errors (invalid/expired API key)
    if (response.status === 401) {
        throw new Error("密钥错误：请检查密钥是否输入完整（需以 sk- 开头）");
    }

    // Check for specific insufficient balance messages from backend
    // Format: "token quota is not enough, token [xxx] remain quota: xxx, need quota: xxx"
    const lowerErr = errText.toLowerCase();
    if (
        lowerErr.includes("token quota is not enough") ||
        (lowerErr.includes("remain quota") && lowerErr.includes("need quota")) ||
        lowerErr.includes("insufficient balance") ||
        lowerErr.includes("not enough balance") ||
        lowerErr.includes("credit") ||
        lowerErr.includes("quota")
    ) {
        throw new Error("你的密钥余额不足，请充值续费");
    }

    throw new Error(`Submission Failed (${response.status}): ${errText}`);
};


// 生成图片 - 通过后端代理
export const generateImage = async (
    apiKey: string,
    prompt: string,
    aspectRatio: string = '1:1',
    imageSize: string = '1k',
    n: number = 1,
    onProgress?: (progress: number) => void
): Promise<string[]> => {
    if (!apiKey) throw new Error("API Key is missing.");

    const endpoint = `${cleanUrl(API_BASE_URL)}/generate`;
    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: getModelBySize(imageSize),
            prompt: prompt,
            size: imageSize.toLowerCase(),
            aspect_ratio: aspectRatio,
            n: n
        })
    });

    if (!response.ok) {
        await handleApiError(response);
    }

    const resJson = await response.json();
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);

    if (!taskId) throw new Error("No Task ID received from API.");

    return await pollTask(apiKey, taskId, onProgress);
};

// 编辑图片 - 通过后端代理
export const editImage = async (
    apiKey: string,
    base64Image: string,
    prompt: string,
    aspectRatio: string = '1:1',
    imageSize: string = '1k',
    n: number = 1,
    onProgress?: (progress: number) => void
): Promise<string[]> => {
    if (!apiKey) throw new Error("API Key is missing.");

    const endpoint = `${cleanUrl(API_BASE_URL)}/generate`;
    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const rawBase64 = extractBase64(base64Image);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: getModelBySize(imageSize),
            prompt: prompt,
            size: imageSize.toLowerCase(),
            aspect_ratio: aspectRatio,
            n: n,
            image: rawBase64
        })
    });

    if (!response.ok) {
        await handleApiError(response);
    }

    const resJson = await response.json();
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);

    if (!taskId) throw new Error("No Task ID received from API.");

    return await pollTask(apiKey, taskId, onProgress);
};

// 查询余额 - 通过后端代理
export const checkBalance = async (apiKey: string): Promise<any> => {
    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;

    try {
        const response = await fetch(`${cleanUrl(API_BASE_URL)}/balance/info`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            let errJson;
            try { errJson = JSON.parse(errText); } catch (e) { }

            throw new Error((errJson && errJson.error) ? errJson.error : `HTTP ${response.status}: ${errText.substring(0, 50)}`);
        }

        const data = await response.json();
        return data;
    } catch (e: any) {
        throw new Error(e.message || "Failed to fetch balance");
    }
};
