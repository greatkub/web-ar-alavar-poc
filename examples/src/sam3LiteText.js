import { compressImageToDataUrl } from './treeAnalysis.js';

const BROWSER_SEGMENTATION_MODEL = import.meta.env.VITE_BROWSER_SEGMENTATION_MODEL ||
    'Xenova/segformer-b0-finetuned-ade-512-512';
const BROWSER_SEGMENTATION_DEVICE = import.meta.env.VITE_BROWSER_SEGMENTATION_DEVICE || 'auto';
const BROWSER_SEGMENTATION_LOCAL_MODEL_PATH = import.meta.env.VITE_BROWSER_SEGMENTATION_LOCAL_MODEL_PATH ||
    '/models/';
const BROWSER_SEGMENTATION_CACHE_KEY = import.meta.env.VITE_BROWSER_SEGMENTATION_CACHE_KEY ||
    'web-ar-browser-segmentation-v2';
const BROWSER_SEGMENTATION_DTYPE = import.meta.env.VITE_BROWSER_SEGMENTATION_DTYPE || 'fp32';
const BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS =
    String(import.meta.env.VITE_BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS || 'false').toLowerCase() === 'true';
const BROWSER_SEGMENTATION_IMAGE_MAX_WIDTH = Number(import.meta.env.VITE_BROWSER_SEGMENTATION_IMAGE_MAX_WIDTH || 960);
const BROWSER_SEGMENTATION_IMAGE_QUALITY = Number(import.meta.env.VITE_BROWSER_SEGMENTATION_IMAGE_JPEG_QUALITY || 0.82);
const DEFAULT_THRESHOLD = Number(import.meta.env.VITE_BROWSER_SEGMENTATION_THRESHOLD || 0.5);
const DEFAULT_MASK_THRESHOLD = Number(import.meta.env.VITE_BROWSER_SEGMENTATION_MASK_THRESHOLD || 0.5);
const DEFAULT_MIN_AREA_RATIO = Number(import.meta.env.VITE_BROWSER_SEGMENTATION_MIN_AREA_RATIO || 0.015);

const VEGETATION_LABELS = new Map([
    ['tree', ['tree']],
    ['trees', ['tree']],
    ['plant', ['plant', 'tree', 'grass', 'flower', 'palm']],
    ['plants', ['plant', 'tree', 'grass', 'flower', 'palm']],
    ['grass', ['grass']],
    ['flower', ['flower']],
    ['flowers', ['flower']],
    ['palm', ['palm']],
    ['bush', ['plant', 'tree']],
    ['bushes', ['plant', 'tree']],
    ['shrub', ['plant', 'tree']],
    ['shrubs', ['plant', 'tree']],
    ['leaf', ['plant', 'tree', 'grass', 'flower', 'palm']],
    ['leaves', ['plant', 'tree', 'grass', 'flower', 'palm']],
    ['foliage', ['plant', 'tree', 'grass', 'flower', 'palm']],
    ['vegetation', ['plant', 'tree', 'grass', 'flower', 'palm']]
]);

let transformersModulePromise = null;
const segmenterCache = new Map();

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

function hasWebGpu() {
    return Boolean(globalThis.navigator?.gpu && globalThis.isSecureContext);
}

