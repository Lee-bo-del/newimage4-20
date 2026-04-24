const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const fs = require("fs");
const FormData = require("form-data");
const https = require("https");

// Logger Configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "debug_error.log" }),
  ],
});

const app = express();
const PORT = 3325;

// 涓婃父 API 閰嶇疆
const UPSTREAM_URL = "https://api.bltcy.ai";
const SHARED_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  family: 4,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableNetworkError = (error) => {
  if (!error) return false;
  if (error.response) return false;
  const code = String(error.code || error.cause?.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return (
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    message.includes("client network socket disconnected before secure tls connection was established") ||
    message.includes("socket hang up")
  );
};
const requestWithRetry = async (
  fn,
  { retries = 1, delayMs = 500, label = "request" } = {},
) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt >= retries) {
        throw error;
      }
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(
        `[Retry] ${label} attempt ${attempt + 1} failed: ${error.message}. Retrying in ${wait}ms`,
      );
      await sleep(wait);
      attempt += 1;
    }
  }
};

// Security Middleware
// Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Totally disable CSP to allow blob: and data: images
    crossOriginEmbedderPolicy: false,
  })
);

// ==================== Rate Limiting Configuration ====================
// For PUBLIC SERVICE: Per-user limits to ensure fair resource distribution

// Import the ipKeyGenerator helper for proper IPv6 support
const { ipKeyGenerator } = rateLimit;

// Helper: Extract user identifier (API Key or IP with proper IPv6 handling)
const getUserKey = (req) => {
  const apiKey = req.headers['authorization'];
  // Use API key if available, otherwise fall back to IP (with IPv6 support)
  return apiKey && apiKey.length > 10 ? apiKey : ipKeyGenerator(req);
};

// Global fallback limiter (per user)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1500,                  // 1500 requests per user per 15 minutes (increased for public service)
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯"
});

// Polling endpoints - per user, high frequency
const pollingLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 50,                    // 50 requests per user per minute (allows ~2-3 concurrent tasks per user)
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "杞璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯"
});

// Generation endpoints - per user, moderate limits
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 generation requests per user per minute
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: "鐢熸垚璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯"
});

// Announcement endpoint - per IP, very lenient (read-only)
const announcementLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                   // 100 requests per IP per minute
  keyGenerator: ipKeyGenerator, // Use official helper for IPv6 support
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Announcement service temporarily unavailable"
});

// Apply global limiter only to API routes, not static files
app.use("/api", globalLimiter);

app.use(cors());
app.use(express.json({ limit: "50mb" })); // 鏀寔澶у浘鐗?Base64

