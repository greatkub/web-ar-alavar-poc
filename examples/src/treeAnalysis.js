const API_BASE_URL = 'https://web-ar-alavar-poc-fastapi-production.up.railway.app';

const TREE_ANALYSIS_URL = import.meta.env.VITE_TREE_ANALYSIS_URL ||
    `${API_BASE_URL}/tree/analyze`;
const PLANT_AVATAR_PROMPT_URL = import.meta.env.VITE_PLANT_AVATAR_PROMPT_URL ||
    `${API_BASE_URL}/plant/avatar/prompt`;
const TREE_ANALYSIS_CLIENT_TOKEN = (
    import.meta.env.VITE_TREE_ANALYSIS_CLIENT_TOKEN ||
    import.meta.env.VITE_API_AUTH_TOKEN ||
    ''
).trim();
const TREE_IMAGE_MAX_WIDTH = Number(import.meta.env.VITE_TREE_IMAGE_MAX_WIDTH || 1280);
const TREE_IMAGE_JPEG_QUALITY = Number(import.meta.env.VITE_TREE_IMAGE_JPEG_QUALITY || 0.8);

function numericSetting(value, fallback, min, max) {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read this image. Try a JPEG or PNG photo.'));
        };

        image.src = url;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }

            reject(new Error('Could not compress the selected photo.'));
        }, type, quality);
    });
}

export function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read this file.'));
        reader.readAsDataURL(file);
    });
}

export async function compressImageToDataUrl(file, {
    maxWidth = TREE_IMAGE_MAX_WIDTH,
    quality = TREE_IMAGE_JPEG_QUALITY
} = {}) {
    const image = await loadImage(file);
    const widthLimit = numericSetting(maxWidth, 1280, 320, 2048);
    const jpegQuality = numericSetting(quality, 0.8, 0.45, 0.92);
    const scale = Math.min(1, widthLimit / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
    const dataUrl = await fileToDataUrl(blob);

    return {
        dataUrl,
        width,
        height,
        originalBytes: file.size,
        compressedBytes: blob.size
    };
}

function errorDetail(body) {
    if (!body) {
        return '';
    }

    if (typeof body === 'string') {
        return body;
    }

    if (typeof body.detail === 'string') {
        return body.detail;
    }

    if (body.detail?.message) {
        return body.detail.message;
    }

    if (body.error) {
        return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    }

    if (body.message) {
        return body.message;
    }

    return '';
}

export async function analyzeTreePhoto(file, { signal } = {}) {
    const image = await compressImageToDataUrl(file);
    const headers = {
        'Content-Type': 'application/json'
    };

    if (TREE_ANALYSIS_CLIENT_TOKEN) {
        headers.Authorization = `Bearer ${TREE_ANALYSIS_CLIENT_TOKEN}`;
    }

    const response = await fetch(TREE_ANALYSIS_URL, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            image: image.dataUrl,
            model: 'qwen3.6-flash',
            region: 'international',
            enable_thinking: true,
            use_image_search: false
        })
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = errorDetail(body);

        if (response.status === 401 && !TREE_ANALYSIS_CLIENT_TOKEN) {
            throw new Error('Tree analysis requires a backend auth token. Set VITE_TREE_ANALYSIS_CLIENT_TOKEN and try again.');
        }

        throw new Error(detail || `Tree analysis failed with status ${response.status}.`);
    }

    return {
        result: await response.json(),
        image
    };
}

export async function fetchPlantAvatarPrompt(treeResult, { language = 'en', signal } = {}) {
    const plantName = treeResult.tree_name || treeResult.tree_species || 'Unknown plant';
    const carbonKgPerYear = Number(treeResult.carbon_credit_estimate) || 0;

    const headers = {
        'Content-Type': 'application/json'
    };

    if (TREE_ANALYSIS_CLIENT_TOKEN) {
        headers.Authorization = `Bearer ${TREE_ANALYSIS_CLIENT_TOKEN}`;
    }

    const response = await fetch(PLANT_AVATAR_PROMPT_URL, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            plant_name: plantName,
            carbon_kg_per_year: carbonKgPerYear,
            language
        })
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = errorDetail(body);
        throw new Error(detail || `Avatar prompt fetch failed with status ${response.status}.`);
    }

    return response.json();
}