function isIosBrowser() {
    const navigatorInfo = globalThis.navigator;

    if (!navigatorInfo) {
        return false;
    }

    const userAgent = navigatorInfo.userAgent || '';
    const platform = navigatorInfo.platform || '';
    const maxTouchPoints = Number(navigatorInfo.maxTouchPoints || 0);

    return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function canAutoUseWebGpu() {
    return hasWebGpu() && !isIosBrowser();
}

function configuredBrowserDevice() {
    return String(BROWSER_SEGMENTATION_DEVICE || 'auto').toLowerCase();
}

function resolveBrowserDevice() {
    const configuredDevice = configuredBrowserDevice();

    if (configuredDevice === 'auto' || configuredDevice === 'gpu') {
        return canAutoUseWebGpu() ? 'webgpu' : 'wasm';
    }

    if (configuredDevice === 'webgpu') {
        return 'webgpu';
    }

    if (configuredDevice === 'wasm' || configuredDevice === 'cpu') {
        return 'wasm';
    }

    return canAutoUseWebGpu() ? 'webgpu' : 'wasm';
}

function displayDevice(device) {
    return device === 'wasm' || device === 'cpu' ? 'WASM' : device.toUpperCase();
}

function isWebGpuForced() {
    return configuredBrowserDevice() === 'webgpu';
}

export function getOnDeviceSegmentationStatus() {
    const device = resolveBrowserDevice();

    return {
        mode: 'browser',
        webgpu: hasWebGpu(),
        webgpuAutoEnabled: canAutoUseWebGpu(),
        iosBrowser: isIosBrowser(),
        device,
        deviceLabel: displayDevice(device),
        model: BROWSER_SEGMENTATION_MODEL,
        localModelPath: BROWSER_SEGMENTATION_LOCAL_MODEL_PATH,
        allowRemoteModels: BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS,
        cacheKey: BROWSER_SEGMENTATION_CACHE_KEY,
        dtype: BROWSER_SEGMENTATION_DTYPE
    };
}

function abortError() {
    if (typeof DOMException !== 'undefined') {
        return new DOMException('Segmentation was cancelled.', 'AbortError');
    }

    const error = new Error('Segmentation was cancelled.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw abortError();
    }
}

async function loadTransformersModule() {
    if (!transformersModulePromise) {
        transformersModulePromise = import('@huggingface/transformers').then(module => {
            module.env.allowLocalModels = true;
            module.env.allowRemoteModels = BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS;
            module.env.localModelPath = BROWSER_SEGMENTATION_LOCAL_MODEL_PATH;
            module.env.cacheKey = BROWSER_SEGMENTATION_CACHE_KEY;
            return module;
        });
    }

    return transformersModulePromise;
}

async function loadSegmenter(device) {
    const key = `${BROWSER_SEGMENTATION_MODEL}:${device}`;
    const cached = segmenterCache.get(key);

    if (cached) {
        return cached;
    }

    const promise = loadTransformersModule()
        .then(({ pipeline }) => pipeline('image-segmentation', BROWSER_SEGMENTATION_MODEL, {
            device,
            dtype: BROWSER_SEGMENTATION_DTYPE,
            local_files_only: !BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS
        }))
        .catch(error => {
            segmenterCache.delete(key);
            throw error;
        });

    segmenterCache.set(key, promise);
    return promise;
}

function normalizeLabel(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function requestedLabelsFromPrompt(prompt) {
    const normalized = normalizeLabel(prompt);
    const words = normalized.split(/\s+/).filter(Boolean);
    const requested = new Set();

    for (const word of words) {
        const mappedLabels = VEGETATION_LABELS.get(word);

        if (mappedLabels) {
            mappedLabels.forEach(label => requested.add(label));
            continue;
        }

        requested.add(word);
    }

    if (!requested.size) {
        ['plant', 'tree', 'grass', 'flower', 'palm'].forEach(label => requested.add(label));
    }

    return requested;
}

function labelMatchesPrompt(label, promptLabels) {
    const normalized = normalizeLabel(label);

    if (!normalized) {
        return false;
    }

    for (const promptLabel of promptLabels) {
        if (normalized === promptLabel || normalized.includes(promptLabel) || promptLabel.includes(normalized)) {
            return true;
        }
    }

    return false;
}

function maskPixelValue(mask, pixel) {
    const channels = Number(mask?.channels || 1);
    const data = mask?.data;

    if (!data) {
        return 0;
    }

    if (channels === 1) {
        return Number(data[pixel] || 0) > 0 ? 1 : 0;
    }

    const offset = pixel * channels;
    let total = 0;

    for (let channel = 0; channel < channels; channel += 1) {
        total += Number(data[offset + channel] || 0);
    }

    return total > 0 ? 1 : 0;
}

function encodeRawImageMask(mask) {
    const width = Number(mask?.width);
    const height = Number(mask?.height);

    if (!mask?.data || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    const counts = [];
    let currentValue = 0;
    let runLength = 0;
    let area = 0;

    for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) {
            const pixel = y * width + x;
            const value = maskPixelValue(mask, pixel);

            if (value) {
                area += 1;
            }

            if (value === currentValue) {
                runLength += 1;
                continue;
            }

            counts.push(runLength);
            currentValue = value;
            runLength = 1;
        }
    }

    counts.push(runLength);

    return {
        rle: {
            counts,
            size: [height, width]
        },
        area
    };
}

function summarizePipelineSegment(segment, index, promptLabels) {
    const encoded = encodeRawImageMask(segment.mask);
    const label = segment.label || `segment-${index + 1}`;

    return {
        index,
        label,
        score: asNumericScore(segment.score),
        matched_prompt: labelMatchesPrompt(label, promptLabels),
        mask: encoded ? {
            width: Number(segment.mask.width),
            height: Number(segment.mask.height),
            channels: Number(segment.mask.channels || 1),
            area_pixels: encoded.area
        } : null
    };
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
    const isArrayLike = Array.isArray(values) || ArrayBuffer.isView(values);

    if (!isArrayLike || !Number.isFinite(width) || !Number.isFinite(height)) {
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

    const image = await compressImageToDataUrl(file, {
        maxWidth: BROWSER_SEGMENTATION_IMAGE_MAX_WIDTH,
        quality: BROWSER_SEGMENTATION_IMAGE_QUALITY
    });
    const promptLabels = requestedLabelsFromPrompt(prompt);
    const requestedDevice = resolveBrowserDevice();
    const normalizedThreshold = boundedNumber(threshold, DEFAULT_THRESHOLD, 0.01, 0.99);
    const normalizedMaskThreshold = boundedNumber(maskThreshold, DEFAULT_MASK_THRESHOLD, 0.01, 0.99);
    const minAreaRatio = boundedNumber(DEFAULT_MIN_AREA_RATIO, 0.015, 0, 0.5);
    let activeDevice = requestedDevice;
    let fallbackReason = '';

    throwIfAborted(signal);

    let segmenter;

    try {
        segmenter = await loadSegmenter(activeDevice);
    } catch (loadError) {
        if (activeDevice !== 'webgpu' || isWebGpuForced()) {
            throw loadError;
        }

        fallbackReason = loadError instanceof Error ? loadError.message : 'WebGPU model load failed.';
        activeDevice = 'wasm';
        segmenter = await loadSegmenter(activeDevice);
    }

    throwIfAborted(signal);

    let pipelineOutput;

    try {
        pipelineOutput = await segmenter(image.dataUrl, {
            threshold: normalizedThreshold,
            mask_threshold: normalizedMaskThreshold
        });
    } catch (runError) {
        if (activeDevice !== 'webgpu' || isWebGpuForced()) {
            throw runError;
        }

        fallbackReason = runError instanceof Error ? runError.message : 'WebGPU inference failed.';
        activeDevice = 'wasm';
        const wasmSegmenter = await loadSegmenter(activeDevice);
        pipelineOutput = await wasmSegmenter(image.dataUrl, {
            threshold: normalizedThreshold,
            mask_threshold: normalizedMaskThreshold
        });
    }

    throwIfAborted(signal);

    const allSegments = Array.isArray(pipelineOutput) ? pipelineOutput : [];
    const matchingSegments = allSegments
        .filter(segment => labelMatchesPrompt(segment.label, promptLabels))
        .map((segment, index) => {
            const encoded = encodeRawImageMask(segment.mask);
            const maskSize = encoded?.rle?.size || [];
            const maskArea = Number(maskSize[0] || 0) * Number(maskSize[1] || 0);
            const areaPixels = encoded?.area || 0;

            return {
                index,
                label: segment.label || `segment-${index + 1}`,
                score: asNumericScore(segment.score),
                mask: encoded?.rle || null,
                area_pixels: areaPixels,
                area_ratio: maskArea > 0 ? areaPixels / maskArea : 0
            };
        })
        .filter(segment => segment.mask)
        .filter(segment => segment.area_ratio >= minAreaRatio)
        .sort((left, right) => right.area_pixels - left.area_pixels);

    const compactOutput = {
        ok: true,
        runtime: 'browser',
        pipeline: 'Transformers.js image-segmentation',
        model: BROWSER_SEGMENTATION_MODEL,
        device: activeDevice,
        device_label: displayDevice(activeDevice),
        webgpu_available: hasWebGpu(),
        text: prompt,
        prompt,
        threshold: normalizedThreshold,
        mask_threshold: normalizedMaskThreshold,
        min_area_ratio: minAreaRatio,
        image_size: {
            width: image.width,
            height: image.height
        },
        requested_labels: Array.from(promptLabels),
        num_objects: matchingSegments.length,
        returned_objects: matchingSegments.length,
        has_objects: matchingSegments.length > 0,
        segments: matchingSegments,
        raw_model_output: {
            total_segments: allSegments.length,
            segments: allSegments.map((segment, index) => summarizePipelineSegment(segment, index, promptLabels))
        }
    };

    if (fallbackReason) {
        compactOutput.fallback_reason = fallbackReason;
    }

    return {
        result: compactOutput,
        image,
        endpoint: 'browser',
        model: BROWSER_SEGMENTATION_MODEL,
        device: activeDevice
    };
}