// ==================== 浣欓鏌ヨ鎺ュ彛 ====================
app.get("/api/balance/info", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const startDate = "2023-01-01";
    const now = new Date();
    now.setDate(now.getDate() + 1);
    const endDate = now.toISOString().split("T")[0];

    const [subRes, usageRes] = await Promise.all([
      axios.get(`${UPSTREAM_URL}/v1/dashboard/billing/subscription`, {
        headers: { Authorization: userKey },
      }),
      axios.get(
        `${UPSTREAM_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
        {
          headers: { Authorization: userKey },
        },
      ),
    ]);

    const subData = subRes.data;
    const usageData = usageRes.data;

    // 绉垎璁＄畻鍏紡: 1 USD = 25 閲戝竵
    const POINTS_MULTIPLIER = 25;
    let totalQuotaUsd = parseFloat(subData.hard_limit_usd || 0);
    let usedAmountUsd = 0;
    if (usageData && usageData.total_usage !== undefined) {
      usedAmountUsd = parseFloat(usageData.total_usage) / 100;
    }

    let remainingBalanceUsd = totalQuotaUsd - usedAmountUsd;
    if (remainingBalanceUsd < 0) remainingBalanceUsd = 0;

    // 鏂扮Н鍒嗗叕寮?
    const total_points = Math.floor(totalQuotaUsd * POINTS_MULTIPLIER);
    const used_points = Math.floor(usedAmountUsd * POINTS_MULTIPLIER);
    const remaining_points = total_points - used_points;

    res.json({
      success: true,
      status_valid: remainingBalanceUsd > 0.05,
      remaining_points: remaining_points,
      used_points: used_points,
      total_points: total_points,
    });
  } catch (error) {
    console.error("Balance Check Error:", error.message);
    if (error.response && error.response.status === 401) {
      res.status(401).json({ error: "API Key 鏃犳晥鎴栧凡杩囨湡" });
    } else {
      res.status(500).json({ error: "鏌ヨ浣欓澶辫触锛岃绋嶅悗閲嶈瘯" });
    }
  }
});

// ==================== 鐢熷浘浠ｇ悊鎺ュ彛 ====================
app.post("/api/generate", generateLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const requestBody = req.body;
    const isGrokModel = requestBody.model?.startsWith("grok");

    const toRawBase64 = (value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("data:")) {
        const commaIndex = trimmed.indexOf(",");
        if (commaIndex > -1) return trimmed.slice(commaIndex + 1);
      }
      if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("blob:")
      ) {
        return null;
      }
      return trimmed;
    };

    const collectNormalizedImages = (body) => {
      const items = [];
      const pushOne = (value) => {
        const normalized = toRawBase64(value);
        if (normalized) items.push(normalized);
      };
      const pushMany = (value) => {
        if (Array.isArray(value)) value.forEach(pushOne);
      };
      pushOne(body.image);
      pushOne(body.reference_image);
      pushOne(body.image_url);
      pushOne(body.reference_image_url);
      pushMany(body.images);
      pushMany(body.reference_images);
      pushMany(body.image_urls);
      pushMany(body.reference_image_urls);
      return Array.from(new Set(items));
    };

    if (isGrokModel) {
      const hasAnyReferenceField = [
        "image",
        "images",
        "reference_image",
        "reference_images",
        "image_url",
        "image_urls",
        "reference_image_url",
        "reference_image_urls",
      ].some((key) => requestBody[key] !== undefined);

      if (hasAnyReferenceField) {
        const normalizedImages = collectNormalizedImages(requestBody);
        if (normalizedImages.length > 0) {
          requestBody.image = normalizedImages[0];
          requestBody.images = normalizedImages;
          requestBody.reference_image = normalizedImages[0];
          requestBody.reference_images = normalizedImages;
          if (!requestBody.reference_mode) {
            requestBody.reference_mode = "stable_fusion";
          }
        }
      }

      delete requestBody.image_url;
      delete requestBody.image_urls;
      delete requestBody.reference_image_url;
      delete requestBody.reference_image_urls;
    }
    
    // Resolution mapping for Doubao and Z-image models
    const DOUBAO_RESOLUTIONS = {
      "1K": {
        "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800",
        "9:16": "800x1424", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672"
      },
      "2K": {
        "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2848x1600",
        "9:16": "1600x2848", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344"
      },
      "3K": {
        "1:1": "3072x3072", "4:3": "3456x2592", "3:4": "2592x3456", "16:9": "4096x2304",
        "9:16": "2304x4096", "2:3": "2496x3744", "3:2": "3744x2496", "21:9": "4704x2016"
      },
      "4K": {
        "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "16:9": "5504x3040",
        "9:16": "3040x5504", "2:3": "3328x4992", "3:2": "4992x3328", "21:9": "6240x2656"
      }
    };

    const isSyncLine = requestBody.isSync === true;
    if (isSyncLine) {
      delete requestBody.isSync; // 绉婚櫎鍓嶇涓撶敤鏍囪瘑
    }

    const isDoubaoOrTurbo = requestBody.model?.startsWith('doubao') ||
                            requestBody.model === 'z-image-turbo';

    if (isDoubaoOrTurbo) {
      // Doubao Expects 'image' as array for Seedream 4.5/5.0
      if (requestBody.model?.startsWith('doubao') && Array.isArray(requestBody.image)) {
        requestBody.sequential_image_generation = "auto";
        requestBody.response_format = "url";
      }
      
      // Size resolution mapping (skip if already WxH format from frontend)
      if (requestBody.size && !requestBody.size.includes('x')) {
        let sizeKey = requestBody.size.toUpperCase();
        const ratio = requestBody.aspect_ratio || "1:1";
        
        // Model validation/normalization
        if (requestBody.model.includes('5-0')) {
          // 鍗虫ⅵ5.0: 2K or 3K
          if (sizeKey === '1K') sizeKey = '2K';
          if (sizeKey === '4K') sizeKey = '3K';
          if (!['2K', '3K'].includes(sizeKey)) sizeKey = '2K';
        } else if (requestBody.model.includes('4-5')) {
          // 鍗虫ⅵ4.5: 2K or 4K
          if (sizeKey === '1K') sizeKey = '2K';
          if (sizeKey === '3K') sizeKey = '2K';
          if (!['2K', '4K'].includes(sizeKey)) sizeKey = '2K';
        } else if (requestBody.model === 'z-image-turbo') {
          // z-image-turbo: 鍥哄畾 1K
          sizeKey = '1K';
        }

        // Apply resolution mapping if available
        if (DOUBAO_RESOLUTIONS[sizeKey] && DOUBAO_RESOLUTIONS[sizeKey][ratio]) {
          requestBody.size = DOUBAO_RESOLUTIONS[sizeKey][ratio];
          console.log(`[Resolution] Mapped ${sizeKey} ${ratio} to ${requestBody.size}`);
        } else {
          requestBody.size = sizeKey;
        }
      }
    }

    const grokImageDebug = isGrokModel
      ? {
          imageLen: typeof requestBody.image === "string" ? requestBody.image.length : 0,
          imagesCount: Array.isArray(requestBody.images) ? requestBody.images.length : 0,
          referenceImageLen:
            typeof requestBody.reference_image === "string" ? requestBody.reference_image.length : 0,
          referenceImagesCount: Array.isArray(requestBody.reference_images)
            ? requestBody.reference_images.length
            : 0,
          imagePrefix:
            typeof requestBody.image === "string" ? requestBody.image.slice(0, 24) : String(typeof requestBody.image),
        }
      : undefined;

    console.log("[Generate] Proxying request:", {
      model: requestBody.model,
      size: requestBody.size,
      ratio: requestBody.aspect_ratio,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image,
      isSync: isSyncLine,
      imageType: Array.isArray(requestBody.image) ? "Array" : typeof requestBody.image,
      grokImageDebug,
    });

    const upstreamUrl = isSyncLine 
      ? `${UPSTREAM_URL}/v1/chat/completions` 
      : `${UPSTREAM_URL}/v1/images/generations?async=true`;

    // 濡傛灉鏄悓姝ョ嚎璺紙Chat 鎺ュ彛锛夛紝杞崲璇锋眰浣?
    let finalRequestBody = requestBody;
    if (isSyncLine) {
      finalRequestBody = {
        model: requestBody.model,
        messages: [
          { role: 'user', content: requestBody.prompt }
        ],
        stream: false
      };
    } else if (requestBody.model === "gpt-image-2") {
      finalRequestBody = {
        model: "gpt-image-2",
        prompt: requestBody.prompt,
        size: requestBody.size || "auto",
        quality: requestBody.quality || "auto",
        output_format: requestBody.output_format || "png",
        moderation: requestBody.moderation || "auto",
      };

      if (requestBody.n) finalRequestBody.n = requestBody.n;
      if (
        requestBody.output_format &&
        requestBody.output_format !== "png" &&
        requestBody.output_compression !== undefined &&
        requestBody.output_compression !== null
      ) {
        finalRequestBody.output_compression = requestBody.output_compression;
      }
    }

    const response = await requestWithRetry(
      () =>
        axios.post(
          upstreamUrl,
          finalRequestBody,
          {
            headers: {
              Authorization: userKey,
              "Content-Type": "application/json",
            },
            timeout: 600000, // 600 绉?(10鍒嗛挓) 瓒呮椂
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 1, delayMs: 700, label: "generate" },
    );

    // 濡傛灉鏄悓姝ョ嚎璺紝瑙ｆ瀽 Chat 杩斿洖鏍煎紡浠ユ彁鍙?URL
    if (isSyncLine) {
      const chatContent = response.data.choices?.[0]?.message?.content || "";
      console.log("[Generate] Chat response content:", chatContent.substring(0, 100));
      
      const urlMatch = chatContent.match(/https?:\/\/[^\s^)^>]+/);
      if (urlMatch) {
         return res.json({ url: urlMatch[0] });
      } else {
         return res.json({ url: chatContent }); // 鐩存帴杩斿洖鏂囨湰鍐呭浣滀负鍏滃簳
      }
    }

    console.log("[Generate] Upstream response:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("[Generate] Error:", error.message);
    logger.error({
      timestamp: new Date().toISOString(),
      type: "Generate Error",
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });

    if (error.response) {
      // 閫忎紶涓婃父閿欒
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === "ECONNABORTED") {
      res.status(504).json({ error: "璇锋眰瓒呮椂锛岃绋嶅悗閲嶈瘯" });
    } else {
      res.status(500).json({ error: error.message || "鐢熸垚璇锋眰澶辫触" });
    }
  }
});

// ==================== 灞€閮ㄩ噸缁樹唬鐞嗘帴鍙?====================
app.post("/api/edit", generateLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const requestBody = req.body;
    
    console.log("[Edit] Proxying request:", {
      model: requestBody.model,
      size: requestBody.size,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image,
      hasMask: !!requestBody.mask
    });

    const parseBase64ImageInput = (value, fallbackExt = "png", fallbackMime = "image/png") => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;

      const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
      if (dataUrlMatch) {
        const mime = dataUrlMatch[1].toLowerCase();
        const extMap = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/jpg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        };
        const ext = extMap[mime] || fallbackExt;
        const buffer = Buffer.from(dataUrlMatch[2].replace(/\s+/g, ""), "base64");
        return { buffer, mime, ext };
      }

      return {
        buffer: Buffer.from(trimmed, "base64"),
        mime: fallbackMime,
        ext: fallbackExt,
      };
    };

    const appendImageField = (formDataInstance, fieldName, value, index = 0) => {
      const parsedImage = parseBase64ImageInput(value, "png", "image/png");
      if (!parsedImage || parsedImage.buffer.length === 0) return false;

      formDataInstance.append(fieldName, parsedImage.buffer, {
        filename: `input-${index + 1}.${parsedImage.ext}`,
        contentType: parsedImage.mime,
      });
      return true;
    };

    const formData = new FormData();
    formData.append('model', requestBody.model);
    formData.append('prompt', requestBody.prompt);

    const isGptImage2Edit = requestBody.model === "gpt-image-2";

    if (isGptImage2Edit) {
      if (requestBody.size) formData.append('size', requestBody.size);
      if (requestBody.quality) formData.append('quality', requestBody.quality);
      if (requestBody.output_format) formData.append('output_format', requestBody.output_format);
      if (requestBody.moderation) formData.append('moderation', requestBody.moderation);
      if (
        requestBody.output_format &&
        requestBody.output_format !== "png" &&
        requestBody.output_compression !== undefined &&
        requestBody.output_compression !== null
      ) {
        formData.append('output_compression', String(requestBody.output_compression));
      }

      const images = Array.isArray(requestBody.images)
        ? requestBody.images
        : requestBody.image
          ? [requestBody.image]
          : [];
      images.forEach((imageValue, index) => {
        appendImageField(formData, 'image[]', imageValue, index);
      });
    } else {
      if (requestBody.n) formData.append('n', String(requestBody.n));
      if (requestBody.size) formData.append('size', requestBody.size);
      if (requestBody.image_size) formData.append('image_size', requestBody.image_size);
      if (requestBody.aspect_ratio) formData.append('aspect_ratio', requestBody.aspect_ratio);

      if (requestBody.image) {
        appendImageField(formData, 'image', requestBody.image, 0);
      }
    }
    
    if (requestBody.mask) {
      const parsedMask = parseBase64ImageInput(requestBody.mask, "png", "image/png");
      if (parsedMask && parsedMask.buffer.length > 0) {
        formData.append('mask', parsedMask.buffer, {
          filename: `mask.${parsedMask.ext}`,
          contentType: parsedMask.mime,
        });
      }
    }

    const response = await requestWithRetry(
      () =>
        axios.post(
          `${UPSTREAM_URL}/v1/images/edits?async=true`,
          formData,
          {
            headers: {
              Authorization: userKey,
              ...formData.getHeaders()
            },
            timeout: 600000,
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 1, delayMs: 700, label: "edit" },
    );

    console.log("[Edit] Upstream response:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("[Edit] Error:", error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === "ECONNABORTED") {
      res.status(504).json({ error: "璇锋眰瓒呮椂锛岃绋嶅悗閲嶈瘯" });
    } else {
      res.status(500).json({ error: error.message || "缂栬緫璇锋眰澶辫触" });
    }
  }
});

// ==================== 鍥剧墖浠ｇ悊鎺ュ彛 (瑙ｅ喅 CORS) ====================
app.get("/api/proxy/image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("Url is required");

  // Validate URL to prevent arbitrary proxying if possible, or at least check protocol
  if (!imageUrl.startsWith('http')) {
    return res.status(400).send("Invalid URL protocol");
  }

  try {
    console.log("[Image Proxy] Fetching:", imageUrl.substring(0, 100) + "...");
    const response = await requestWithRetry(
      () =>
        axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          httpsAgent: SHARED_HTTPS_AGENT,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
          }
        }),
      { retries: 2, delayMs: 400, label: "image-proxy" },
    );

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Buffer is better for res.send
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error("[Image Proxy] Error:", error.message);
    res.status(500).send("Failed to proxy image: " + error.message);
  }
});

// ==================== 浠诲姟杞鎺ュ彛 ====================
app.get("/api/task/:taskId", pollingLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const { taskId } = req.params;

    const response = await requestWithRetry(
      () =>
        axios.get(
          `${UPSTREAM_URL}/v1/images/tasks/${taskId}`,
          {
            headers: {
              Authorization: userKey,
              "Content-Type": "application/json",
            },
            timeout: 10000,
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 2, delayMs: 350, label: "task-poll" },
    );

    res.json(response.data);
  } catch (error) {
    console.error("[Task Poll] Error:", error.message);

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: error.message || "浠诲姟鏌ヨ澶辫触" });
    }
  }
});

// ==================== Gemini 鍘熺敓鍥剧墖鐢熸垚鎺ュ彛 ====================
app.post("/api/gemini/generate", generateLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const requestBody = req.body;
    const { aspect_ratio, image_size, thinking_level, output_format } = requestBody;
    const model = requestBody.model || "gemini-3-pro-image-preview";
    const strictNativeConfig = requestBody.strict_native_config === true;
    
    // 鐏垫椿鎻愬彇鎻愮ず璇嶏細浼樺厛浠?contents 鎻愬彇锛屽厹搴曚粠 top-level prompt 鎻愬彇
    let prompt = requestBody.prompt;
    if (!prompt && requestBody.contents?.[0]?.parts) {
      const textPart = requestBody.contents[0].parts.find(p => !!p.text);
      if (textPart) prompt = textPart.text;
    }
    
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log(`[Gemini Generate] Model: ${model}, Prompt: ${prompt.substring(0, 30)}...`);

    // 鏋勫缓鏈€缁堝彂閫佺粰涓婃父鐨?parts
    const parts = [];
    parts.push({ text: prompt });

    // 1. 浠?top-level images 鎻愬彇
    if (requestBody.images && Array.isArray(requestBody.images)) {
      requestBody.images.forEach(img => {
        parts.push(processImagePart(img));
      });
    }

    // 2. 浠?contents 鎻愬彇 (鍓嶇 Line 2/3 浣跨敤姝ゆ牸寮?
    if (requestBody.contents?.[0]?.parts) {
      requestBody.contents[0].parts.forEach(p => {
        if (p.inlineData) {
          parts.push({
            inline_data: {
              mime_type: p.inlineData.mimeType || "image/jpeg",
              data: p.inlineData.data
            }
          });
        }
      });
    }

    // 杈呭姪鍑芥暟锛氬鐞嗗崟涓浘鐗囨暟鎹?
    function processImagePart(img) {
      let base64Data = img;
      let mimeType = "image/jpeg";
      if (typeof img === 'string' && img.startsWith("data:")) {
        const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
        }
      }
      return {
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      };
    }

    console.log(`[Gemini Generate] Total parts: ${parts.length} (Images: ${parts.length - 1})`);

    // 鏋勫缓 generationConfig锛坈amelCase = Google 瀹樻柟 REST 鏍煎紡锛?
    const finalImageSize = (requestBody.image_size || requestBody.imageSize || requestBody.generationConfig?.imageConfig?.imageSize || "1K").toUpperCase();
    const finalAspectRatio = requestBody.aspect_ratio || requestBody.aspectRatio || requestBody.generationConfig?.imageConfig?.aspectRatio || "1:1";
    const candidateCount = requestBody.n || requestBody.candidateCount || requestBody.generationConfig?.candidateCount || 1;

    const generationConfig = {
      response_modalities: output_format === 'IMAGE_ONLY' ? ["IMAGE"] : ["IMAGE", "TEXT"],
      candidate_count: candidateCount,
      image_config: {
        aspect_ratio: finalAspectRatio === "Smart" ? "1:1" : finalAspectRatio,
        image_size: finalImageSize
      }
    };

    const nativeBody = {
      contents: [
        {
          parts: parts,
        },
      ],
      generationConfig: generationConfig,
    };

    // 鎵撳嵃瀹為檯璇锋眰浣擄紙鑴辨晱鍥剧墖鏁版嵁锛?
    const debugBody = JSON.parse(JSON.stringify(nativeBody));
    if (debugBody.contents?.[0]?.parts) {
      debugBody.contents[0].parts = debugBody.contents[0].parts.map(p => {
        if (p.inline_data) return { inline_data: { mime_type: p.inline_data.mime_type, data: "[BASE64...]" } };
        return p;
      });
    }
    console.log(`[Gemini Generate] Model: ${model}, Endpoint: ${UPSTREAM_URL}/v1beta/models/${model}:generateContent`);
    console.log("[Gemini Generate] Native Payload:", JSON.stringify(debugBody, null, 2));

    const GEMINI_ENDPOINT = `${UPSTREAM_URL}/v1beta/models/${model}:generateContent`;

    let response;
    try {
      response = await axios.post(GEMINI_ENDPOINT, nativeBody, {
        headers: {
          Authorization: userKey,
          "Content-Type": "application/json",
        },
        timeout: 600000,
        httpsAgent: SHARED_HTTPS_AGENT,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (firstErr) {
      // 濡傛灉 snake_case 鏍煎紡澶辫触锛屽皾璇?camelCase 鏍煎紡
      if (firstErr.response?.status === 400) {
        console.log("[Gemini Generate] Request failed with 400, trying camelCase format...");
        const camelBody = {
          contents: nativeBody.contents,
          generationConfig: {
            responseModalities: output_format === 'IMAGE_ONLY' ? ["IMAGE"] : ["IMAGE", "TEXT"],
            imageConfig: {
               aspectRatio: finalAspectRatio === "Smart" ? "1:1" : finalAspectRatio,
               imageSize: finalImageSize
            }
          },
        };
        if (thinking_level) {
          camelBody.generationConfig.thinkingConfig = { thinkingLevel: thinking_level.toUpperCase() };
        }
        
        try {
          response = await axios.post(GEMINI_ENDPOINT, camelBody, {
            headers: { Authorization: userKey, "Content-Type": "application/json" },
            timeout: 600000,
            httpsAgent: SHARED_HTTPS_AGENT,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
        } catch (secondErr) {
          // 濡傛灉杩樻槸澶辫触锛屽皾璇曚笉甯?generationConfig
          if (secondErr.response?.status === 400) {
            if (strictNativeConfig) {
              console.warn("[Gemini Generate] strict_native_config=true, refuse fallback without generationConfig.");
              throw secondErr;
            }
            console.log("[Gemini Generate] camelCase also failed, trying without generationConfig...");
            const minimalBody = { contents: nativeBody.contents };
            response = await axios.post(GEMINI_ENDPOINT, minimalBody, {
              headers: { Authorization: userKey, "Content-Type": "application/json" },
              timeout: 600000,
              httpsAgent: SHARED_HTTPS_AGENT,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            });
          } else {
            throw secondErr;
          }
        }
      } else {
        throw firstErr;
      }
    }

    // 浠庡搷搴斾腑鎻愬彇鍥剧墖
    const candidates = response.data?.candidates;
    if (!candidates || candidates.length === 0) {
      return res.status(500).json({ error: "鐢熸垚澶辫触锛氭湭杩斿洖缁撴灉" });
    }

    const resultImages = [];
    let resultText = "";

    for (const candidate of candidates) {
      if (!candidate.content || !candidate.content.parts) continue;
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
          resultImages.push(dataUrl);
        } else if (part.inline_data && part.inline_data.data) {
          // 鍏煎 snake_case 鏍煎紡
          const mimeType = part.inline_data.mime_type || "image/png";
          const dataUrl = `data:${mimeType};base64,${part.inline_data.data}`;
          resultImages.push(dataUrl);
        } else if (part.text) {
          resultText += part.text;
        }
      }
    }

    if (resultImages.length === 0) {
      return res.status(500).json({
        error: "鐢熸垚澶辫触锛氭湭杩斿洖鍥剧墖",
        text: resultText || undefined,
      });
    }

    console.log(`[Gemini Generate] Success, ${resultImages.length} image(s) generated`);
    res.json({
      success: true,
      images: resultImages,
      text: resultText || undefined,
    });
  } catch (error) {
    console.error("[Gemini Generate] Error:", error.message);
    // 鎵撳嵃瀹屾暣鐨勪笂娓搁敊璇搷搴?
    if (error.response?.data) {
      console.error("[Gemini Generate] Upstream response:", JSON.stringify(error.response.data));
    }
    logger.error({
      timestamp: new Date().toISOString(),
      type: "Gemini Generate Error",
      message: error.message,
      status: error.response?.status,
      response: error.response?.data,
    });

    if (error.response) {
      const errData = error.response.data;
      const errMsg =
        errData?.error?.message ||
        (typeof errData === "string" ? errData : JSON.stringify(errData));
      res.status(error.response.status).json({ error: errMsg });
    } else if (error.code === "ECONNABORTED") {
      res.status(504).json({ error: "璇锋眰瓒呮椂锛岃绋嶅悗閲嶈瘯" });
    } else {
      res.status(500).json({ error: error.message || "Gemini 鐢熸垚璇锋眰澶辫触" });
    }
  }
});

// ==================== 瑙嗛鐢熸垚鎺ュ彛 ====================
app.post("/api/video/generate", generateLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || userKey.length < 10) {
      return res.status(401).json({ error: "鏃犳晥鐨?API Key" });
    }

    const requestBody = req.body;
    // Detailed File Logging
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "Video Request",
      keys: Object.keys(requestBody),
      has_image_url: !!requestBody.image_url,
      has_image: !!requestBody.image,
      prompt: requestBody.prompt,
      model: requestBody.model,
      options: {
        aspect_ratio: requestBody.aspect_ratio,
        hd: requestBody.hd,
        duration: requestBody.duration,
      },
    };

    logger.info(logEntry);

    console.log("[Video Generate] Proxying request:", {
      model: requestBody.model,
      prompt: requestBody.prompt?.substring(0, 50) + "...",
      hasImage: !!requestBody.image_url || !!requestBody.image,
    });

    // ---- Grok Video 鍙傛暟閲嶆槧灏?----
    // Grok 鐨?API 浣跨敤涓嶅悓鐨勫瓧娈靛悕锛岄渶瑕佸湪鏈嶅姟绔仛涓€娆¤浆鎹?
    const upstreamBody = { ...requestBody };
    if (upstreamBody.model && String(upstreamBody.model).startsWith('grok-video')) {
      // aspect_ratio -> ratio
      if (upstreamBody.aspect_ratio !== undefined) {
        upstreamBody.ratio = upstreamBody.aspect_ratio;
        delete upstreamBody.aspect_ratio;
      }
      // hd -> resolution (720P / 1080P)
      upstreamBody.resolution = upstreamBody.hd ? '1080P' : '720P';
      delete upstreamBody.hd;
      // duration -> integer
      if (upstreamBody.duration !== undefined) {
        upstreamBody.duration = parseInt(upstreamBody.duration, 10);
      }
      // image / image_url -> images array
      if (upstreamBody.image || upstreamBody.image_url) {
        upstreamBody.images = [upstreamBody.image || upstreamBody.image_url];
        delete upstreamBody.image;
        delete upstreamBody.image_url;
      }
      console.log("[Video Generate] Grok remapped body:", JSON.stringify(Object.keys(upstreamBody)));
    }

    const response = await requestWithRetry(
      () =>
        axios.post(
          `${UPSTREAM_URL}/v2/videos/generations`, // New V2 Endpoint
          upstreamBody,
          {
            headers: {
              Authorization: userKey,
              "Content-Type": "application/json",
            },
            timeout: 900000, // 900 绉?(15鍒嗛挓) 瓒呮椂
            httpsAgent: SHARED_HTTPS_AGENT,
          },
        ),
      { retries: 1, delayMs: 700, label: "video-generate" },
    );

    console.log("[Video Generate] Upstream response:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("[Video Generate] Error:", error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: error.message || "瑙嗛鐢熸垚璇锋眰澶辫触" });
    }
  }
});

// ==================== 瑙嗛浠诲姟杞鎺ュ彛 ====================
app.get("/api/video/task/:taskId", pollingLimiter, async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey) return res.status(401).json({ error: "鏃犳晥鐨?API Key" });

    const { taskId } = req.params;

    const url = `${UPSTREAM_URL}/v2/videos/generations/${taskId}`;
    console.log(`[Video Task Poll] Requesting: ${url}`);

    const response = await requestWithRetry(
      () =>
        axios.get(url, {
          headers: {
            Authorization: userKey,
            "Content-Type": "application/json",
          },
          timeout: 10000,
          httpsAgent: SHARED_HTTPS_AGENT,
        }),
      { retries: 2, delayMs: 350, label: "video-task-poll" },
    );

    logger.info({
      timestamp: new Date().toISOString(),
      type: "Poll Response",
      taskId,
      responsePreview: JSON.stringify(response.data).substring(0, 1000),
    });

    console.log(
      "[Video Task Poll] Response:",
      JSON.stringify(response.data).substring(0, 500),
    );
    res.json(response.data);
  } catch (error) {
    console.error("[Video Task Poll] Error:", error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: error.message || "瑙嗛浠诲姟鏌ヨ澶辫触" });
    }
  }
});

// ==================== 鎻愮ず璇嶄紭鍖栨帴鍙?====================
// Shared model fallback for prompt tools
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-po-preview",
  "gemini-3-flash-preview",
];

function buildGeminiGenerateEndpoint(model) {
  return `https://api.bltcy.ai/v1beta/models/${model}:generateContent`;
}

async function postGeminiWithFallback({
  models,
  payload,
  userKey,
  timeout,
  logTag,
  extraAxiosConfig = {},
}) {
  let lastError;
  for (const model of models) {
    const endpoint = buildGeminiGenerateEndpoint(model);
    try {
      const response = await requestWithRetry(
        () =>
          axios.post(
            endpoint,
            payload,
            {
              headers: {
                Authorization: userKey,
                "Content-Type": "application/json",
              },
              timeout,
              httpsAgent: SHARED_HTTPS_AGENT,
              ...extraAxiosConfig,
            },
          ),
        { retries: 1, delayMs: 500, label: `${logTag}-${model}` },
      );

      if (model !== models[0]) {
        console.warn(`[${logTag}] Fallback succeeded with model: ${model}`);
      }

      return { response, model };
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.code || "unknown";
      console.warn(`[${logTag}] Model ${model} failed:`, status);
    }
  }

  throw lastError;
}

app.post("/api/optimize-prompt", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || String(userKey).length < 10) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    const { prompt, type = "IMAGE" } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const geminiModels = [...GEMINI_FALLBACK_MODELS];
    const isVideo = String(type).toUpperCase() === "VIDEO";
    const systemInstruction = isVideo
      ? "You are a professional video prompt optimizer. Return exactly 3 Chinese prompt options in JSON array format: [{\"style\":\"...\",\"prompt\":\"...\"}]. No markdown."
      : "You are a professional image prompt optimizer. Return exactly 3 Chinese prompt options in JSON array format: [{\"style\":\"...\",\"prompt\":\"...\"}]. No markdown.";

    const { response, model: usedModel } = await postGeminiWithFallback({
      models: geminiModels,
      payload: {
        contents: [{ parts: [{ text: String(prompt) }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      },
      userKey,
      timeout: 30000,
      logTag: "Optimize",
    });

    if (usedModel !== geminiModels[0]) {
      console.log(`[Optimize] Fallback model in use: ${usedModel}`);
    }

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(500).json({ error: "Optimize failed: empty response" });
    }

    let options;
    try {
      let cleaned = String(rawText).trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();
      options = JSON.parse(cleaned);
      if (!Array.isArray(options) || options.length === 0) throw new Error("Invalid options format");
    } catch (parseError) {
      return res.json({
        success: true,
        options: [{ style: "优化结果", prompt: String(rawText).trim() }],
      });
    }

    return res.json({ success: true, options });
  } catch (error) {
    console.error("[Optimize] Error:", error.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data?.error?.message || "Optimize request failed" });
    }
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Optimize request timeout" });
    }
    return res.status(500).json({ error: error.message || "Optimize request failed" });
  }
});

