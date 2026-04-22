import { compressImageToDataUrl } from './treeAnalysis.js';

const SAM3_LITETEXT_URL = import.meta.env.VITE_SAM3_LITETEXT_URL ||
    'https://web-ar-alavar-poc-fastapi-production.up.railway.app/sam3-litetext/segment';
const SAM3_LITETEXT_CLIENT_TOKEN = (
    import.meta.env.VITE_SAM3_LITETEXT_CLIENT_TOKEN ||
    import.meta.env.VITE_API_AUTH_TOKEN ||
    ''
).trim();
const SAM3_LITETEXT_MODEL = import.meta.env.VITE_SAM3_LITETEXT_MODEL || 'yonigozlan/sam3-litetext-s0';
const DEFAULT_THRESHOLD = Number(import.meta.env.VITE_SAM3_LITETEXT_THRESHOLD || 0.5);
const DEFAULT_MASK_THRESHOLD = Number(import.meta.env.VITE_SAM3_LITETEXT_MASK_THRESHOLD || 0.5);

const OUTPUT_KEYS = [
    'result',
    'results',
    'data',
    'output',
    'outputs',
    'model_output',
    'modelOutput'
];

const OVERLAY_KEYS = [
    'overlay',
    'overlay_image',
    'overlayImage',
    'mask_overlay',
    'maskOverlay',
    'segmentation_overlay',
    'segmentationOverlay',
    'visualization',
    'visualization_image',
    'visualizationImage'
];

const MASK_KEYS = [
    'mask',
    'masks',
    'segmentation',
    'binary_mask',
    'binaryMask'
];

const PALETTE = [
    [15, 92, 63],
    [210, 29, 20],
    [246, 161, 27],
    [105, 189, 208],
    [112, 76, 179],
    [201, 85, 42],
    [34, 116, 165],
    [88, 137, 55]
];

function boundedNumber(value, fallback, min, max) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, numeric));
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

function outputCandidates(output) {
    const candidates = [];
    const queue = [output];
    const seen = new Set();

    for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];

        if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) {
            continue;
        }

        seen.add(candidate);
        candidates.push(candidate);

        for (const key of OUTPUT_KEYS) {
            if (candidate[key] !== undefined) {
                queue.push(candidate[key]);
            }
        }
    }

    return candidates;
}

function readArrayValue(values, index) {
    return Array.isArray(values) ? values[index] : undefined;
}

function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null);
}

