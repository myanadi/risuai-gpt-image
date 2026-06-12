//@name GPT Image
//@display-name GPT Image
//@version 0.5.0
//@api 3.0
//@description 최근 AI 응답 1턴을 추출해 OpenAI(gpt-image-2 등)로 장면 이미지를 생성. LLM으로 장면을 태그로 정리(옵션) → 드래그 플로팅 창에 표시 → PNG 저장. 장면샷/1인샷 모드 지원, 화풍 참조 이미지 지원.

(async () => {
    // ── API 핸들 ─────────────────────────────────────────────────────
    const risuai = globalThis.risuai || globalThis.Risuai;
    if (!risuai) throw new Error('[GPT Image] RisuAI Plugin API v3 가 필요합니다.');

    const CFG_KEY = 'gptimage_config_v1';
    const JOB_KEY = 'gptimage_job_v1';
    const STALE_MS = 7 * 60 * 1000;

    // ── 기본 프리셋 ───────────────────────────────────────────────────
    // [CHANGED v0.4] 모든 프리셋이 {bg}{char}{outfit}{comp} 4칸 자리표시자 구조로 통일됨.
    // "일상 (2인)" 프리셋은 삭제됨 — 1인/2인 구분은 모드 시스템(장면샷/1인샷)이 담당.
    const PRESET_DAILY = [
        'score_9, score_8_up, score_7_up, masterpiece, best quality,',
        '[배경: {bg}],',
        '[캐릭터: {char}],',
        '[복식: {outfit}],',
        '[구도: {comp}],',
        '[화풍: korean manhwa style, clean cel shading, muted soft colors, slice of life],',
        'natural soft lighting, film grain, no text, no watermark, soft focus, subtle details, cinematic mood'
    ].join('\n');

    const PRESET_ROPAN = [
        'score_9, score_8_up, score_7_up, masterpiece, best quality, ultra detailed,',
        '[배경: {bg}],',
        '[캐릭터: {char}],',
        '[복식: {outfit}],',
        '[구도: {comp}],',
        '[화풍: anime style, elegant, shoujo, intricate details, watercolor style, cinematic lighting],',
        'no text, no watermark, crisp lines, clean'
    ].join('\n');

    const PRESET_SEMIREAL = [
        'score_9, score_8_up, score_7_up, masterpiece, best quality, ultra detailed,',
        '[배경: {bg}],',
        '[캐릭터: {char}],',
        '[복식: {outfit}],',
        '[구도: {comp}],',
        '[화풍: semi-realistic, 2.5D, digital painting, detailed realistic skin texture, muted colors, soft cinematic lighting],',
        'no text, no watermark, soft blending, painterly'
    ].join('\n');

    const PRESET_REAL = [
        'score_9, score_8_up, score_7_up, masterpiece, best quality, ultra detailed, photorealistic, raw photo,',
        '[배경: {bg}],',
        '[캐릭터: {char}],',
        '[복식: {outfit}],',
        '[구도: {comp}],',
        '[화풍: iPhone snapshot aesthetic, casual phone photography, low light, moody lighting, realistic skin texture, slight film grain, flash off, true-to-life colors],',
        'no text, no watermark, sharp focus, natural soft shadows'
    ].join('\n');

    // ── 기본 LLM 정리 지시문 (모드별) ─────────────────────────────────
    // [NEW v0.4] 모드별로 별도 지시문. 호수가 모드마다 따로 편집 가능.
    const DEFAULT_LLM_PROMPT_SCENE = [
        'You convert a Korean roleplay scene into image-generation tags.',
        '',
        'Read the scene and pick the single most visually striking moment.',
        'Output EXACTLY these four lines and nothing else:',
        'bg: <background and setting tags>',
        'char: <character count and appearance tags, e.g. 1man 1woman>',
        'outfit: <clothing tags>',
        'comp: <composition, pose, camera angle, expression tags>',
        '',
        'Rules:',
        '- English Danbooru-style tags only, comma-separated within each line.',
        '- Keep the four line labels (bg:, char:, outfit:, comp:) exactly.',
        '- Ignore dialogue, inner thoughts, and time passing.',
        '- Do NOT add art style, quality tags, or "no text" — those are added separately.',
        '',
        'Scene:',
        '{scene}'
    ].join('\n');

    const DEFAULT_LLM_PROMPT_SOLO = [
        'You convert a Korean roleplay scene into image-generation tags for a SOLO portrait.',
        '',
        'Read the scene and focus on ONE single character — the most prominent one in the moment.',
        'Output EXACTLY these four lines and nothing else:',
        'bg: <simple, minimal, or softly blurred background tags — keep this short>',
        'char: <single character appearance tags; MUST include "solo" and either "1girl" or "1boy">',
        'outfit: <clothing tags for that one character>',
        'comp: <close-up, upper body shot, or portrait composition; expression and pose>',
        '',
        'Rules:',
        '- English Danbooru-style tags only, comma-separated within each line.',
        '- Keep the four line labels (bg:, char:, outfit:, comp:) exactly.',
        '- char MUST include "solo" and either "1girl" or "1boy".',
        '- bg should be minimal — simple background, blurred background, or subtle setting only.',
        '- Ignore other characters in the scene.',
        '- Do NOT add art style, quality tags, or "no text" — those are added separately.',
        '',
        'Scene:',
        '{scene}'
    ].join('\n');

    const DEFAULT_CONFIG = {
        apiKey: '',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'medium',
        endpoint: 'https://api.openai.com/v1/images/generations',
        editsEndpoint: 'https://api.openai.com/v1/images/edits', // [NEW v0.4]
        presets: [
            { name: '일상', body: PRESET_DAILY },
            { name: '로판', body: PRESET_ROPAN },
            { name: '반실사', body: PRESET_SEMIREAL },
            { name: '실사', body: PRESET_REAL }
        ],
        activePreset: 0,
        llmMode: 'off',                          // 'off' | 'main' | 'sub'
        // [NEW v0.4] 모드 시스템
        mode: 'scene',                           // 'scene' | 'solo'
        llmPrompts: {
            scene: DEFAULT_LLM_PROMPT_SCENE,
            solo:  DEFAULT_LLM_PROMPT_SOLO
        },
        // [v0.5] 참조 이미지 3슬롯 (base64 data URL)
        //  char    = 캐릭터 외모 참조
        //  persona = 페르소나 외모 참조
        //  style   = 화풍 참조
        // 각 슬롯이 비어있으면 그 슬롯은 요청에서 빠짐.
        refImages: { char: '', persona: '', style: '' },
        // [DEPRECATED v0.4] 하위호환: 옛 styleRefImage 가 저장돼 있으면 로드 시 refImages.style 로 마이그레이션
        styleRefImage: ''
    };

    let config = { ...DEFAULT_CONFIG };

    // ── 설정 로드/저장 ────────────────────────────────────────────────
    async function loadConfig() {
        try {
            const raw = await risuai.pluginStorage.getItem(CFG_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                config = { ...DEFAULT_CONFIG, ...saved };
                if (!Array.isArray(config.presets) || !config.presets.length) {
                    config.presets = DEFAULT_CONFIG.presets.map(p => ({ ...p }));
                }
                // [NEW v0.4] 구버전 llmPrompt 단일 필드 → llmPrompts.scene 으로 마이그레이션
                if (!config.llmPrompts || typeof config.llmPrompts !== 'object') {
                    config.llmPrompts = { ...DEFAULT_CONFIG.llmPrompts };
                    if (saved.llmPrompt) config.llmPrompts.scene = saved.llmPrompt;
                }
                if (!config.llmPrompts.scene) config.llmPrompts.scene = DEFAULT_LLM_PROMPT_SCENE;
                if (!config.llmPrompts.solo)  config.llmPrompts.solo  = DEFAULT_LLM_PROMPT_SOLO;
                if (!config.mode) config.mode = 'scene';
                // [v0.5] 참조 이미지 3슬롯 정규화 + 옛 styleRefImage 마이그레이션
                if (!config.refImages || typeof config.refImages !== 'object') {
                    config.refImages = { char: '', persona: '', style: '' };
                }
                if (typeof config.refImages.char    !== 'string') config.refImages.char    = '';
                if (typeof config.refImages.persona !== 'string') config.refImages.persona = '';
                if (typeof config.refImages.style   !== 'string') config.refImages.style   = '';
                if (config.styleRefImage && !config.refImages.style) {
                    config.refImages.style = config.styleRefImage;
                }
                config.styleRefImage = ''; // 마이그레이션 후 비움
            }
        } catch (e) { console.warn('[GPT Image] config load failed', e); }
    }
    async function saveConfig() {
        try { await risuai.pluginStorage.setItem(CFG_KEY, JSON.stringify(config)); }
        catch (e) { console.warn('[GPT Image] config save failed', e); }
    }

    // ── job 저장/로드 ─────────────────────────────────────────────────
    async function loadJob() {
        try { const raw = await risuai.pluginStorage.getItem(JOB_KEY); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
    }
    async function saveJob(job) {
        try { await risuai.pluginStorage.setItem(JOB_KEY, JSON.stringify(job)); }
        catch (e) { console.warn('[GPT Image] job save failed', e); }
    }

    // ── 기록(history) ─────────────────────────────────────────────────
    const HIST_KEY = 'gptimage_history_v1';
    const HIST_MAX = 20;

    async function loadHistory() {
        try { const raw = await risuai.pluginStorage.getItem(HIST_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }
    async function addHistory(entry) {
        try {
            let list = await loadHistory();
            list.unshift(entry);
            if (list.length > HIST_MAX) list = list.slice(0, HIST_MAX);
            await risuai.pluginStorage.setItem(HIST_KEY, JSON.stringify(list));
        } catch (e) { console.warn('[GPT Image] history save failed', e); }
    }
    async function clearHistory() {
        try { await risuai.pluginStorage.setItem(HIST_KEY, JSON.stringify([])); }
        catch (e) { /* noop */ }
    }

    // 비용 추정표
    function estimateCost(quality, size) {
        const q = (quality || 'medium').toLowerCase();
        const isSquare = /^1024x1024$/.test((size || '').trim());
        const table = isSquare
            ? { low: 0.006, medium: 0.053, high: 0.211 }
            : { low: 0.005, medium: 0.041, high: 0.165 };
        return table[q] ?? table.medium;
    }

    // ── 최근 AI 응답 1개 추출 ─────────────────────────────────────────
    async function getLastAiMessage() {
        const ci = await risuai.getCurrentCharacterIndex();
        const chi = await risuai.getCurrentChatIndex();
        const chat = await risuai.getChatFromIndex(ci, chi);
        if (!chat) throw new Error('현재 채팅을 읽지 못했습니다.');
        const msgs = chat.message || chat.messages || [];
        if (!msgs.length) throw new Error('채팅에 메시지가 없습니다.');
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (!m || m.role === 'user') continue;
            const body = (m.data ?? m.content ?? '').toString().trim();
            if (body) return body;
        }
        throw new Error('최근 AI 응답을 찾지 못했습니다.');
    }

    function cleanScene(s) {
        return s.replace(/<[^>]+>/g, ' ').replace(/[*_`>#~]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    }

    // ── LLM 정리 (옵션) ───────────────────────────────────────────────
    // [CHANGED v0.4] 현재 모드(scene/solo)에 맞는 지시문 사용. signal 받아 abort 가능.
    async function refineScene(sceneText, signal) {
        if (config.llmMode === 'off') return null;
        if (typeof risuai.runLLMModel !== 'function') {
            console.warn('[GPT Image] runLLMModel 미지원 → 턴 그대로 사용');
            return null;
        }
        try {
            const promptTemplate = (config.llmPrompts && config.llmPrompts[config.mode])
                || DEFAULT_LLM_PROMPT_SCENE;
            let prompt = promptTemplate.replace(/\{scene\}/g, sceneText);
            // [v0.5] 캐릭터 or 페르소나 참조 이미지가 있으면 외모 묘사 빼게 추가 지시
            const refs = collectRefImages();
            const hasPersonRef = refs.some(r => r.slot === 'char' || r.slot === 'persona');
            if (hasPersonRef) {
                prompt += '\n\nAdditional rule for this request: Reference photos will be provided for the characters. For the "char:" line, output ONLY the character count (e.g. "1man 1woman" or "1man solo") — do NOT describe facial features, hair, eye color, or any appearance details. Outfit, pose, expression, and background must still be derived from the scene as usual.';
            }
            const opts = {
                messages: [{ role: 'user', content: prompt }],
                mode: config.llmMode === 'sub' ? 'submodel' : 'model'
            };
            // runLLMModel 자체는 signal 미지원 — 호출 후 abort 체크
            const res = await risuai.runLLMModel(opts);
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const out = (res && (res.content ?? res.message ?? res.text ?? res.data ?? res.result)) || '';
            const parts = parseLLMParts(out.toString());
            if (!parts.bg && !parts.char && !parts.outfit && !parts.comp) return null;
            return parts;
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            console.warn('[GPT Image] LLM 정리 실패 → 턴 그대로 사용', e);
            return null;
        }
    }

    function parseLLMParts(text) {
        const grab = (key) => {
            const m = text.match(new RegExp('^\\s*' + key + '\\s*[:：]\\s*(.+)$', 'im'));
            return m ? m[1].trim().replace(/^[\[<]+|[\]>]+$/g, '').trim() : '';
        };
        return { bg: grab('bg'), char: grab('char'), outfit: grab('outfit'), comp: grab('comp') };
    }

    // ── 프리셋 + 장면 합치기 ──────────────────────────────────────────
    function buildPrompt(rawScene, parts) {
        let preset = config.presets[config.activePreset]?.body || '';
        if (parts) {
            preset = preset
                .replace(/\{bg\}/g, parts.bg || '')
                .replace(/\{char\}/g, parts.char || '')
                .replace(/\{outfit\}/g, parts.outfit || '')
                .replace(/\{comp\}/g, parts.comp || '')
                .replace(/\{scene\}/g, [parts.bg, parts.char, parts.outfit, parts.comp].filter(Boolean).join(', '));
        } else {
            preset = preset
                .replace(/\{bg\}/g, rawScene)
                .replace(/\{char\}/g, '')
                .replace(/\{outfit\}/g, '')
                .replace(/\{comp\}/g, '')
                .replace(/\{scene\}/g, rawScene);
            if (!/\{(bg|char|outfit|comp|scene)\}/.test(config.presets[config.activePreset]?.body || '')) {
                preset = preset + '\n\n' + rawScene;
            }
        }
        preset = preset.replace(/\[[^\[\]:]*:\s*\],?/g, '').replace(/\n{2,}/g, '\n').replace(/,\s*,/g, ',');
        return preset.trim();
    }

    // [NEW v0.4] base64 data URL → { mime, bytes(Uint8Array) }
    function dataUrlToBytes(dataUrl) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
        if (!m) throw new Error('잘못된 이미지 데이터 형식입니다.');
        const mime = m[1];
        const bin = atob(m[2]);
        const len = bin.length;
        const buf = new Uint8Array(len);
        for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
        return { mime, bytes: buf };
    }

    // [NEW v0.4] multipart/form-data body 수동 빌드 (nativeFetch가 FormData postMessage 직렬화를 못 해서)
    // fields: { name: stringValue }
    // files:  [{ name, filename, mime, bytes(Uint8Array) }, ...]
    // 반환: { contentType, body(ArrayBuffer) }
    function buildMultipart(fields, files) {
        const boundary = '----GPTImageFormBoundary' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const enc = new TextEncoder();
        const parts = [];

        for (const [name, value] of Object.entries(fields)) {
            parts.push(enc.encode(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
                `${value}\r\n`
            ));
        }
        for (const f of files) {
            parts.push(enc.encode(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
                `Content-Type: ${f.mime}\r\n\r\n`
            ));
            parts.push(f.bytes);
            parts.push(enc.encode('\r\n'));
        }
        parts.push(enc.encode(`--${boundary}--\r\n`));

        const total = parts.reduce((s, p) => s + p.byteLength, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.byteLength; }
        return { contentType: `multipart/form-data; boundary=${boundary}`, body: out.buffer };
    }

    // 채워진 참조 이미지 슬롯만 모아 배열 반환. 라벨도 함께.
    // 반환: [{ slot:'char'|'persona'|'style', label:'character'|..., dataUrl }, ...]
    function collectRefImages() {
        const refs = config.refImages || {};
        const out = [];
        if (refs.char    && refs.char.startsWith('data:'))    out.push({ slot: 'char',    label: 'character', dataUrl: refs.char });
        if (refs.persona && refs.persona.startsWith('data:')) out.push({ slot: 'persona', label: 'persona',   dataUrl: refs.persona });
        if (refs.style   && refs.style.startsWith('data:'))   out.push({ slot: 'style',   label: 'art style', dataUrl: refs.style });
        return out;
    }
    function refFilledCount() {
        return collectRefImages().length;
    }

    // 참조 이미지 사용 시 프롬프트 앞에 자동으로 붙는 라벨링 + "외모만 복사, 옷/포즈/배경 복사 금지" 지시
    function buildRefImageInstructions(refs) {
        if (!refs.length) return '';
        const lines = [];
        refs.forEach((r, i) => {
            const idx = i + 1;
            if (r.slot === 'style') {
                lines.push(`Use image ${idx} as the ART STYLE reference: copy ONLY the illustration style, rendering technique, and color palette. Do NOT copy any subjects, clothing, poses, or background from this image.`);
            } else {
                const who = r.slot === 'char' ? 'CHARACTER' : 'PERSONA';
                lines.push(`Use image ${idx} as the ${who} appearance reference: copy ONLY the facial features and hair. Do NOT copy the outfit, pose, expression, or background from this image. The outfit, pose, and scene must follow the scene description below, not this reference.`);
            }
        });
        return lines.join('\n') + '\n\n';
    }

    // ── OpenAI 이미지 생성 ────────────────────────────────────────────
    // [v0.5] 참조 이미지 3슬롯 지원. 채워진 슬롯 1개 이상 → /v1/images/edits (multipart 다중 파일)
    //                                  전부 비어있음 → /v1/images/generations (JSON)
    async function generateImage(prompt, signal) {
        if (!config.apiKey) throw new Error('설정에서 OpenAI API Key 를 입력하세요.');
        if (!config.model) throw new Error('설정에서 Model 을 입력하세요.');

        const refs = collectRefImages();
        const hasRefs = refs.length > 0;
        // 참조 이미지가 있으면 외모/화풍 복사 규칙을 프롬프트 앞에 자동 삽입
        const finalPrompt = hasRefs ? (buildRefImageInstructions(refs) + prompt) : prompt;

        let res;
        if (hasRefs) {
            // 채워진 슬롯들을 multipart 파일로 변환
            const files = refs.map((r, i) => {
                const { mime, bytes } = dataUrlToBytes(r.dataUrl);
                const ext = (mime.split('/')[1] || 'png').toLowerCase();
                return { name: 'image[]', filename: `${r.slot}_${i+1}.${ext}`, mime, bytes };
            });
            const { contentType, body } = buildMultipart(
                {
                    model: config.model,
                    prompt: finalPrompt,
                    n: '1',
                    size: config.size || '1024x1024',
                    quality: config.quality || 'medium'
                },
                files
            );
            res = await risuai.nativeFetch(config.editsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': contentType,
                    'Authorization': 'Bearer ' + config.apiKey
                },
                body,
                signal
            });
        } else {
            const body = { model: config.model, prompt: finalPrompt, n: 1, size: config.size || '1024x1024', quality: config.quality || 'medium' };
            res = await risuai.nativeFetch(config.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
                body: JSON.stringify(body),
                signal
            });
        }

        // [NEW v0.4] 안전한 응답 파싱
        // OpenAI 자체가 아니라 앞단 프록시/게이트웨이가 plain text(예: "upstream connect error")로
        // 502/503/504를 던지는 경우가 있어서, res.ok와 JSON 파싱을 둘 다 방어해야 함.
        const rawText = await res.text();
        let json = null;
        try { json = rawText ? JSON.parse(rawText) : null; } catch (_) { /* JSON 아님 */ }

        if (!res.ok) {
            const apiMsg = json?.error?.message || json?.error || rawText || res.statusText || '';
            const snippet = String(apiMsg).trim().slice(0, 300);
            throw new Error(`OpenAI ${res.status}: ${snippet || '서버 오류'}`);
        }
        if (!json) {
            throw new Error('응답 파싱 실패: ' + rawText.slice(0, 200));
        }
        if (json.error) throw new Error('OpenAI: ' + (json.error.message || JSON.stringify(json.error)));
        const item = json?.data?.[0];
        if (!item) throw new Error('이미지 응답이 비어 있습니다.');
        if (item.b64_json) return 'data:image/png;base64,' + item.b64_json;
        if (item.url) return item.url;
        throw new Error('지원되지 않는 이미지 응답 형식입니다.');
    }

    // ── 메인 실행 ─────────────────────────────────────────────────────
    let running = false;
    let runningController = null;  // [NEW v0.4] AbortController

    async function handleGenerate() {
        if (running) { openWindow(); return; }
        running = true;
        runningController = new AbortController();
        const signal = runningController.signal;

        const job = { status: 'running', phase: 'extract', startedAt: Date.now(), src: '', error: '' };
        currentJob = job;
        await saveJob(job);
        activeView = 'result';
        openWindow();

        try {
            const raw = await getLastAiMessage();
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const cleaned = cleanScene(raw);

            if (config.llmMode !== 'off') { job.phase = 'refine'; await saveJob(job); renderWindow(); }
            const parts = await refineScene(cleaned, signal);
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            job.phase = 'generate'; await saveJob(job); renderWindow();
            const prompt = buildPrompt(cleaned, parts);
            const src = await generateImage(prompt, signal);

            job.status = 'done'; job.src = src; await saveJob(job);

            // [CHANGED v0.4] 히스토리에 prompt 저장
            const elapsedSec = Math.round((Date.now() - job.startedAt) / 1000);
            await addHistory({
                t: Date.now(),
                preset: config.presets[config.activePreset]?.name || '-',
                mode: config.mode || 'scene',
                quality: config.quality || 'medium',
                size: config.size || '1024x1024',
                sec: elapsedSec,
                cost: estimateCost(config.quality, config.size),
                prompt
            });
        } catch (e) {
            // [NEW v0.4] abort는 결과 화면 리셋 (에러로 표시하지 않음)
            if (e && e.name === 'AbortError') {
                console.log('[GPT Image] 사용자 취소');
                currentJob = null;
                await saveJob(null);
            } else {
                console.error('[GPT Image]', e);
                job.status = 'error';
                job.error = (e && e.message) ? e.message : String(e);
                await saveJob(job);
            }
        } finally {
            running = false;
            runningController = null;
            renderWindow();
        }
    }

    // [NEW v0.4] 취소 → fetch abort + 결과 초기 화면
    function cancelGenerate() {
        if (runningController) runningController.abort();
    }

    // ── 경과 타이머 ───────────────────────────────────────────────────
    let elapsedTimer = null;
    function startElapsed() {
        stopElapsed();
        elapsedTimer = setInterval(async () => {
            if (!windowOpen || activeView !== 'result') return;
            let latest = null;
            try { latest = await loadJob(); } catch (e) { /* noop */ }
            const prevStatus = currentJob && currentJob.status;
            const prevPhase = currentJob && currentJob.phase;
            const newStatus = latest && latest.status;
            const newPhase = latest && latest.phase;
            if (latest) currentJob = latest;
            if (newStatus !== prevStatus || newPhase !== prevPhase) {
                renderWindow();
                return;
            }
            const el = document.getElementById('gi-elapsed');
            if (el && currentJob && currentJob.status === 'running') {
                el.textContent = Math.floor((Date.now() - currentJob.startedAt) / 1000) + '초';
            }
        }, 1000);
    }
    function stopElapsed() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; } }

    function downloadImage(src) {
        const a = document.createElement('a');
        a.href = src; a.download = 'gptimage_' + Date.now() + '.png';
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ── 플로팅 창 ─────────────────────────────────────────────────────
    let currentJob = null;
    let windowOpen = false;
    let activeView = 'result';

    async function openWindow() {
        await risuai.showContainer('fullscreen');
        windowOpen = true;
        currentJob = await loadJob();

        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        document.head.appendChild(meta);

        document.body.innerHTML = `
          <style>
            body { margin:0; background:transparent; width:100vw; height:100vh; overflow:hidden;
                   font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; position:relative; }
            .gi-backdrop { position:absolute; inset:0; z-index:1; cursor:pointer; }
            .gi-win { position:absolute; right:20px; bottom:80px; width:320px; height:74vh; max-height:660px;
                      background:#ffffff; color:#3a3548; border-radius:20px; border:1px solid #ece9f0;
                      box-shadow:0 14px 38px rgba(80,70,110,.16); z-index:2; display:flex; flex-direction:column; overflow:hidden; }
            @media (max-width:600px){ .gi-win{ width:92vw; right:4vw; bottom:70px; height:80vh; } }
            .gi-bar { padding:12px 0 10px; background:#faf9fc; border-bottom:1px solid #f0eef4; position:relative;
                      cursor:grab; user-select:none; min-height:40px; box-sizing:border-box; }
            .gi-bar:active { cursor:grabbing; }
            .gi-grip { width:42px; height:4px; background:#dcd7e6; border-radius:999px; margin:0 auto; }
            .gi-title { position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:13px; font-weight:600; color:#7a5fd0; }
            .gi-close { position:absolute; right:6px; top:50%; transform:translateY(-50%); border:none; background:none;
                        font-size:21px; cursor:pointer; color:#b0a8c0; width:40px; height:32px; border-radius:8px; line-height:1; }
            .gi-close:hover { background:#efebf6; color:#5a5468; }
            .gi-body { flex:1; overflow-y:auto; }
            .gi-tabs { display:flex; border-top:1px solid #f0eef4; }
            .gi-tab { flex:1; text-align:center; padding:11px 0; font-size:12px; color:#a8a0b8; cursor:pointer; user-select:none; }
            .gi-tab.active { color:#7a5fd0; font-weight:600; background:#faf9fc; }

            .gi-stage { padding:24px 22px; display:flex; flex-direction:column; align-items:center; justify-content:center;
                        gap:20px; min-height:100%; box-sizing:border-box; text-align:center; }
            .gi-emoji { width:60px; height:60px; border-radius:50%; background:#f3effb; display:flex; align-items:center; justify-content:center; font-size:28px; }
            .gi-msg { font-size:13.5px; color:#6b6478; line-height:1.85; }
            .gi-msg .sub { font-size:12px; color:#9b93ab; }
            .gi-spinner { width:34px; height:34px; border:3px solid #efebf6; border-top-color:#9a7ff0; border-radius:50%; animation:gi-spin .9s linear infinite; }
            @keyframes gi-spin { to { transform:rotate(360deg); } }
            .gi-elapsed { font-size:12px; color:#9b93ab; }
            .gi-img { width:100%; border-radius:12px; box-shadow:0 6px 20px rgba(80,70,110,.18); }
            .gi-btn { padding:13px 30px; border:none; border-radius:12px; cursor:pointer; font-size:14px; font-weight:600; }
            .gi-btn.primary { background:#7a5fd0; color:#fff; box-shadow:0 4px 12px rgba(122,95,208,.28); }
            .gi-btnrow { display:flex; gap:8px; width:100%; }
            .gi-btnrow .gi-btn { flex:1; padding:11px 0; }
            .gi-btn.ghost { background:#f0edf7; color:#7a5fd0; box-shadow:none; }
            .gi-err { color:#c0392b; font-size:12.5px; line-height:1.6; background:#fbecee; padding:12px; border-radius:10px; width:100%; box-sizing:border-box; }

            .gi-field { padding:13px 16px; border-bottom:1px solid #f3f1f7; display:flex; flex-direction:column; gap:6px; }
            .gi-field.gi-field-new { background:#fbfaff; }
            .gi-field label { font-size:12px; font-weight:600; color:#4a4458; }
            .gi-field .hint { font-size:10.5px; color:#9b93ab; line-height:1.5; }
            .gi-field input, .gi-field textarea, .gi-field select {
                background:#f8f7fb; border:1px solid #e8e5ef; border-radius:8px; color:#5a5468; padding:8px 10px;
                font-size:12.5px; font-family:inherit; box-sizing:border-box; width:100%; }
            .gi-field textarea { resize:vertical; line-height:1.5; }
            .gi-presetrow { display:flex; gap:6px; }
            .gi-presetrow select { flex:1; }
            .gi-mini { padding:8px 11px; border:none; border-radius:8px; cursor:pointer; background:#f0edf7; color:#7a5fd0; font-size:12px; }
            .gi-save { margin:14px 16px; padding:11px; border:none; border-radius:10px; background:#7a5fd0; color:#fff;
                       font-size:13.5px; font-weight:600; width:calc(100% - 32px); cursor:pointer; }
            .gi-reset { padding:9px 11px; border:1px solid #f0d4d4; border-radius:8px; background:#fdf6f6; color:#c0392b;
                        font-size:12px; font-weight:500; cursor:pointer; width:100%; }
            .gi-reset:hover { background:#fbecec; border-color:#e8b4b4; }
            .gi-saved { text-align:center; color:#2f9e6e; font-size:12px; height:16px; }

            /* [NEW v0.4] 화풍 참조 이미지 */
            .gi-refrow { display:flex; gap:10px; align-items:center; }
            .gi-refthumb { width:64px; height:64px; border-radius:8px; background:#f0edf7; border:1px dashed #c9bfe4;
                           display:flex; align-items:center; justify-content:center; font-size:22px; color:#b0a8c0;
                           flex-shrink:0; overflow:hidden; }
            .gi-refthumb img { width:100%; height:100%; object-fit:cover; }
            .gi-refbtns { display:flex; flex-direction:column; gap:5px; flex:1; }
            .gi-refbtns button { background:#f0edf7; color:#7a5fd0; border:none; border-radius:8px; padding:7px 0;
                                 font-size:12px; font-weight:600; cursor:pointer; }
            .gi-refbtns .gi-refdel { background:transparent; color:#b0a8c0; padding:4px 0; font-size:11px; font-weight:400; }

            /* [NEW v0.5] 참조 이미지 페이지 */
            .gi-refgo { width:calc(100% - 32px); margin:6px 16px 4px; padding:12px 14px; border:1px solid #e8e5ef;
                        border-radius:10px; background:#fbfaff; color:#4a4458; font-size:13px; font-weight:600;
                        text-align:left; cursor:pointer; display:flex; align-items:center; gap:8px; }
            .gi-refgo:hover { background:#f5f1fb; }
            .gi-refgo-count { margin-left:auto; color:#7a5fd0; font-weight:700; font-size:12px; }
            .gi-refback { background:transparent; border:none; color:#7a5fd0; font-size:13px; font-weight:600;
                          padding:13px 16px 4px; cursor:pointer; text-align:left; display:block; }
            .gi-refback:hover { color:#5a3fb0; }
            .gi-reftitle { padding:0 16px 10px; font-size:14px; font-weight:700; color:#4a4458; border-bottom:1px solid #f3f1f7; }
            .gi-reftitle .sub { display:block; font-size:10.5px; color:#9b93ab; font-weight:400; margin-top:3px; line-height:1.5; }
            .gi-refslot-label { font-size:12px; font-weight:600; color:#4a4458; display:flex; align-items:center; gap:6px; }
            .gi-refslot-label .gi-refslot-emoji { font-size:15px; }
            .gi-refslot-label .gi-refslot-empty { margin-left:auto; font-size:10.5px; color:#b0a8c0; font-weight:400; }
            .gi-refslot-label .gi-refslot-filled { margin-left:auto; font-size:10.5px; color:#2f9e6e; font-weight:600; }

            /* [NEW v0.4] 히스토리 토글 */
            .gi-hwrap { display:flex; flex-direction:column; }
            .gi-hnote { font-size:10.5px; color:#9b93ab; line-height:1.5; padding:13px 16px 10px; border-bottom:1px solid #f3f1f7; }
            .gi-hrow { padding:11px 16px; border-bottom:1px solid #f3f1f7; display:flex; flex-direction:column; gap:3px; cursor:pointer; }
            .gi-hrow:hover { background:#faf9fc; }
            .gi-hmain { display:flex; justify-content:space-between; align-items:baseline; }
            .gi-hpreset { font-size:13px; font-weight:600; color:#4a4458; }
            .gi-hpreset .gi-hmode { font-size:11px; font-weight:400; color:#9b93ab; margin-left:6px; }
            .gi-hcost { font-size:12.5px; font-weight:600; color:#7a5fd0; }
            .gi-hsub { font-size:10.5px; color:#9b93ab; display:flex; justify-content:space-between; align-items:center; }
            .gi-hchev { font-size:10px; color:#b0a8c0; transition:transform .15s; }
            .gi-hrow.open .gi-hchev { transform:rotate(180deg); }
            .gi-hprompt { display:none; margin-top:8px; padding:10px; background:#f8f7fb; border-radius:8px;
                          font-size:11px; color:#5a5468; line-height:1.6; white-space:pre-wrap; word-break:break-all;
                          font-family:ui-monospace, Menlo, Consolas, monospace; }
            .gi-hrow.open .gi-hprompt { display:block; }
            .gi-htotal { padding:13px 16px; font-size:12.5px; font-weight:600; color:#4a4458; text-align:right; }

            .gi-body::-webkit-scrollbar { width:8px; }
            .gi-body::-webkit-scrollbar-track { background:transparent; }
            .gi-body::-webkit-scrollbar-thumb { background:#dcd7e6; border-radius:999px; border:2px solid #fff; }
            .gi-body::-webkit-scrollbar-thumb:hover { background:#c5bdd6; }
            .gi-body { scrollbar-width:thin; scrollbar-color:#dcd7e6 transparent; }
          </style>
          <div class="gi-backdrop" id="gi-backdrop"></div>
          <div class="gi-win" id="gi-win">
            <div class="gi-bar" id="gi-bar">
              <div class="gi-grip"></div>
              <div class="gi-title">GPT Image</div>
              <button class="gi-close" id="gi-close">&times;</button>
            </div>
            <div class="gi-body" id="gi-screen"></div>
            <div class="gi-tabs">
              <div class="gi-tab" id="gi-tab-result">결과</div>
              <div class="gi-tab" id="gi-tab-history">기록</div>
              <div class="gi-tab" id="gi-tab-settings">설정</div>
            </div>
          </div>`;

        document.getElementById('gi-backdrop').addEventListener('click', () => closeWindow());
        document.getElementById('gi-close').addEventListener('click', () => closeWindow());
        document.getElementById('gi-tab-result').addEventListener('click', () => { activeView = 'result'; renderWindow(); });
        document.getElementById('gi-tab-history').addEventListener('click', () => { activeView = 'history'; renderWindow(); });
        document.getElementById('gi-tab-settings').addEventListener('click', () => { activeView = 'settings'; renderWindow(); });
        bindDrag();
        renderWindow();
    }

    function closeWindow() { windowOpen = false; stopElapsed(); risuai.hideContainer(); }

    function bindDrag() {
        const win = document.getElementById('gi-win');
        const bar = document.getElementById('gi-bar');
        let on = false, sx, sy, l, t;
        const start = (e) => {
            if (e.target.closest('.gi-close')) return;
            on = true;
            const p = e.touches ? e.touches[0] : e;
            sx = p.clientX; sy = p.clientY;
            const r = win.getBoundingClientRect();
            win.style.right = 'auto'; win.style.bottom = 'auto';
            win.style.left = r.left + 'px'; win.style.top = r.top + 'px';
            l = r.left; t = r.top;
        };
        const move = (e) => {
            if (!on) return; e.preventDefault();
            const p = e.touches ? e.touches[0] : e;
            win.style.left = (l + p.clientX - sx) + 'px';
            win.style.top = (t + p.clientY - sy) + 'px';
        };
        const end = () => { on = false; };
        bar.addEventListener('mousedown', start);
        bar.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', end);
        document.addEventListener('touchend', end);
    }

    function syncTabs() {
        document.getElementById('gi-tab-result')?.classList.toggle('active', activeView === 'result');
        document.getElementById('gi-tab-history')?.classList.toggle('active', activeView === 'history');
        // refimages 는 설정의 하위 페이지 — 설정 탭을 활성으로 표시
        document.getElementById('gi-tab-settings')?.classList.toggle('active', activeView === 'settings' || activeView === 'refimages');
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function renderWindow() {
        if (!windowOpen) return;
        const screen = document.getElementById('gi-screen');
        if (!screen) return;
        syncTabs();
        if (activeView === 'settings') { renderSettings(screen); stopElapsed(); }
        else if (activeView === 'history') { renderHistory(screen); stopElapsed(); }
        else if (activeView === 'refimages') { renderRefImages(screen); stopElapsed(); }
        else renderResult(screen);
    }

    function renderResult(screen) {
        const job = currentJob;
        let status = job?.status;
        if (status === 'running' && !running && job && (Date.now() - job.startedAt > STALE_MS)) status = 'stale';

        if (!job || status === undefined) {
            screen.innerHTML = `
              <div class="gi-stage">
                <div class="gi-emoji">🎨</div>
                <div class="gi-msg">버튼을 누르면<br>최근 장면을 이미지로 만들어요.<br>
                  <span class="sub">먼저 <b style="color:#7a5fd0;">설정</b> 탭에서<br>API Key 와 프리셋을 확인하세요.</span></div>
                <button class="gi-btn primary" id="gi-go">🎨 장면 추출</button>
              </div>`;
            document.getElementById('gi-go')?.addEventListener('click', () => handleGenerate());
            stopElapsed();
            return;
        }

        if (status === 'running') {
            const sec = Math.floor((Date.now() - job.startedAt) / 1000);
            const label = job.phase === 'refine' ? '장면 정리 중' : job.phase === 'generate' ? '이미지 생성 중' : '장면 추출 중';
            screen.innerHTML = `
              <div class="gi-stage">
                <div class="gi-spinner"></div>
                <div class="gi-msg">${label}…<br><span class="gi-elapsed">경과 <span id="gi-elapsed">${sec}초</span></span></div>
                <div class="gi-msg" style="font-size:11px;color:#b3aac4;">창을 닫아도 백그라운드에서 진행됩니다.</div>
                <button class="gi-btn ghost" id="gi-cancel">취소</button>
              </div>`;
            // [CHANGED v0.4] 취소 = abort. 즉시 재시도하지 않음.
            document.getElementById('gi-cancel')?.addEventListener('click', () => cancelGenerate());
            startElapsed();
            return;
        }
        stopElapsed();

        if (status === 'error') {
            screen.innerHTML = `<div class="gi-stage"><div class="gi-err">⚠️ 생성 실패<br><br>${esc(job.error)}</div><button class="gi-btn primary" id="gi-retry">다시 시도</button><button class="gi-btn ghost" id="gi-home" style="width:100%;">홈으로 가기</button></div>`;
            document.getElementById('gi-retry')?.addEventListener('click', () => handleGenerate());
            document.getElementById('gi-home')?.addEventListener('click', async () => { currentJob = null; await saveJob(null); renderWindow(); });
            return;
        }
        if (status === 'stale') {
            screen.innerHTML = `<div class="gi-stage"><div class="gi-err">생성이 오래 걸리거나 중단됐을 수 있어요.</div><button class="gi-btn primary" id="gi-retry">다시 시도</button><button class="gi-btn ghost" id="gi-home" style="width:100%;">홈으로 가기</button></div>`;
            document.getElementById('gi-retry')?.addEventListener('click', () => handleGenerate());
            document.getElementById('gi-home')?.addEventListener('click', async () => { currentJob = null; await saveJob(null); renderWindow(); });
            return;
        }
        if (status === 'done' && job.src) {
            screen.innerHTML = `
              <div class="gi-stage">
                <img class="gi-img" src="${job.src}" alt="scene" />
                <div class="gi-btnrow">
                  <button class="gi-btn primary" id="gi-save-png">PNG 저장</button>
                  <button class="gi-btn ghost" id="gi-regen">재생성</button>
                </div>
                <button class="gi-btn ghost" id="gi-home" style="width:100%;">홈으로 돌아가기</button>
              </div>`;
            document.getElementById('gi-save-png')?.addEventListener('click', () => downloadImage(job.src));
            document.getElementById('gi-regen')?.addEventListener('click', () => handleGenerate());
            document.getElementById('gi-home')?.addEventListener('click', async () => {
                currentJob = null; await saveJob(null); renderWindow();
            });
            return;
        }
        screen.innerHTML = `<div class="gi-stage"><div class="gi-msg">결과가 없습니다.</div></div>`;
    }

    function presetOptions() {
        return config.presets.map((p, i) => `<option value="${i}" ${i === config.activePreset ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    function llmModeOptions() {
        const opts = [['off', '끄기'], ['main', '본모델'], ['sub', '보조모델']];
        return opts.map(([v, l]) => `<option value="${v}" ${config.llmMode === v ? 'selected' : ''}>${l}</option>`).join('');
    }
    function qualityOptions() {
        const opts = [['low', 'low (저렴 · 빠름)'], ['medium', 'medium (기본)'], ['high', 'high (고품질 · 느림 · 비쌈)']];
        return opts.map(([v, l]) => `<option value="${v}" ${(config.quality || 'medium') === v ? 'selected' : ''}>${l}</option>`).join('');
    }
    // [NEW v0.4]
    function modeOptions() {
        const opts = [['scene', '장면샷'], ['solo', '1인샷']];
        return opts.map(([v, l]) => `<option value="${v}" ${(config.mode || 'scene') === v ? 'selected' : ''}>${l}</option>`).join('');
    }

    function fmtTime(t) {
        const d = new Date(t);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    // [NEW v0.4] 모드 라벨 (히스토리 표시용)
    function modeLabel(m) {
        return m === 'solo' ? '1인샷' : m === 'scene' ? '장면샷' : '';
    }

    async function renderHistory(screen) {
        const list = await loadHistory();
        if (!windowOpen || activeView !== 'history') return;
        if (!list.length) {
            screen.innerHTML = `<div class="gi-stage"><div class="gi-msg">아직 생성 기록이 없어요.</div></div>`;
            return;
        }
        const total = list.reduce((s, e) => s + (e.cost || 0), 0);
        // [CHANGED v0.4] 행 클릭 시 토글로 프롬프트 펼치기
        const rows = list.map((e, idx) => {
            const modeHtml = e.mode ? `<span class="gi-hmode">· ${esc(modeLabel(e.mode))}</span>` : '';
            const promptHtml = e.prompt ? `<div class="gi-hprompt">${esc(e.prompt)}</div>` : '';
            return `
              <div class="gi-hrow" data-idx="${idx}">
                <div class="gi-hmain">
                  <span class="gi-hpreset">${esc(e.preset)}${modeHtml}</span>
                  <span class="gi-hcost">~$${(e.cost || 0).toFixed(3)}</span>
                </div>
                <div class="gi-hsub">
                  <span>${fmtTime(e.t)} · ${esc(e.quality)} · ${esc(e.size)} · ${e.sec}초</span>
                  ${e.prompt ? '<span class="gi-hchev">▼</span>' : ''}
                </div>
                ${promptHtml}
              </div>`;
        }).join('');
        screen.innerHTML = `
          <div class="gi-hwrap">
            <div class="gi-hnote">표시된 비용은 정확한 청구액이 아니라 추정치예요. 행을 누르면 사용된 프롬프트를 볼 수 있습니다.</div>
            ${rows}
            <div class="gi-htotal">합계 ${list.length}장 · 추정 ~$${total.toFixed(3)}</div>
            <button class="gi-btn ghost" id="gi-hist-clear" style="width:calc(100% - 32px); margin:8px 16px 16px;">전체 지우기</button>
          </div>`;
        // 행 클릭 → 펼침 토글
        screen.querySelectorAll('.gi-hrow').forEach((row) => {
            row.addEventListener('click', () => {
                if (!row.querySelector('.gi-hprompt')) return;
                row.classList.toggle('open');
            });
        });
        document.getElementById('gi-hist-clear')?.addEventListener('click', async () => {
            await clearHistory();
            renderHistory(screen);
        });
    }

    // [NEW v0.4] 이미지 파일 → base64 (압축 옵션: 긴 변 1024px로 리사이즈해서 저장)
    function readImageAsResizedDataUrl(file, maxSide = 1024) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
            fr.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('이미지를 디코드하지 못했어요.'));
                img.onload = () => {
                    let w = img.naturalWidth, h = img.naturalHeight;
                    const scale = Math.min(1, maxSide / Math.max(w, h));
                    w = Math.round(w * scale); h = Math.round(h * scale);
                    const cv = document.createElement('canvas');
                    cv.width = w; cv.height = h;
                    const ctx = cv.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(cv.toDataURL('image/png'));
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(file);
        });
    }

    // [NEW v0.5] 참조 이미지 하위 페이지 — 캐릭터 / 페르소나 / 화풍 3슬롯
    // - 선택 즉시 저장 (저장 버튼 없음)
    // - 뒤로가기 누르면 설정 탭으로 복귀
    function renderRefImages(screen) {
        const refs = config.refImages || { char: '', persona: '', style: '' };
        const slots = [
            { key: 'char',    emoji: '📷', label: '캐릭터',  hint: 'RP 캐릭터({{char}})의 얼굴 참조. 외모만 따라하고 옷·포즈는 장면에 맞춰 그려요.' },
            { key: 'persona', emoji: '👤', label: '페르소나', hint: '유저 페르소나({{user}})의 얼굴 참조. 마찬가지로 외모만 따라합니다.' },
            { key: 'style',   emoji: '🎨', label: '화풍',     hint: '일러스트 스타일/색감만 빌립니다. 인물·옷·배경은 복사하지 않아요.' }
        ];

        const slotHtml = slots.map((s) => {
            const v = refs[s.key];
            const hasImg = !!(v && v.startsWith('data:'));
            return `
              <div class="gi-field gi-field-new" data-slot="${s.key}">
                <div class="gi-refslot-label">
                  <span class="gi-refslot-emoji">${s.emoji}</span>
                  <span>${esc(s.label)}</span>
                  ${hasImg
                    ? '<span class="gi-refslot-filled">✓ 등록됨</span>'
                    : '<span class="gi-refslot-empty">비어 있음</span>'}
                </div>
                <div class="gi-refrow">
                  <div class="gi-refthumb">${hasImg ? `<img src="${esc(v)}" alt="${esc(s.label)}" />` : s.emoji}</div>
                  <div class="gi-refbtns">
                    <button data-act="pick" data-slot="${s.key}">${hasImg ? '이미지 변경' : '이미지 선택'}</button>
                    ${hasImg ? `<button class="gi-refdel" data-act="del" data-slot="${s.key}">제거</button>` : ''}
                  </div>
                </div>
                <span class="hint">${esc(s.hint)}</span>
              </div>`;
        }).join('');

        screen.innerHTML = `
          <button class="gi-refback" id="gi-refback">‹ 설정으로</button>
          <div class="gi-reftitle">참조 이미지
            <span class="sub">슬롯에 사진을 넣으면 그 외모/화풍을 따라 그립니다. 채워진 슬롯이 있으면 자동으로 <b>images/edits</b> 엔드포인트로 호출돼요. 선택 즉시 저장됩니다.</span>
          </div>
          ${slotHtml}
          <input id="gi-refslot-file" type="file" accept="image/png,image/jpeg,image/webp" style="display:none;" />
          <div style="height:14px;"></div>`;

        // 뒤로가기 — 설정 탭으로 복귀
        document.getElementById('gi-refback')?.addEventListener('click', () => {
            activeView = 'settings';
            renderWindow();
        });

        const fileInput = document.getElementById('gi-refslot-file');
        let pendingSlot = null;

        // "이미지 선택/변경" 버튼들 — file input 트리거
        screen.querySelectorAll('button[data-act="pick"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                pendingSlot = btn.getAttribute('data-slot');
                fileInput.value = ''; // 같은 파일 다시 골라도 change 이벤트 나도록 리셋
                fileInput.click();
            });
        });

        // "제거" 버튼들 — 즉시 저장
        screen.querySelectorAll('button[data-act="del"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const slot = btn.getAttribute('data-slot');
                if (!config.refImages) config.refImages = { char: '', persona: '', style: '' };
                config.refImages[slot] = '';
                await saveConfig();
                renderRefImages(screen);
            });
        });

        // 파일 선택 → 리사이즈 → 즉시 저장
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file || !pendingSlot) return;
            try {
                const dataUrl = await readImageAsResizedDataUrl(file, 1024);
                if (!config.refImages) config.refImages = { char: '', persona: '', style: '' };
                config.refImages[pendingSlot] = dataUrl;
                await saveConfig();
                pendingSlot = null;
                renderRefImages(screen);
            } catch (err) {
                alert('이미지 처리 실패: ' + (err.message || err));
            }
        });
    }


    function renderSettings(screen) {
        const active = config.presets[config.activePreset] || config.presets[0];
        // 현재 모드 기준 LLM 지시문
        const currentPrompt = (config.llmPrompts && config.llmPrompts[config.mode]) || DEFAULT_LLM_PROMPT_SCENE;

        screen.innerHTML = `
          <div class="gi-field">
            <label>OpenAI API Key</label>
            <input id="gi-key" type="password" value="${esc(config.apiKey)}" placeholder="sk-..." />
          </div>
          <div class="gi-field">
            <label>Model</label>
            <input id="gi-model" type="text" value="${esc(config.model)}" placeholder="gpt-image-2" />
          </div>
          <div class="gi-field">
            <label>Image Size</label>
            <input id="gi-size" type="text" value="${esc(config.size)}" placeholder="1024x1024" />
            <span class="hint">기본은 1024x1024. 가로형으로 뽑고 싶을 땐 1536x1024를 추천합니다.</span>
          </div>
          <div class="gi-field">
            <label>품질 (Quality)</label>
            <select id="gi-quality">${qualityOptions()}</select>
            <span class="hint">이미지 안에 글자가 없으면 low~medium로 충분합니다.</span>
          </div>

          <div class="gi-field gi-field-new">
            <label>참조 이미지 (선택)</label>
            <button class="gi-refgo" id="gi-refgo">🖼  참조 이미지 설정  <span class="gi-refgo-count">${refFilledCount()}/3</span>  ›</button>
            <span class="hint">캐릭터·페르소나 얼굴과 화풍을 따로 첨부할 수 있어요. 얼굴은 따라하고 옷·동작·배경은 장면에 맞춰 그립니다.</span>
          </div>

          <div class="gi-field gi-field-new">
            <label>모드</label>
            <select id="gi-mode">${modeOptions()}</select>
            <span class="hint">장면샷은 그 턴의 분위기 전체를, 1인샷은 한 명 중심으로 뽑습니다.</span>
          </div>

          <div class="gi-field">
            <label>LLM 장면 정리</label>
            <select id="gi-llm-mode">${llmModeOptions()}</select>
            <span class="hint">긴 한국어 턴에서 핵심 장면을 태그로 뽑아 정확도를 높입니다. 본모델/보조모델은 현재 채팅에 설정된 키를 사용합니다.</span>
          </div>
          <div class="gi-field">
            <label>LLM 정리 지시문 <span style="color:#7a5fd0;font-weight:400;">(현재 모드: ${esc(modeLabel(config.mode))})</span></label>
            <textarea id="gi-llm-prompt" style="min-height:130px;">${esc(currentPrompt)}</textarea>
            <span class="hint"><b style="color:#7a5fd0;">{scene}</b> 자리에 추출된 턴이 들어갑니다. 모드를 바꾸면 해당 모드의 지시문으로 전환됩니다.</span>
          </div>

          <div class="gi-field">
            <label>프리셋 선택</label>
            <div class="gi-presetrow">
              <select id="gi-preset-select">${presetOptions()}</select>
              <button class="gi-mini" id="gi-preset-new">+</button>
              <button class="gi-mini" id="gi-preset-del">삭제</button>
            </div>
          </div>
          <div class="gi-field">
            <label>프리셋 이름</label>
            <input id="gi-preset-name" type="text" value="${esc(active.name)}" />
          </div>
          <div class="gi-field">
            <label>프리셋 본문 (스타일 고정)</label>
            <textarea id="gi-preset-body" style="min-height:130px;">${esc(active.body)}</textarea>
            <span class="hint">변동 부분은 자리표시자로 비워두세요. <b style="color:#7a5fd0;">{bg}</b> 배경 · <b style="color:#7a5fd0;">{char}</b> 인물 · <b style="color:#7a5fd0;">{outfit}</b> 복식 · <b style="color:#7a5fd0;">{comp}</b> 구도. LLM을 끄면 이 자리에 턴 원문이 그대로 들어갑니다.</span>
          </div>
          <div class="gi-field" style="border-bottom:none;">
            <button class="gi-reset" id="gi-preset-reset">⚠️ 프리셋 기본값으로 초기화</button>
            <span class="hint">현재 프리셋을 모두 지우고 기본값(일상·로판·반실사·실사)으로 되돌립니다. API 키·모델·기록·화풍 참조 이미지는 유지됩니다.</span>
          </div>
          <button class="gi-save" id="gi-save">저장</button>
          <div class="gi-saved" id="gi-saved"></div>
          <div style="height:10px;"></div>`;

        // 현재 편집 중인 모드의 지시문 textarea 값을 config에 다시 담아두는 헬퍼
        const captureLLMPrompt = () => {
            const v = document.getElementById('gi-llm-prompt')?.value;
            if (v != null) {
                if (!config.llmPrompts) config.llmPrompts = { scene: DEFAULT_LLM_PROMPT_SCENE, solo: DEFAULT_LLM_PROMPT_SOLO };
                config.llmPrompts[config.mode] = v;
            }
        };
        const captureEdits = () => {
            const a = config.presets[config.activePreset];
            if (!a) return;
            a.name = document.getElementById('gi-preset-name').value.trim() || a.name;
            a.body = document.getElementById('gi-preset-body').value;
        };

        // [NEW v0.4] 모드 변경 → 현재 textarea 값 저장 후 모드별 지시문으로 전환
        document.getElementById('gi-mode')?.addEventListener('change', (e) => {
            captureLLMPrompt();
            captureEdits();
            config.mode = e.target.value || 'scene';
            renderSettings(screen);
        });

        // [v0.5] 참조 이미지 페이지 진입
        document.getElementById('gi-refgo')?.addEventListener('click', () => {
            captureLLMPrompt();
            captureEdits();
            activeView = 'refimages';
            renderWindow();
        });

        document.getElementById('gi-preset-select')?.addEventListener('change', (e) => {
            captureLLMPrompt();
            captureEdits();
            config.activePreset = parseInt(e.target.value, 10) || 0;
            renderSettings(screen);
        });
        document.getElementById('gi-preset-new')?.addEventListener('click', () => {
            captureLLMPrompt();
            captureEdits();
            config.presets.push({ name: '새 프리셋 ' + (config.presets.length + 1), body: PRESET_DAILY });
            config.activePreset = config.presets.length - 1;
            renderSettings(screen);
        });
        document.getElementById('gi-preset-del')?.addEventListener('click', () => {
            if (config.presets.length <= 1) return;
            captureLLMPrompt();
            config.presets.splice(config.activePreset, 1);
            config.activePreset = 0;
            renderSettings(screen);
        });
        document.getElementById('gi-preset-reset')?.addEventListener('click', async () => {
            const ok = confirm('현재 프리셋이 모두 사라지고 기본값(일상·로판·반실사·실사)으로 되돌아갑니다.\n\n직접 만들거나 수정한 프리셋은 복구할 수 없습니다. 진행하시겠어요?');
            if (!ok) return;
            // DEFAULT_CONFIG.presets 를 깊은 복사 해서 교체 (참조 공유 방지)
            config.presets = DEFAULT_CONFIG.presets.map(p => ({ name: p.name, body: p.body }));
            config.activePreset = 0;
            await saveConfig();
            renderSettings(screen);
            const s = document.getElementById('gi-saved');
            if (s) { s.textContent = '프리셋 초기화됨'; setTimeout(() => (s.textContent = ''), 1800); }
        });
        document.getElementById('gi-save')?.addEventListener('click', async () => {
            config.apiKey = document.getElementById('gi-key').value.trim();
            config.model = document.getElementById('gi-model').value.trim() || DEFAULT_CONFIG.model;
            config.size = document.getElementById('gi-size').value.trim() || '1024x1024';
            config.quality = document.getElementById('gi-quality').value || 'medium';
            config.llmMode = document.getElementById('gi-llm-mode').value || 'off';
            captureLLMPrompt();
            captureEdits();
            await saveConfig();
            const s = document.getElementById('gi-saved');
            if (s) { s.textContent = '저장됨'; setTimeout(() => (s.textContent = ''), 1500); }
        });
    }

    // ── 등록 ──────────────────────────────────────────────────────────
    await loadConfig();
    currentJob = await loadJob();

    await risuai.registerButton(
        { name: 'GPT Image', icon: '🎨', iconType: 'html', location: 'chat', id: 'btn-gptimage' },
        openWindow
    );
    await risuai.registerSetting?.('GPT Image', () => { activeView = 'settings'; openWindow(); }, '🎨', 'html');
    await risuai.onUnload?.(async () => { stopElapsed(); await risuai.hideContainer?.(); });

    console.log('[GPT Image v0.5.0] loaded');
})();