// ==================== Reverse Prompt API ====================
app.post("/api/reverse-prompt", async (req, res) => {
  try {
    const userKey = req.headers["authorization"];
    if (!userKey || String(userKey).length < 10) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    const image = req.body?.image;
    if (!image) {
      return res.status(400).json({ error: "Image is required" });
    }

    const base64Image = String(image).replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    const geminiModels = [...GEMINI_FALLBACK_MODELS];
    const systemInstruction =
      "You are a senior visual designer. Analyze the input image and output one detailed Chinese generation prompt. Output plain text only.";

    const { response, model: usedModel } = await postGeminiWithFallback({
      models: geminiModels,
      payload: {
        contents: [
          {
            parts: [
              { text: "Generate one detailed Chinese prompt from this image." },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image,
                },
              },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      },
      userKey,
      timeout: 300000,
      logTag: "Reverse",
      extraAxiosConfig: {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    });

    if (usedModel !== geminiModels[0]) {
      console.log(`[Reverse] Fallback model in use: ${usedModel}`);
    }

    const resultPrompt = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultPrompt) {
      return res.status(500).json({ error: "Reverse failed: empty response" });
    }

    return res.json({ success: true, prompt: String(resultPrompt).trim() });
  } catch (error) {
    console.error("[Reverse] Error:", error.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data?.error?.message || "Reverse request failed" });
    }
    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Reverse request timeout" });
    }
    return res.status(500).json({ error: error.message || "Reverse request failed" });
  }
});