function asNumericScore(value) {
    if (Array.isArray(value)) {
        return asNumericScore(value[0]);
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function looksLikeMaskRows(value) {
    return Array.isArray(value) && Array.isArray(value[0]) && !Array.isArray(value[0][0]);
}

function normalizeSegment(segment, index, parent = {}) {
    if (segment && typeof segment === 'object' && !Array.isArray(segment)) {
        return {
            index,
            mask: firstDefined(...MASK_KEYS.map(key => segment[key])),
            score: asNumericScore(firstDefined(segment.score, segment.confidence, segment.logit, segment.pred_logit)),
            box: firstDefined(segment.box, segment.bbox, segment.pred_box),
            label: firstDefined(segment.label, segment.class_name, segment.name)
        };
    }

    return {
        index,
        mask: segment,
        score: asNumericScore(readArrayValue(parent.scores, index) ?? readArrayValue(parent.pred_logits, index)),
        box: readArrayValue(parent.boxes, index) ?? readArrayValue(parent.pred_boxes, index),
        label: readArrayValue(parent.labels, index)
    };
}

export function getSam3LiteTextSegments(output) {
    for (const candidate of outputCandidates(output)) {
        if (Array.isArray(candidate)) {
            if (looksLikeMaskRows(candidate)) {
                return [normalizeSegment(candidate, 0)];
            }

            return candidate.map((segment, index) => normalizeSegment(segment, index));
        }

        const segmentList = candidate.segments || candidate.instances || candidate.objects;

        if (Array.isArray(segmentList)) {
            return segmentList.map((segment, index) => normalizeSegment(segment, index, candidate));
        }

        if (Array.isArray(candidate.masks)) {
            if (looksLikeMaskRows(candidate.masks)) {
                return [normalizeSegment(candidate.masks, 0, candidate)];
            }

            return candidate.masks.map((mask, index) => normalizeSegment(mask, index, candidate));
        }
    }

    return [];
}

export function getSam3LiteTextOverlayUrl(output) {
    for (const candidate of outputCandidates(output)) {
        for (const key of OVERLAY_KEYS) {
            const value = candidate[key];

            if (typeof value === 'string' && (value.startsWith('data:image/') || value.startsWith('http'))) {
                return value;
            }
        }
    }

    return '';
}

function findNumericField(output, keys) {
    for (const candidate of outputCandidates(output)) {
        for (const key of keys) {
            const value = asNumericScore(candidate[key]);

            if (value !== undefined) {
                return value;
            }
        }
    }

    return undefined;
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
}

export function summarizeSam3LiteTextOutput(output) {
    const segments = getSam3LiteTextSegments(output);
    const explicitCount = findNumericField(output, ['num_objects', 'object_count', 'count']);
    const scores = segments
        .map(segment => asNumericScore(segment.score))
        .filter(score => score !== undefined);
    const rawPresence = findNumericField(output, ['presence_score', 'presence_probability', 'presence']);
    const presenceLogit = findNumericField(output, ['presence_logits', 'presence_logit']);

    return {
        objectCount: explicitCount !== undefined ? explicitCount : segments.length,
        bestScore: scores.length ? Math.max(...scores) : undefined,
        presenceScore: rawPresence !== undefined ? rawPresence : (presenceLogit !== undefined ? sigmoid(presenceLogit) : undefined),
        drawableMaskCount: segments.filter(segment => Boolean(decodeMask(segment.mask))).length
    };
}

function numberFromMaskValue(value) {
    if (value === true) {
        return 1;
    }

    if (value === false || value === null || value === undefined) {
        return 0;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0.5 ? 1 : 0;
}

function flattenRows(rows) {
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) {
        return null;
    }

    const height = rows.length;
    const width = rows[0].length;
    const data = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
        const row = rows[y];

        for (let x = 0; x < width; x += 1) {
            data[y * width + x] = numberFromMaskValue(row[x]);
        }
    }

    return { data, width, height };
}

function flattenValues(values, width, height) {
    if (!Array.isArray(values) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }

    const expectedLength = width * height;

    if (values.length < expectedLength) {
        return null;
    }

    const data = new Uint8Array(expectedLength);

    for (let index = 0; index < expectedLength; index += 1) {
        data[index] = numberFromMaskValue(values[index]);
    }

    return { data, width, height };
}

function decodeUncompressedRle(mask) {
    const counts = mask?.counts;
    const size = mask?.size || mask?.shape;

    if (!Array.isArray(counts) || !Array.isArray(size) || size.length < 2) {
        return null;
    }

    const height = Number(size[0]);
    const width = Number(size[1]);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    const data = new Uint8Array(width * height);
    let pointer = 0;
    let value = 0;

    for (const count of counts) {
        const runLength = Number(count);

        if (!Number.isFinite(runLength) || runLength < 0) {
            return null;
        }

        for (let runIndex = 0; runIndex < runLength && pointer < data.length; runIndex += 1) {
            const y = pointer % height;
            const x = Math.floor(pointer / height);
            data[y * width + x] = value;
            pointer += 1;
        }

        value = value ? 0 : 1;
    }

    return { data, width, height };
}

function decodeMask(mask) {
    if (!mask) {
        return null;
    }

    if (Array.isArray(mask)) {
        return flattenRows(mask);
    }

    if (typeof mask !== 'object') {
        return null;
    }

    for (const key of ['data', 'values', 'array', 'mask']) {
        const value = mask[key];

        if (Array.isArray(value) && Array.isArray(value[0])) {
            return flattenRows(value);
        }

        const width = Number(mask.width || mask.w || mask.shape?.[1] || mask.size?.[1]);
        const height = Number(mask.height || mask.h || mask.shape?.[0] || mask.size?.[0]);
        const flattened = flattenValues(value, width, height);

        if (flattened) {
            return flattened;
        }
    }

    return decodeUncompressedRle(mask);
}

export function drawSam3LiteTextMasks(canvas, output) {
    const decodedMasks = getSam3LiteTextSegments(output)
        .map((segment, index) => ({
            index,
            mask: decodeMask(segment.mask)
        }))
        .filter(item => item.mask);

    const [firstMask] = decodedMasks;

    if (!canvas || !firstMask) {
        return { drawn: false, count: 0 };
    }

    const { width, height } = firstMask.mask;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    const imageData = context.createImageData(width, height);

    for (const { index, mask } of decodedMasks.slice(0, 12)) {
        if (mask.width !== width || mask.height !== height) {
            continue;
        }

        const color = PALETTE[index % PALETTE.length];

        for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
            if (!mask.data[pixel]) {
                continue;
            }

            const offset = pixel * 4;
            imageData.data[offset] = color[0];
            imageData.data[offset + 1] = color[1];
            imageData.data[offset + 2] = color[2];
            imageData.data[offset + 3] = 132;
        }
    }

    context.putImageData(imageData, 0, 0);

    return {
        drawn: true,
        count: decodedMasks.length
    };
}

export async function analyzeSam3LiteTextPhoto(file, {
    text,
    threshold = DEFAULT_THRESHOLD,
    maskThreshold = DEFAULT_MASK_THRESHOLD,
    signal
} = {}) {
    const prompt = String(text || '').trim();

    if (!file) {
        throw new Error('Choose an image first.');
    }

    if (!file.type.startsWith('image/')) {
        throw new Error('Choose an image file to segment.');
    }

    if (!prompt) {
        throw new Error('Enter a segmentation prompt.');
    }

    const image = await compressImageToDataUrl(file);
    const headers = {
        'Content-Type': 'application/json'
    };

    if (SAM3_LITETEXT_CLIENT_TOKEN) {
        headers.Authorization = `Bearer ${SAM3_LITETEXT_CLIENT_TOKEN}`;
    }

    const response = await fetch(SAM3_LITETEXT_URL, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            image: image.dataUrl,
            text: prompt,
            prompt,
            model: SAM3_LITETEXT_MODEL,
            threshold: boundedNumber(threshold, DEFAULT_THRESHOLD, 0.01, 0.99),
            mask_threshold: boundedNumber(maskThreshold, DEFAULT_MASK_THRESHOLD, 0.01, 0.99),
            return_json: true
        })
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = errorDetail(body);

        if (response.status === 401 && !SAM3_LITETEXT_CLIENT_TOKEN) {
            throw new Error('SAM3-LiteText requires a backend auth token. Set VITE_SAM3_LITETEXT_CLIENT_TOKEN and try again.');
        }

        throw new Error(detail || `SAM3-LiteText request failed with status ${response.status}.`);
    }

    return {
        result: await response.json(),
        image,
        endpoint: SAM3_LITETEXT_URL,
        model: SAM3_LITETEXT_MODEL
    };
}