// ==================== 闈欐€佹枃浠舵湇鍔?====================
// ==================== 鍏憡绯荤粺 API ====================
const ANNOUNCEMENT_FILE = path.join(__dirname, 'announcement.json');
const ANNOUNCEMENT_UPLOAD_ROOT = path.join(__dirname, 'uploads');
const ANNOUNCEMENT_UPLOAD_DIR = path.join(ANNOUNCEMENT_UPLOAD_ROOT, 'announcements');
const ANNOUNCEMENT_ADMIN_API_KEY =
  process.env.ANNOUNCEMENT_ADMIN_API_KEY ||
  "sk-K9OJf52OughwT8vizrDKJpvMebzutpbKVXxxhYe8EZFF0nm7";
const sortAnnouncements = (items = []) =>
  [...items].sort((a, b) => {
    const ap = a?.pinned === true ? 1 : 0;
    const bp = b?.pinned === true ? 1 : 0;
    if (ap !== bp) return bp - ap; // pinned first
    return new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime();
  });

const normalizeAnnouncement = (item) => {
  const nowIso = new Date().toISOString();
  const imageList = Array.isArray(item?.images)
    ? item.images
        .map((url) => String(url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('/uploads/'))
    : [];
  return {
    id: String(item?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    date: item?.date || nowIso,
    title: item?.title || "系统公告",
    content: item?.content || "",
    active: item?.active === true,
    pinned: item?.pinned === true,
    images: imageList
  };
};
const readAnnouncementList = () => {
  if (!fs.existsSync(ANNOUNCEMENT_FILE)) return [];
  const data = fs.readFileSync(ANNOUNCEMENT_FILE, 'utf8').trim();
  if (!data) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    console.error("[Announcement] Parse Error:", error);
    return [];
  }
  let items = [];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && Array.isArray(parsed.items)) {
    items = parsed.items;
  } else if (parsed && typeof parsed === 'object') {
    items = [parsed];
  }
  return items
    .map(normalizeAnnouncement)
    .filter((item) => item.content && String(item.content).trim().length > 0);
};
const writeAnnouncementList = (items) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeAnnouncement);
  const sorted = sortAnnouncements(normalized);
  fs.writeFileSync(ANNOUNCEMENT_FILE, JSON.stringify(sorted, null, 2), 'utf8');
  return sorted;
};
const verifyAnnouncementAdmin = (req) => {
  const userKey = String(req.headers["authorization"] || "").trim();
  if (!userKey) {
    return { ok: false, status: 401, error: "请先配置 API Key" };
  }
  if (userKey !== ANNOUNCEMENT_ADMIN_API_KEY) {
    return { ok: false, status: 401, error: "管理员 API Key 无效" };
  }
  return { ok: true };
};

const parseDataUrlImage = (value) => {
  const raw = String(value || "").trim();
  const m = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  const extMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extMap[mime];
  if (!ext) return null;
  const base64 = m[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return null;
  return { mime, ext, buffer };
};

// Admin image upload for announcements (supports multiple base64 data URLs)
app.post("/api/announcement/images", (req, res) => {
  try {
    const auth = verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) {
      return res.status(400).json({ error: "请至少上传一张图片" });
    }
    if (images.length > 9) {
      return res.status(400).json({ error: "最多上传 9 张图片" });
    }

    fs.mkdirSync(ANNOUNCEMENT_UPLOAD_DIR, { recursive: true });

    const urls = [];
    for (let i = 0; i < images.length; i++) {
      const parsed = parseDataUrlImage(images[i]);
      if (!parsed) {
        return res.status(400).json({ error: `第 ${i + 1} 张图片格式无效` });
      }
      // 10MB per image
      if (parsed.buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: `第 ${i + 1} 张图片超过 10MB` });
      }
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i + 1}.${parsed.ext}`;
      const filePath = path.join(ANNOUNCEMENT_UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, parsed.buffer);
      urls.push(`/uploads/announcements/${filename}`);
    }

    return res.json({ success: true, urls });
  } catch (error) {
    console.error("[Announcement] Upload Image Error:", error);
    return res.status(500).json({ error: "公告图片上传失败" });
  }
});
// ???????????? active?????? ?all=1 ?????
app.get("/api/announcements", announcementLimiter, (req, res) => {
  try {
    const allItems = sortAnnouncements(readAnnouncementList());
    const wantsAll = String(req.query?.all || "").toLowerCase() === '1' || String(req.query?.all || "").toLowerCase() === 'true';
    if (wantsAll) {
      const auth = verifyAnnouncementAdmin(req);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    }

    const search = String(req.query?.search || "").trim().toLowerCase();
    const pageRaw = Number.parseInt(String(req.query?.page || "1"), 10);
    const pageSizeRaw = Number.parseInt(String(req.query?.pageSize || "10"), 10);
    const page = Number.isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);
    const pageSize = Number.isNaN(pageSizeRaw) ? 10 : Math.min(50, Math.max(1, pageSizeRaw));

    const visibilityFiltered = wantsAll ? allItems : allItems.filter((item) => item.active);
    const searched = search
      ? visibilityFiltered.filter((item) =>
          `${item.title || ""} ${item.content || ""}`.toLowerCase().includes(search)
        )
      : visibilityFiltered;

    const total = searched.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const items = searched.slice(start, start + pageSize);

    return res.json({
      items,
      total,
      page: safePage,
      pageSize,
      totalPages,
      search
    });
  } catch (error) {
    console.error("[Announcement] List Error:", error);
    res.status(500).json({ error: "无法读取公告列表" });
  }
});

// Legacy single announcement endpoint
app.get("/api/announcement", announcementLimiter, (req, res) => {
  try {
    const activeItems = sortAnnouncements(readAnnouncementList().filter((item) => item.active));
    if (activeItems.length === 0) {
      return res.json({ active: false, content: "", id: "", title: "", date: "", pinned: false });
    }
    res.json(activeItems[0]);
  } catch (error) {
    console.error("[Announcement] Read Error:", error);
    res.status(500).json({ error: "无法读取公告数据" });
  }
});
// ???? (Admin)
app.post("/api/announcement", (req, res) => {
  try {
    const auth = verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { content, title, active, pinned, images } = req.body;
    const safeContent = String(content || "").trim();
    if (!safeContent) {
      return res.status(400).json({ error: "公告内容不能为空" });
    }
    const newAnnouncement = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
      title: String(title || "系统公告"),
      content: safeContent,
      active: active === true,
      pinned: pinned === true,
      images: Array.isArray(images) ? images : []
    };
    const allItems = readAnnouncementList();
    const nextItems = writeAnnouncementList([newAnnouncement, ...allItems]);
    console.log("[Announcement] Created:", newAnnouncement.id);
    res.json({ success: true, announcement: newAnnouncement, items: nextItems });
  } catch (error) {
    console.error("[Announcement] Write Error:", error);
    res.status(500).json({ error: "发布公告失败" });
  }
});

// Update announcement fields (Admin) - supports pinned/active/title/content
app.patch("/api/announcement/:id", (req, res) => {
  try {
    const auth = verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const targetId = String(req.params.id || "");
    if (!targetId) {
      return res.status(400).json({ error: "缺少公告 ID" });
    }

    const allItems = readAnnouncementList();
    const idx = allItems.findIndex((item) => item.id === targetId);
    if (idx < 0) {
      return res.status(404).json({ error: "公告不存在或已删除" });
    }

    const current = normalizeAnnouncement(allItems[idx]);
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "pinned")) {
      next.pinned = req.body.pinned === true;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "active")) {
      next.active = req.body.active === true;
    }
    if (typeof req.body?.title === "string") {
      next.title = req.body.title.trim() || current.title;
    }
    if (typeof req.body?.content === "string") {
      const content = req.body.content.trim();
      if (!content) return res.status(400).json({ error: "公告内容不能为空" });
      next.content = content;
    }
    if (Array.isArray(req.body?.images)) {
      next.images = req.body.images;
    }
    next.date = new Date().toISOString();

    const merged = [...allItems];
    merged[idx] = next;
    const items = writeAnnouncementList(merged);

    return res.json({ success: true, announcement: next, items });
  } catch (error) {
    console.error("[Announcement] Patch Error:", error);
    res.status(500).json({ error: "更新公告失败" });
  }
});
// ???? (Admin)
app.delete("/api/announcement/:id", (req, res) => {
  try {
    const auth = verifyAnnouncementAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const targetId = String(req.params.id || "");
    if (!targetId) {
      return res.status(400).json({ error: "缺少公告 ID" });
    }
    const allItems = readAnnouncementList();
    const nextItems = allItems.filter((item) => item.id !== targetId);
    if (nextItems.length === allItems.length) {
      return res.status(404).json({ error: "公告不存在或已删除" });
    }
    writeAnnouncementList(nextItems);
    console.log("[Announcement] Deleted:", targetId);
    res.json({ success: true, deletedId: targetId, items: nextItems });
  } catch (error) {
    console.error("[Announcement] Delete Error:", error);
    res.status(500).json({ error: "删除公告失败" });
  }
});

// ==================== Static Files ====================
app.use('/uploads', express.static(ANNOUNCEMENT_UPLOAD_ROOT));
app.use(express.static(path.join(__dirname, 'dist')));

// ==================== Health Check ====================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Handle React routing, return all requests to React app
// MUST be the last route
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`   Upstream API: ${UPSTREAM_URL}`);
});
