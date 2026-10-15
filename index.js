// Блокнот рассказчика — модель раз в N сообщений сама решает,
// что хочет реализовать / спросить / придумать, и записывает это.
// Записи хранятся в метаданных чата и подмешиваются в промпт.

const MODULE = 'npc_notebook';
const INJECT_KEY = 'npc_notebook_inject';

// Константы SillyTavern (extension_prompt_types / extension_prompt_roles)
const POS_IN_CHAT = 1;

const DEFAULT_THINK = `[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. На минуту ты — автор этой истории и ведёшь свой рабочий блокнот. Перечитай чат целиком и пройди по всем разделам ниже.

{{direction}}

{{npcs}}

{{arcs}}

{{intrigues}}

Задумки на будущее. Подумай как автор: что ты хочешь, чтобы произошло дальше? Как поведут себя NPC, что хочется выяснить у {{user}} через персонажей, что новое можно придумать про мир? Не каждая задумка должна быть проблемой или угрозой: тёплое, забавное, бытовое тоже двигает историю.

Твои задумки сейчас:
{{notes}}

Команды для задумок:
ADD [план]: что хочешь реализовать и к какому сюжетному моменту (например «когда {{user}} вернётся в город»)
ADD [вопрос]: что хочешь выяснить или спросить
ADD [идея]: новая придумка про NPC или мир
DONE #номер — задумка уже реализовалась
DROP #номер — задумка больше не подходит
Привязывай задумки к сюжетным событиям или датам внутри истории, а не к счёту дней от текущего момента. Если в чате был таймскип, проверь каждую запись: что уже случилось бы за кадром — DONE или перепиши как последствие; что потеряло смысл — DROP. Не больше трёх новых ADD.

Ответь ТОЛЬКО командами, каждая с новой строки, без пояснений и без текста роли. Пройди все разделы: если в разделе нечего добавить — пропусти его. Если нечего ни в одном — ответь одним словом: NONE]`;

const DEFAULT_INJECT = `[Личный блокнот автора. Это твои собственные задумки на будущее сюжета. Не упоминай блокнот и не цитируй его. Вплетай задумки естественно и постепенно, когда момент подходит; не нужно реализовывать всё сразу и не нужно форсировать. Отсчёт «сообщ. назад» — это сообщения чата, а не сюжетное время; в истории могли пройти дни или недели.]
{{notes}}`;

const REROLL_PROMPT = `[OOC: Пауза в ролевой игре. Ты — автор этой истории. Игроку не понравилась одна из твоих задумок:
«{{old}}»

Придумай одну другую задумку взамен — отличающуюся по сути, а не перефразированную. Учитывай, что происходило в чате.

Остальные задумки в блокноте (не повторяй их):
{{notes}}

{{direction}}

Ответь ровно одной строкой в формате:
ADD [тег]: текст задумки]`;

const REROLL_INTRIGUE_PROMPT = `[OOC: Пауза в ролевой игре. Ты — автор этой истории. Игроку не понравилась одна из твоих тайн или интриг:
«{{old}}»

Придумай другую тайну, загадку, слух или интригу взамен — отличающуюся по сути. Учитывай, что происходило в чате и что уже есть в блокноте.

{{direction}}

Ответь ровно одной строкой в формате:
INTRIGUE [тайна|загадка|слух|интрига]: в чём правда на самом деле]`;

const ARC_STAGES = [
    null,
    { name: 'Зарождение', hint: 'старое поведение полностью преобладает; новое проскальзывает редко и неосознанно, персонаж может это отрицать' },
    { name: 'Борьба', hint: 'персонаж замечает в себе новое, иногда выбирает его, но часто откатывается; внутренний конфликт' },
    { name: 'Сдвиг', hint: 'новое поведение проявляется чаще старого, но под стрессом возможен откат' },
    { name: 'Закреплено', hint: 'новая черта — часть характера' },
];
const ARC_MAX = 4;

const ARC_INJECT_HEADER = '[Развитие персонажей. Карточки описывают, какими персонажи были в начале истории. Ниже — как они изменились с тех пор: где это противоречит карточке, верно то, что ниже. Ядро личности, манера речи и привычки сохраняются; изменения проявляются ровно в той мере, какую задаёт стадия.]';

const NPC_INJECT_HEADER = '[Персонажи истории — это канон, держись этих фактов.]';

const INTRIGUE_INJECT_HEADER = '[Тайны и интриги — секрет автора, игрок правды не знает. Раскрывай постепенно: через намёки, улики, оговорки NPC, слухи (в том числе ложные). Не выдавай правду целиком раньше времени и не форсируй.]';

const GENRE_HINTS = {
    'Комедия': 'недоразумения, нелепые ситуации, забавные привычки и реакции, неловкие моменты, конфликты с низкими ставками, которые разрешаются смехом',
    'Повседневность': 'быт, мелкие ритуалы, совместные дела, маленькие открытия друг о друге, уютные события',
    'Романтика': 'сближение, флирт, неловкая забота, ревность без драмы, моменты близости',
    'Эротика': 'притяжение, чувственное напряжение между персонажами, интимные моменты и их предвкушение',
    'Драма': 'серьёзные чувства, внутренние конфликты, трудные решения и их последствия',
    'Ангст': 'боль, тоска, недосказанность, эмоциональные раны',
    'Приключения': 'вылазки, новые места, находки, неожиданные встречи',
    'Экшн': 'стычки, погони, опасность, физические испытания',
    'Мистика': 'необъяснимое, странные совпадения, сверхъестественное',
    'Ужасы': 'страх, жуткое, нарастающая угроза',
    'Детектив': 'загадки, улики, расследование, скрытые мотивы',
};

const GENRES = ['Комедия', 'Повседневность', 'Романтика', 'Эротика', 'Драма', 'Ангст', 'Приключения', 'Экшн', 'Мистика', 'Ужасы', 'Детектив'];

const defaults = {
    enabled: true,
    interval: 12,
    depth: 4,
    role: 0,
    maxActive: 12,
    maxIntrigues: 5,
    maxNpcs: 20,
    maxArcs: 6,
    minStimuli: 2,
    showToasts: true,
    hideSpoilers: false,
    thinkPrompt: DEFAULT_THINK,
    injectPrompt: DEFAULT_INJECT,
};

let busy = false;

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE]) all[MODULE] = structuredClone(defaults);
    for (const k of Object.keys(defaults)) {
        if (all[MODULE][k] === undefined) all[MODULE][k] = defaults[k];
    }
    const s = all[MODULE];
    // Обновляем сохранённый стандартный промпт из старых версий (он не содержал новых разделов)
    if ((s.promptVersion || 0) < 2) {
        if (s.thinkPrompt.includes('Пауза в ролевой игре') && !s.thinkPrompt.includes('{{npcs}}')) {
            s.thinkPrompt = DEFAULT_THINK;
        }
        s.promptVersion = 2;
        ctx().saveSettingsDebounced();
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

// Хранилище текущего чата (null, если чат не открыт)
function store() {
    const c = ctx();
    if (!c.chatId || !c.chatMetadata) return null;
    if (!c.chatMetadata[MODULE]) {
        c.chatMetadata[MODULE] = {
            notes: [],
            archive: [],
            nextId: 1,
            lastThinkAt: c.chat?.length ?? 0,
            lastRaw: '',
        };
    }
    const st = c.chatMetadata[MODULE];
    if (!st.direction) st.direction = { genres: [], customGenre: '', inspiration: '' };
    if (!st.direction.mixMode) st.direction.mixMode = 'and';
    if (typeof st.direction.avoid !== 'string') st.direction.avoid = '';
    if (st.direction.intrigues === undefined) st.direction.intrigues = true;
    if (!st.rejected) st.rejected = [];
    if (!st.intrigues) st.intrigues = [];
    if (!st.nextIntrigueId) st.nextIntrigueId = 1;
    if (st.direction.npcs === undefined) st.direction.npcs = true;
    if (!st.npcs) st.npcs = [];
    if (!st.nextNpcId) st.nextNpcId = 1;
    if (st.direction.arcs === undefined) st.direction.arcs = true;
    if (!st.arcs) st.arcs = [];
    if (!st.evolved) st.evolved = [];
    if (!st.nextArcId) st.nextArcId = 1;
    return st;
}

function formatNotes(notes) {
    if (!notes.length) return '(пока пусто)';
    const len = ctx().chat?.length ?? 0;
    return notes
        .map(n => `#${n.id}${n.tag ? ` [${n.tag}]` : ''} (записано ${Math.max(0, len - n.at)} сообщ. назад): ${n.text}`)
        .join('\n');
}

function buildDirection(st) {
    const parts = [buildGenreDirection(st)];
    if (st?.rejected?.length) {
        parts.push('Игрок отклонил эти идеи — не предлагай их и похожие:\n' + st.rejected.map(t => `— ${t}`).join('\n'));
    }
    return parts.filter(Boolean).join('\n\n');
}

function buildGenreDirection(st) {
    const d = st?.direction;
    if (!d) return '';
    const genres = [...d.genres];
    const custom = d.customGenre?.trim();
    if (custom) genres.push(custom);
    const insp = d.inspiration?.trim();
    const avoid = d.avoid?.trim();
    if (!genres.length && !insp && !avoid) return '';
    const lines = ['НАПРАВЛЕНИЕ ИСТОРИИ — главное правило для всех разделов блокнота (задумок, тайн, развития):'];
    const hint = g => GENRE_HINTS[g] ? `${g} (${GENRE_HINTS[g]})` : g;
    if (genres.length === 1) {
        lines.push(`— жанр: ${hint(genres[0])}.`);
    } else if (genres.length > 1 && d.mixMode === 'or') {
        lines.push(`— жанры: ${genres.map(hint).join('; ')}. Каждая задумка — в ОДНОМ из этих жанров, не смешивай их внутри одной идеи; чередуй жанры между задумками.`);
    } else if (genres.length > 1) {
        lines.push(`— жанры: ${genres.map(hint).join('; ')}. Каждая задумка должна сочетать эти жанры одновременно.`);
    }
    if (genres.length) {
        lines.push('— жанр определяет, из чего строятся задумки и какие в них ставки. Предлагай только то, что работает на выбранный жанр. Не тащи элементы чужих жанров: если выбраны лёгкие жанры, не вводи внешние угрозы, бюрократию, преследование, опасность — конфликты должны быть мелкими, личными и решаемыми.');
        lines.push('— тайны, слухи и интриги уместны в любом жанре — меняется только их характер. В комедии и повседневности это сплетни соседей, нелепые слухи, недоразумения, секрет ради сюрприза, чьи-то тайные привычки; в романтике — тайный поклонник, слухи о романе, интрижки, ревность, скрытые чувства. Запрет на угрозы и опасность не отменяет интриги — просто делай их лёгкими.');
    }
    if (insp) lines.push(`— источник вдохновения: ${insp}. Бери оттуда ситуации, детали, характеры и настроение, но не копируй напрямую — переноси в этот мир и к этим персонажам.`);
    if (avoid) lines.push(`— НИКОГДА не предлагай: ${avoid}.`);
    lines.push('Не ломай логику уже идущей истории.');
    return lines.join('\n');
}

function formatIntrigues(list) {
    if (!list.length) return '(пока нет)';
    const len = ctx().chat?.length ?? 0;
    return list.map(it => {
        let line = `T${it.id}${it.tag ? ` [${it.tag}]` : ''} (заведено ${Math.max(0, len - it.at)} сообщ. назад): ${it.text}`;
        line += it.clues.length
            ? '\n   Уже открылось игроку: ' + it.clues.map(c => c.text).join('; ')
            : '\n   Игрок пока ничего об этом не знает.';
        return line;
    }).join('\n');
}

function findNpc(st, name) {
    const key = name.trim().toLowerCase().replaceAll('ё', 'е');
    return st.npcs.find(n => n.name.trim().toLowerCase().replaceAll('ё', 'е') === key);
}

function formatNpcs(list, forThink = false) {
    if (!list.length) return '(пока нет)';
    return list.map(n => {
        let line = `— ${n.name}: ${n.card}`;
        if (forThink && n.locked) line += ' (карточку правил игрок — не меняй её, только NPCSTATE)';
        if (n.status) line += `\n   Сейчас: ${n.status}`;
        return line;
    }).join('\n');
}

function buildNpcSection(st) {
    if (!st?.direction?.npcs) return '';
    return `Персонажи (NPC). Ты ведёшь краткие карточки значимых NPC — это канон истории.

Текущие карточки:
${formatNpcs(st.npcs, true)}

Команды для них (с новой строки, вместе с остальными):
NPC [Имя]: кто это, внешность, характер, отношение к {{user}} — 1–3 предложения. Для нового NPC или если в истории изменилось что-то постоянное.
NPCSTATE [Имя]: где он сейчас и что с ним происходит — коротко.
Если у значимого NPC из чата ещё нет карточки — обязательно заведи её. Заводи только NPC, которые реально появились в чате и важны для истории. Не заводи карточки для {{char}} и {{user}}. Тайные мотивы сюда не пиши — для них есть тайны. Карточки NPC не считаются в лимит новых записей.`;
}

function formatArcs(st, forThink = false) {
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    const lines = st.arcs.map(a => {
        const stg = ARC_STAGES[a.stage];
        let line = forThink
            ? `A${a.id} ${a.who}: ${a.text}. Стадия ${a.stage}/${ARC_MAX} (${stg.name}).`
            : `${a.who} — ${a.text}. Стадия ${a.stage}/${ARC_MAX} «${stg.name}»: ${stg.hint}.`;
        if (a.current) line += ` Сейчас: ${a.current}`;
        if (forThink) {
            line += `\n   Стимулов с прошлого сдвига: ${a.sinceShift} из ${need} нужных.`;
            if (a.stimuli.length) line += '\n   Стимулы: ' + a.stimuli.map(x => x.text).join('; ');
        }
        return line;
    });
    if (st.evolved.length) {
        lines.push('Закреплённые изменения:\n' + st.evolved.map(e => `— ${e.who}: ${e.text}`).join('\n'));
    }
    return lines.length ? lines.join('\n') : '(пока нет)';
}

function buildArcSection(st) {
    if (!st?.direction?.arcs) return '';
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    const stages = ARC_STAGES.slice(1).map((x, i) => `${i + 1}. ${x.name} — ${x.hint}`).join('\n');
    return `Развитие персонажей. Характеры не статичны: под влиянием событий персонажи, включая {{char}}, могут меняться — в лучшую или в худшую сторону. Карточка персонажа описывает, каким он был в начале истории.

Стадии развития:
${stages}

Текущие арки:
${formatArcs(st, true)}

Команды для них (с новой строки, вместе с остальными):
ARC [Имя]: черта сейчас → во что может развиться. Если персонаж уже заметно меняется под влиянием событий или отношений — заведи арку; если почвы нет — не выдумывай.
STIMULUS #A1: что в чате подтолкнуло изменение (только то, что действительно произошло)
SHIFT #A1: как теперь проявляется характер — переход на следующую стадию. Возможен, только когда с прошлого сдвига накопилось не меньше ${need} стимулов.
REGRESS #A1: что отбросило персонажа назад
DROP #A1 — арка больше не актуальна
Изменения должны быть заслуженными и постепенными. Не меняй ядро личности: грубиян может научиться заботе, но остаётся собой — с тем же юмором, манерой речи и привычками. Конец арки — один заметный шаг роста, а не другая личность: черты, на которых держится характер (тревожность, застенчивость, вспыльчивость, лень и т.п.), смягчаются, но не исчезают. Формулируй цель так: «всё ещё [прежняя черта], но [что изменилось]», а не «уверенный», «раскрепощённый», «бесстрашный». Арки не считаются в лимит новых записей.`;
}

function buildIntrigueSection(st) {
    if (!st?.direction?.intrigues) return '';
    const max = Math.max(1, Number(settings().maxIntrigues) || 5);
    return `Тайны и интриги. Параллельно задумкам ты ведёшь скрытые сюжетные линии: тайны, загадки, слухи (правдивые или ложные), заговоры и интриги NPC. Записывай суть так, как её знает только автор.

Текущие тайны:
${formatIntrigues(st.intrigues)}

Команды для них (с новой строки, вместе с остальными):
INTRIGUE [тайна|загадка|слух|интрига]: в чём правда на самом деле
CLUE #T1: что из этой тайны уже прозвучало или открылось в чате (только то, что действительно было)
SOLVED #T1 — тайна раскрыта
DROP #T1 — линия больше не нужна
${st.intrigues.length ? 'Новую тайну заводи, если она по-настоящему обогатит историю.' : 'Сейчас у истории нет ни одной тайны — заведи хотя бы одну, подходящую к жанру и происходящему.'} Одновременно держи не больше ${max}.`;
}

function fillTemplate(template, notes, direction = '', intrigues = '', npcs = '', arcs = '') {
    const c = ctx();
    const MARK = '\u0001NNB_NOTES\u0001';
    const DMARK = '\u0001NNB_DIR\u0001';
    const IMARK = '\u0001NNB_INT\u0001';
    const NMARK = '\u0001NNB_NPC\u0001';
    const AMARK = '\u0001NNB_ARC\u0001';
    const withMark = c.substituteParams(template
        .replaceAll('{{notes}}', MARK)
        .replaceAll('{{direction}}', DMARK)
        .replaceAll('{{intrigues}}', IMARK)
        .replaceAll('{{npcs}}', NMARK)
        .replaceAll('{{arcs}}', AMARK));
    return withMark
        .replaceAll(MARK, formatNotes(notes))
        .replaceAll(DMARK, direction)
        .replaceAll(IMARK, intrigues)
        .replaceAll(NMARK, c.substituteParams(npcs))
        .replaceAll(AMARK, c.substituteParams(arcs))
        .replace(/\n{3,}/g, '\n\n');
}

function updateInjection() {
    const c = ctx();
    const s = settings();
    const st = store();
    const showIntrigues = st?.direction?.intrigues && st.intrigues.length;
    const showNpcs = st?.direction?.npcs && st.npcs.length;
    const showArcs = st?.direction?.arcs && (st.arcs.length || st.evolved.length);
    if (!s.enabled || !st || (!st.notes.length && !showIntrigues && !showNpcs && !showArcs)) {
        c.setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
        return;
    }
    const blocks = [];
    if (showNpcs) blocks.push(NPC_INJECT_HEADER + '\n' + formatNpcs(st.npcs));
    if (showArcs) blocks.push(ARC_INJECT_HEADER + '\n' + formatArcs(st));
    if (st.notes.length) blocks.push(fillTemplate(s.injectPrompt, st.notes));
    if (showIntrigues) blocks.push(INTRIGUE_INJECT_HEADER + '\n' + formatIntrigues(st.intrigues));
    c.setExtensionPrompt(
        INJECT_KEY,
        blocks.join('\n\n'),
        POS_IN_CHAT,
        Number(s.depth) || 0,
        false,
        Number(s.role) || 0,
    );
}

// Совместимость со старой и новой сигнатурой generateQuietPrompt
let ownRequest = false;

async function quietGenerateOnce(prompt) {
    const fn = ctx().generateQuietPrompt;
    ownRequest = true;
    try {
        if (fn.length === 0) {
            return await fn({ quietPrompt: prompt });
        }
        return await fn(prompt, false, false);
    } finally {
        ownRequest = false;
    }
}

// Таверна добавляет скрытый промпт в конец как системное сообщение. Gemini через
// OpenAI-совместимый прокси без постобработки промпта на этом падает (Bad Request),
// поэтому в наших запросах делаем его сообщением пользователя.
const OWN_MARKER = '[OOC: Пауза в ролевой игре';
function fixOwnPromptRole(data) {
    if (!ownRequest || !data || data.dryRun || !Array.isArray(data.chat)) return;
    const msgs = data.chat;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (typeof m?.content !== 'string' || !m.content.includes(OWN_MARKER)) continue;
        const prev = msgs[i - 1];
        if (prev && prev.role === 'user' && typeof prev.content === 'string') {
            prev.content += '\n\n' + m.content;
            msgs.splice(i, 1);
        } else {
            m.role = 'user';
            delete m.name;
        }
        return;
    }
}

// Модели иногда ставят вместо пробелов невидимые символы (⠀, неразрывный пробел и т.п.) —
// приводим их к обычным пробелам, иначе команды не распознаются
const ODD_SPACES = /[   -​  ⠀　ㅤ﻿]/g;
function normalizeSpaces(t) {
    return String(t ?? '').replace(ODD_SPACES, ' ');
}

async function quietGenerate(prompt) {
    return normalizeSpaces(await quietGenerateRetry(prompt));
}

// При ошибке лимита (429) ждём и пробуем ещё раз
async function quietGenerateRetry(prompt) {
    try {
        return await quietGenerateOnce(prompt);
    } catch (err) {
        const msg = String(err?.message || err);
        if (!/429|too many|rate|exhausted|quota/i.test(msg)) throw err;
        setStatus('Лимит запросов — жду 30 секунд и пробую ещё раз…');
        toastr.info('Лимит запросов у провайдера. Повторю через 30 секунд.', 'Блокнот рассказчика');
        await new Promise(r => setTimeout(r, 30000));
        return await quietGenerateOnce(prompt);
    }
}

function parseAndApply(raw) {
    const st = store();
    const s = settings();
    const len = ctx().chat.length;
    const res = { added: [], done: [], dropped: [], intrigues: [], clues: 0, solved: 0 };
    const intriguesOn = !!st.direction?.intrigues;
    const npcsOn = !!st.direction?.npcs;
    res.npcNew = 0;
    res.npcUpd = 0;
    const arcsOn = !!st.direction?.arcs;
    const need = Math.max(1, Number(s.minStimuli) || 2);
    Object.assign(res, { arcNew: 0, stimuli: 0, shifts: 0, evolved: 0, regress: 0 });
    const findArc = n => st.arcs.find(a => a.id === Number(n));

    const text = String(raw || '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/\*\*/g, '')
        .trim();

    if (!text || /^NONE[.!]?$/i.test(text)) return res;

    for (let line of text.split('\n')) {
        line = line.trim().replace(/^[-*•>\s]+/, '').replace(/^`+|`+$/g, '');
        if (!line) continue;

        let m = line.match(/^ADD\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const note = { id: st.nextId++, tag: (m[1] || '').trim(), text: m[2].trim(), at: len };
            st.notes.push(note);
            res.added.push(note);
            continue;
        }

        m = line.match(/^ARC(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            if (arcsOn && st.arcs.length < (Number(s.maxArcs) || 6)) {
                st.arcs.push({ id: st.nextArcId++, who: m[1].trim(), text: m[2].trim(), stage: 1, current: '', stimuli: [], sinceShift: 0, at: len });
                res.arcNew++;
            }
            continue;
        }

        m = line.match(/^STIMULUS\s*#?\s*A\s*(\d+)\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const a = arcsOn && findArc(m[1]);
            if (a) {
                a.stimuli.push({ text: m[2].trim(), at: len });
                if (a.stimuli.length > 6) a.stimuli.shift();
                a.sinceShift++;
                res.stimuli++;
            }
            continue;
        }

        m = line.match(/^(SHIFT|REGRESS)\s*#?\s*A\s*(\d+)\s*[:：—–-]?\s*(.*)$/i);
        if (m) {
            const a = arcsOn && findArc(m[2]);
            if (!a) continue;
            const desc = m[3].trim();
            if (m[1].toUpperCase() === 'REGRESS') {
                a.stage = Math.max(1, a.stage - 1);
                a.sinceShift = 0;
                if (desc) a.current = desc;
                res.regress++;
            } else if (a.sinceShift >= need) {
                a.stage++;
                a.sinceShift = 0;
                if (desc) a.current = desc;
                if (a.stage >= ARC_MAX) {
                    st.evolved.push({ who: a.who, text: `${a.text}${a.current ? ` — ${a.current}` : ''}`, at: len });
                    st.arcs = st.arcs.filter(x => x !== a);
                    res.evolved++;
                } else {
                    res.shifts++;
                }
            }
            continue;
        }

        m = line.match(/^DROP\s*#?\s*A\s*(\d+)/i);
        if (m) {
            st.arcs = st.arcs.filter(a => a.id !== Number(m[1]));
            continue;
        }

        m = line.match(/^NPC(?!STATE)(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            if (npcsOn) {
                const name = m[1].trim();
                const n = findNpc(st, name);
                if (!n) {
                    if (st.npcs.length < (Number(s.maxNpcs) || 20)) {
                        st.npcs.push({ id: st.nextNpcId++, name, card: m[2].trim(), status: '', locked: false, at: len });
                        res.npcNew++;
                    }
                } else if (!n.locked) {
                    n.card = m[2].trim();
                    res.npcUpd++;
                }
            }
            continue;
        }

        m = line.match(/^NPCSTATE(?=[\s\[:：])\s*[:：]?\s*\[?([^\]:：—–\n]{1,60}?)\]?\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/i);
        if (m) {
            const n = npcsOn && findNpc(st, m[1]);
            if (n) {
                n.status = m[2].trim();
                res.npcUpd++;
            }
            continue;
        }

        m = line.match(/^INTRIGUE\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            if (intriguesOn) {
                const it = { id: st.nextIntrigueId++, tag: (m[1] || '').trim(), text: m[2].trim(), clues: [], at: len };
                st.intrigues.push(it);
                res.intrigues.push(it);
            }
            continue;
        }

        m = line.match(/^CLUE\s*#?\s*T?\s*(\d+)\s*[:：—–-]\s*(.+)$/i);
        if (m) {
            const it = st.intrigues.find(x => x.id === Number(m[1]));
            if (it) {
                it.clues.push({ text: m[2].trim(), at: len });
                if (it.clues.length > 8) it.clues.shift();
                res.clues++;
            }
            continue;
        }

        m = line.match(/^(SOLVED|DROP)\s*:?\s*#?\s*T\s*(\d+)/i);
        if (m) {
            const i = st.intrigues.findIndex(x => x.id === Number(m[2]));
            if (i >= 0) {
                const [it] = st.intrigues.splice(i, 1);
                it.kind = 'intrigue';
                it.status = m[1].toUpperCase() === 'SOLVED' ? 'done' : 'dropped';
                it.closedAt = len;
                st.archive.push(it);
                if (it.status === 'done') res.solved++;
            }
            continue;
        }

        m = line.match(/^(DONE|DROP)\s*:?\s*#?\s*(\d+)/i);
        if (m) {
            const id = Number(m[2]);
            const i = st.notes.findIndex(n => n.id === id);
            if (i >= 0) {
                const [n] = st.notes.splice(i, 1);
                n.status = m[1].toUpperCase() === 'DONE' ? 'done' : 'dropped';
                n.closedAt = len;
                st.archive.push(n);
                (n.status === 'done' ? res.done : res.dropped).push(n);
            }
        }
    }

    const max = Math.max(1, Number(s.maxActive) || 12);
    while (st.notes.length > max) {
        const n = st.notes.shift();
        n.status = 'dropped';
        n.closedAt = len;
        st.archive.push(n);
    }
    const maxI = Math.max(1, Number(s.maxIntrigues) || 5);
    while (st.intrigues.length > maxI) {
        const it = st.intrigues.shift();
        Object.assign(it, { kind: 'intrigue', status: 'dropped', closedAt: len });
        st.archive.push(it);
    }
    if (st.archive.length > 50) st.archive.splice(0, st.archive.length - 50);
    return res;
}

function report(res, manual, raw) {
    const s = settings();
    const clean = String(raw || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
    if (!clean) {
        toastr.warning('Модель вернула пустой ответ. Обычно это значит, что «думающей» модели не хватило лимита длины ответа, или ответ заблокировал фильтр провайдера.', 'Блокнот рассказчика', { timeOut: 10000 });
        return;
    }
    const parts = [];
    if (res.added.length) parts.push(`новых записей: ${res.added.length}`);
    if (res.done.length) parts.push(`выполнено: ${res.done.length}`);
    if (res.dropped.length) parts.push(`вычеркнуто: ${res.dropped.length}`);
    if (res.intrigues.length) parts.push(`новых тайн: ${res.intrigues.length}`);
    if (res.clues) parts.push(`открылось улик: ${res.clues}`);
    if (res.solved) parts.push(`раскрыто тайн: ${res.solved}`);
    if (res.npcNew) parts.push(`новых NPC: ${res.npcNew}`);
    if (res.npcUpd) parts.push(`обновлено NPC: ${res.npcUpd}`);
    if (res.arcNew) parts.push(`новых арок: ${res.arcNew}`);
    if (res.stimuli) parts.push(`стимулов: ${res.stimuli}`);
    if (res.shifts) parts.push(`🌱 сдвигов характера: ${res.shifts}`);
    if (res.evolved) parts.push(`🌳 закреплено изменений: ${res.evolved}`);
    if (res.regress) parts.push(`откатов: ${res.regress}`);
    if (!parts.length) {
        if (/^NONE[.!]?$/i.test(clean.replace(/\*\*/g, ''))) {
            if (manual) toastr.info('Модель решила ничего не записывать', 'Блокнот рассказчика');
        } else {
            toastr.warning('Модель ответила не по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика', { timeOut: 8000 });
        }
        return;
    }
    if (!s.showToasts && !manual) return;
    let body = parts.join(', ');
    if (!s.hideSpoilers && res.added.length) {
        body += '<br>' + res.added.map(n => `• ${escapeHtml(n.text)}`).join('<br>');
    }
    if (!s.hideSpoilers && res.intrigues.length) {
        body += '<br>' + res.intrigues.map(n => `🔒 ${escapeHtml(n.text)}`).join('<br>');
    }
    toastr.success(body, 'Блокнот рассказчика', { escapeHtml: false, timeOut: 8000 });
}

function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function think(manual = false) {
    if (busy) return;
    const s = settings();
    const st = store();
    if (!st) {
        if (manual) toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
        return;
    }
    if (!ctx().chat?.length) return;

    const chatIdAtStart = ctx().chatId;
    busy = true;
    setStatus('Модель листает блокнот…');
    // убираем инъекцию на время размышления, чтобы блокнот не дублировался
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);

    try {
        const tpl = ensureSections(s.thinkPrompt);
        const raw = await quietGenerate(fillTemplate(tpl, st.notes, buildDirection(st), buildIntrigueSection(st), buildNpcSection(st), buildArcSection(st)));
        if (ctx().chatId !== chatIdAtStart) return; // чат сменили, пока модель думала
        st.lastRaw = String(raw ?? '');
        const res = parseAndApply(raw);
        report(res, manual, raw);
    } catch (err) {
        console.error('[npc_notebook]', err);
        toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
    } finally {
        if (ctx().chatId === chatIdAtStart) {
            st.lastThinkAt = ctx().chat.length;
            await ctx().saveMetadata();
        }
        busy = false;
        updateInjection();
        renderPanel();
    }
}

// Если в своём промпте нет нужных разделов, вставляем их перед финальной инструкцией
function ensureSections(tpl) {
    const missing = ['direction', 'npcs', 'arcs', 'intrigues'].filter(k => !tpl.includes(`{{${k}}}`));
    if (!missing.length) return tpl;
    const block = missing.map(k => `{{${k}}}`).join('\n\n') + '\n\n';
    let at = tpl.lastIndexOf('Ответь ТОЛЬКО');
    if (at < 0) at = tpl.lastIndexOf('NONE');
    if (at < 0) return tpl + '\n\n' + block;
    const lineStart = tpl.lastIndexOf('\n', at) + 1;
    return tpl.slice(0, lineStart) + block + tpl.slice(lineStart);
}

async function rerollNote(id, kind = 'note') {
    if (busy) return;
    const st = store();
    const isIntrigue = kind === 'intrigue';
    const note = (isIntrigue ? st?.intrigues : st?.notes)?.find(n => n.id === id);
    if (!note) return;
    const chatIdAtStart = ctx().chatId;
    busy = true;
    setStatus('Модель переписывает задумку…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        const others = isIntrigue ? st.notes : st.notes.filter(n => n.id !== id);
        const tpl = (isIntrigue ? REROLL_INTRIGUE_PROMPT : REROLL_PROMPT).replace('{{old}}', note.text);
        const prompt = fillTemplate(tpl, others, buildDirection(st));
        const raw = String(await quietGenerate(prompt) ?? '');
        if (ctx().chatId !== chatIdAtStart) return;
        st.lastRaw = raw;
        const clean = raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/\*\*/g, '');
        let m = null;
        for (let line of clean.split('\n')) {
            line = line.trim().replace(/^[-*•>\s]+/, '');
            m = line.match(isIntrigue
                ? /^INTRIGUE\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i
                : /^ADD\s*(?:\[([^\]]{1,40})\])?\s*[:：—–-]\s*(.+)$/i);
            if (m) break;
        }
        if (!m) {
            toastr.warning('Модель ответила не по формату — загляни в «Последний ответ модели»', 'Блокнот рассказчика');
            return;
        }
        st.rejected.push(note.text);
        if (st.rejected.length > 15) st.rejected.splice(0, st.rejected.length - 15);
        note.text = m[2].trim().replace(/\]$/, '');
        if (m[1]) note.tag = m[1].trim();
        note.at = ctx().chat.length;
        if (isIntrigue) note.clues = [];
        if (!settings().hideSpoilers) toastr.success(escapeHtml(note.text), 'Новая задумка', { escapeHtml: false, timeOut: 8000 });
        else toastr.success('Задумка заменена', 'Блокнот рассказчика');
    } catch (err) {
        console.error('[npc_notebook]', err);
        toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
    } finally {
        if (ctx().chatId === chatIdAtStart) await ctx().saveMetadata();
        busy = false;
        updateInjection();
        renderPanel();
    }
}

function onMessageReceived() {
    updateInjection();
    renderPanel();
    const s = settings();
    const st = store();
    if (!s.enabled || !st || busy) return;
    const len = ctx().chat.length;
    if (st.lastThinkAt > len) st.lastThinkAt = len; // сообщения удаляли
    if (len - st.lastThinkAt >= (Number(s.interval) || 12)) {
        setTimeout(() => think(false), 800);
    }
}

// ---------- интерфейс ----------

const PANEL_HTML = `
<div class="npc-notebook-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Блокнот рассказчика</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content" id="nnb_panel">
      <label class="checkbox_label"><input type="checkbox" id="nnb_enabled"> Включено</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_toasts"> Уведомлять о новых записях</label>
      <label class="checkbox_label"><input type="checkbox" id="nnb_spoilers"> Не подглядывать (размыть текст записей)</label>

      <div class="nnb-row"><label for="nnb_interval">Думать каждые N сообщений</label><input type="number" min="2" max="200" class="text_pole" id="nnb_interval"></div>
      <div class="nnb-row"><label for="nnb_depth">Глубина вставки блокнота</label><input type="number" min="0" max="50" class="text_pole" id="nnb_depth"></div>
      <div class="nnb-row"><label for="nnb_max">Максимум активных записей</label><input type="number" min="1" max="50" class="text_pole" id="nnb_max"></div>
      <div class="nnb-row"><label for="nnb_max_int">Максимум активных тайн</label><input type="number" min="1" max="20" class="text_pole" id="nnb_max_int"></div>
      <div class="nnb-row"><label for="nnb_min_stim">Стимулов для сдвига характера</label><input type="number" min="1" max="10" class="text_pole" id="nnb_min_stim"></div>
      <div class="nnb-row"><label for="nnb_role">Роль вставки</label>
        <select class="text_pole" id="nnb_role">
          <option value="0">system</option>
          <option value="1">user</option>
          <option value="2">assistant</option>
        </select>
      </div>

      <div class="nnb-direction">
        <b>Направление этого чата</b>
        <small>Если ничего не выбрано, модель придумывает свободно.</small>
        <div class="nnb-chips" id="nnb_genres"></div>
        <input type="text" class="text_pole" id="nnb_custom_genre" placeholder="Свой жанр или настроение">
        <div class="nnb-row"><label for="nnb_mix">Если жанров несколько</label>
          <select class="text_pole nnb-wide" id="nnb_mix">
            <option value="and">Смешивать (И)</option>
            <option value="or">По одному (ИЛИ)</option>
          </select>
        </div>
        <textarea class="text_pole nnb-insp" id="nnb_inspiration" rows="2" placeholder="Источник вдохновения: тайтл, тема, настроение…"></textarea>
        <textarea class="text_pole nnb-insp" id="nnb_avoid" rows="2" placeholder="Чего избегать: например, документы, бюрократия, службы отлова, угрозы извне"></textarea>
        <label class="checkbox_label"><input type="checkbox" id="nnb_intrigues_on"> Тайны и интриги в этом чате</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_npcs_on"> Карточки NPC в этом чате</label>
        <label class="checkbox_label"><input type="checkbox" id="nnb_arcs_on"> Развитие персонажей в этом чате</label>
      </div>

      <div class="nnb-status" id="nnb_status"></div>
      <div class="nnb-buttons">
        <div class="menu_button" id="nnb_think_now"><i class="fa-solid fa-feather"></i> Подумать сейчас</div>
        <div class="menu_button" id="nnb_add"><i class="fa-solid fa-plus"></i> Добавить запись</div>
        <div class="menu_button" id="nnb_clear"><i class="fa-solid fa-broom"></i> Очистить блокнот</div>
      </div>

      <div id="nnb_list"></div>
      <div id="nnb_intrigue_list"></div>
      <div id="nnb_npc_list"></div>
      <div id="nnb_arc_list"></div>

      <details>
        <summary>Промпт размышления</summary>
        <small>{{notes}} — текущие записи, {{user}} и {{char}} работают как обычно.</small>
        <textarea class="text_pole" id="nnb_think_prompt" rows="10"></textarea>
        <div class="menu_button" id="nnb_reset_think">Вернуть стандартный</div>
      </details>
      <details>
        <summary>Шаблон вставки в чат</summary>
        <textarea class="text_pole" id="nnb_inject_prompt" rows="5"></textarea>
        <div class="menu_button" id="nnb_reset_inject">Вернуть стандартный</div>
      </details>
    </div>
  </div>
</div>`;

function setStatus(text) {
    if (text) {
        $('#nnb_status').text(text);
        return;
    }
    const st = store();
    const s = settings();
    if (!st) {
        $('#nnb_status').text('Чат не открыт');
        return;
    }
    const len = ctx().chat?.length ?? 0;
    const left = Math.max(0, (Number(s.interval) || 12) - (len - st.lastThinkAt));
    $('#nnb_status').text(s.enabled ? `До следующего размышления: ${left} сообщ.` : 'Выключено');
}

async function askText(title, initial = '') {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        const r = await c.callGenericPopup(title, c.POPUP_TYPE.INPUT, initial, { rows: 4 });
        return typeof r === 'string' ? r : null;
    }
    return window.prompt(title, initial);
}

function renderPanel() {
    const s = settings();
    $('#nnb_panel').toggleClass('nnb-spoiler', !!s.hideSpoilers);
    const list = $('#nnb_list').empty();
    const st = store();
    if (!busy) setStatus('');
    if (!st) return;

    if (!st.notes.length) {
        list.append('<div class="nnb-empty">Блокнот пуст. Модель сама начнёт записывать задумки, или нажми «Подумать сейчас».</div>');
    }
    const len = ctx().chat?.length ?? 0;

    for (const n of st.notes) {
        const row = $(`
          <div class="nnb-note">
            <div class="nnb-meta"></div>
            <div class="nnb-text"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-dice" title="Реролл: придумать другую"></i>
              <i class="fa-solid fa-check" title="Выполнено"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`#${n.id}${n.tag ? ` · ${n.tag}` : ''} · ${Math.max(0, len - n.at)} сообщ. назад`);
        row.find('.nnb-text').text(n.text);
        row.find('.fa-dice').on('click', () => rerollNote(n.id));
        row.find('.fa-check').on('click', () => closeNote(n.id, 'done'));
        row.find('.fa-trash').on('click', () => closeNote(n.id, 'deleted'));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Изменить запись', n.text);
            if (t && t.trim()) {
                n.text = t.trim();
                await commit();
            }
        });
        list.append(row);
    }

    renderIntrigues(st, len);
    renderNpcs(st);
    renderArcs(st);

    if (st.archive.length) {
        const det = $('<details><summary></summary><div></div></details>');
        det.find('summary').text(`Архив (${st.archive.length})`);
        const box = det.find('div');
        for (const n of [...st.archive].reverse()) {
            const mark = n.status === 'done' ? '✓' : '✗';
            const num = n.kind === 'intrigue' ? `🔒T${n.id}` : `#${n.id}`;
            box.append($('<div class="nnb-note nnb-archived"><div class="nnb-text"></div></div>')
                .find('.nnb-text').text(`${mark} ${num}${n.tag ? ` [${n.tag}]` : ''} ${n.text}`).end());
        }
        list.append(det);
    }

    if (st.rejected.length) {
        const det = $('<details><summary></summary><div></div><div class="menu_button">Забыть отклонённые</div></details>');
        det.find('summary').text(`Отклонённые идеи (${st.rejected.length})`);
        for (const t of [...st.rejected].reverse()) {
            det.find('div').first().append($('<div class="nnb-note nnb-archived"><div class="nnb-text"></div></div>').find('.nnb-text').text(t).end());
        }
        det.find('.menu_button').on('click', async () => { st.rejected = []; await commit(); });
        list.append(det);
    }

    if (st.lastRaw !== undefined && (st.lastRaw || st.lastThinkAt)) {
        const det = $('<details><summary>Последний ответ модели</summary><pre class="nnb-raw"></pre></details>');
        det.find('pre').text(st.lastRaw || '(пустой ответ)');
        list.append(det);
    }
}

let dirSaveTimer = null;
function saveDirectionSoon() {
    clearTimeout(dirSaveTimer);
    dirSaveTimer = setTimeout(() => ctx().saveMetadata(), 800);
}

function renderDirection() {
    const st = store();
    const box = $('#nnb_genres').empty();
    const enabled = !!st;
    for (const g of GENRES) {
        const lbl = $('<label class="checkbox_label nnb-chip"><input type="checkbox"><span></span></label>');
        lbl.find('span').text(g);
        const cb = lbl.find('input').prop('checked', !!st?.direction.genres.includes(g)).prop('disabled', !enabled);
        cb.on('change', () => {
            const s2 = store();
            if (!s2) return;
            const set = new Set(s2.direction.genres);
            cb.prop('checked') ? set.add(g) : set.delete(g);
            s2.direction.genres = GENRES.filter(x => set.has(x));
            saveDirectionSoon();
        });
        box.append(lbl);
    }
    $('#nnb_custom_genre').val(st?.direction.customGenre ?? '').prop('disabled', !enabled);
    $('#nnb_mix').val(st?.direction.mixMode ?? 'and').prop('disabled', !enabled);
    $('#nnb_intrigues_on').prop('checked', !!st?.direction.intrigues).prop('disabled', !enabled);
    $('#nnb_npcs_on').prop('checked', !!st?.direction.npcs).prop('disabled', !enabled);
    $('#nnb_arcs_on').prop('checked', !!st?.direction.arcs).prop('disabled', !enabled);
    $('#nnb_inspiration').val(st?.direction.inspiration ?? '').prop('disabled', !enabled);
    $('#nnb_avoid').val(st?.direction.avoid ?? '').prop('disabled', !enabled);
}

function renderIntrigues(st, len) {
    let box = $('#nnb_intrigue_list').empty();
    if (!st.direction.intrigues) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🔒 Тайны и интриги (${st.intrigues.length})`);
    box.append(det);
    box = det;
    const addBtn = $('<div class="menu_button"><i class="fa-solid fa-plus"></i> Добавить тайну</div>');
    addBtn.on('click', async () => {
        const t = await askText('Новая тайна, слух или интрига — в чём правда на самом деле (можно начать с [тег], например [слух])');
        if (!t || !t.trim()) return;
        const m = t.trim().match(/^\[([^\]]{1,40})\]\s*([\s\S]+)$/);
        st.intrigues.push({ id: st.nextIntrigueId++, tag: m ? m[1] : '', text: (m ? m[2] : t).trim(), clues: [], at: ctx().chat.length });
        await commit();
    });
    if (!st.intrigues.length) {
        box.append('<div class="nnb-empty">Пока нет. Модель заведёт их при размышлении, или добавь сама.</div>');
        box.append(addBtn);
        return;
    }
    for (const it of st.intrigues) {
        const row = $(`
          <div class="nnb-note nnb-intrigue">
            <div class="nnb-meta"></div>
            <div class="nnb-text"></div>
            <div class="nnb-clues nnb-text"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-dice" title="Реролл: придумать другую"></i>
              <i class="fa-solid fa-check" title="Раскрыта"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`T${it.id}${it.tag ? ` · ${it.tag}` : ''} · улик: ${it.clues.length} · ${Math.max(0, len - it.at)} сообщ. назад`);
        row.find('.nnb-text').first().text(it.text);
        const clues = row.find('.nnb-clues');
        if (it.clues.length) clues.text('Открылось: ' + it.clues.map(c => c.text).join('; '));
        else clues.remove();
        row.find('.fa-dice').on('click', () => rerollNote(it.id, 'intrigue'));
        row.find('.fa-check').on('click', () => closeIntrigue(it.id, 'done'));
        row.find('.fa-trash').on('click', () => closeIntrigue(it.id, 'deleted'));
        row.find('.fa-pen').on('click', async () => {
            const t = await askText('Изменить тайну', it.text);
            if (t && t.trim()) {
                it.text = t.trim();
                await commit();
            }
        });
        box.append(row);
    }
    box.append(addBtn);
}

function renderNpcs(st) {
    const root = $('#nnb_npc_list').empty();
    if (!st.direction.npcs) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`👥 NPC (${st.npcs.length})`);
    root.append(det);
    if (!st.npcs.length) {
        det.append('<div class="nnb-empty">Пока нет. Модель заведёт карточки при размышлении, или добавь сама.</div>');
    }
    for (const n of st.npcs) {
        const row = $(`
          <div class="nnb-note nnb-npc">
            <div class="nnb-meta"></div>
            <div class="nnb-npc-text"></div>
            <div class="nnb-npc-status"></div>
            <div class="nnb-actions">
              <i class="fa-solid nnb-lock"></i>
              <i class="fa-solid fa-pen" title="Изменить карточку"></i>
              <i class="fa-solid fa-comment-dots" title="Изменить состояние"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(n.name + (n.locked ? ' · правлено вручную' : ''));
        row.find('.nnb-npc-text').text(n.card);
        if (n.status) row.find('.nnb-npc-status').text('Сейчас: ' + n.status);
        else row.find('.nnb-npc-status').remove();
        row.find('.nnb-lock')
            .addClass(n.locked ? 'fa-lock' : 'fa-lock-open')
            .attr('title', n.locked ? 'Карточка защищена от модели (нажми, чтобы снять)' : 'Защитить карточку от изменений модели')
            .on('click', async () => { n.locked = !n.locked; await commit(); });
        row.find('.fa-pen').on('click', async () => {
            const name = await askText('Имя NPC', n.name);
            if (name === null) return;
            const t = await askText(`Карточка: ${name || n.name}`, n.card);
            if (t === null) return;
            if (name.trim()) n.name = name.trim();
            if (t.trim()) n.card = t.trim();
            n.locked = true;
            await commit();
        });
        row.find('.fa-comment-dots').on('click', async () => {
            const t = await askText(`Что с ${n.name} сейчас`, n.status);
            if (t === null) return;
            n.status = t.trim();
            await commit();
        });
        row.find('.fa-trash').on('click', async () => {
            if (!confirm(`Удалить карточку «${n.name}»?`)) return;
            st.npcs = st.npcs.filter(x => x.id !== n.id);
            await commit();
        });
        det.append(row);
    }
    const add = $('<div class="menu_button"><i class="fa-solid fa-user-plus"></i> Добавить NPC</div>');
    add.on('click', async () => {
        const name = await askText('Имя NPC');
        if (!name || !name.trim()) return;
        if (findNpc(st, name)) return toastr.warning('Такой NPC уже есть', 'Блокнот рассказчика');
        const card = await askText(`Кто такой ${name.trim()}? Внешность, характер, отношение к твоему персонажу`);
        if (!card || !card.trim()) return;
        st.npcs.push({ id: st.nextNpcId++, name: name.trim(), card: card.trim(), status: '', locked: true, at: ctx().chat.length });
        await commit();
    });
    det.append(add);
}

function renderArcs(st) {
    const root = $('#nnb_arc_list').empty();
    if (!st.direction.arcs) return;
    const det = $('<details open class="nnb-section"><summary></summary></details>');
    det.find('summary').text(`🌱 Развитие (${st.arcs.length})`);
    root.append(det);
    if (!st.arcs.length && !st.evolved.length) {
        det.append('<div class="nnb-empty">Пока нет арок. Модель заведёт их, когда в истории появится почва для изменений, или добавь сама.</div>');
    }
    const need = Math.max(1, Number(settings().minStimuli) || 2);
    for (const a of st.arcs) {
        const row = $(`
          <div class="nnb-note nnb-arc">
            <div class="nnb-meta"></div>
            <div class="nnb-npc-text nnb-arc-title"></div>
            <div class="nnb-stage"></div>
            <div class="nnb-npc-status nnb-arc-current"></div>
            <div class="nnb-npc-status nnb-arc-stim"></div>
            <div class="nnb-actions">
              <i class="fa-solid fa-arrow-down" title="Откатить стадию"></i>
              <i class="fa-solid fa-arrow-up" title="Следующая стадия"></i>
              <i class="fa-solid fa-pen" title="Изменить"></i>
              <i class="fa-solid fa-trash" title="Удалить"></i>
            </div>
          </div>`);
        row.find('.nnb-meta').text(`A${a.id} · ${a.who} · стимулов ${a.sinceShift}/${need}`);
        row.find('.nnb-arc-title').text(a.text);
        row.find('.nnb-stage').text('●'.repeat(a.stage) + '○'.repeat(ARC_MAX - a.stage) + '  ' + ARC_STAGES[a.stage].name);
        if (a.current) row.find('.nnb-arc-current').text('Сейчас: ' + a.current); else row.find('.nnb-arc-current').remove();
        if (a.stimuli.length) row.find('.nnb-arc-stim').text('Стимулы: ' + a.stimuli.map(x => x.text).join('; ')); else row.find('.nnb-arc-stim').remove();
        row.find('.fa-arrow-down').on('click', async () => { a.stage = Math.max(1, a.stage - 1); a.sinceShift = 0; await commit(); });
        row.find('.fa-arrow-up').on('click', async () => {
            a.stage++;
            a.sinceShift = 0;
            if (a.stage >= ARC_MAX) {
                st.evolved.push({ who: a.who, text: `${a.text}${a.current ? ` — ${a.current}` : ''}`, at: ctx().chat.length });
                st.arcs = st.arcs.filter(x => x !== a);
            }
            await commit();
        });
        row.find('.fa-pen').on('click', async () => {
            const t = await askText(`Арка ${a.who}: что → во что`, a.text);
            if (t === null) return;
            const c = await askText('Как характер проявляется сейчас', a.current);
            if (c === null) return;
            if (t.trim()) a.text = t.trim();
            a.current = c.trim();
            await commit();
        });
        row.find('.fa-trash').on('click', async () => {
            if (!confirm(`Удалить арку «${a.text}»?`)) return;
            st.arcs = st.arcs.filter(x => x !== a);
            await commit();
        });
        det.append(row);
    }
    if (st.evolved.length) {
        det.append('<div class="nnb-subhead">🌳 Закреплённые изменения</div>');
        st.evolved.forEach((e, i) => {
            const row = $('<div class="nnb-note nnb-arc"><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-pen" title="Изменить"></i><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
            row.find('.nnb-npc-text').text(`${e.who}: ${e.text}`);
            row.find('.fa-pen').on('click', async () => {
                const t = await askText(`Изменение: ${e.who}`, e.text);
                if (t && t.trim()) { e.text = t.trim(); await commit(); }
            });
            row.find('.fa-trash').on('click', async () => {
                if (!confirm('Удалить это изменение? Персонаж вернётся к поведению из карточки в этой части.')) return;
                st.evolved.splice(i, 1);
                await commit();
            });
            det.append(row);
        });
    }
    const add = $('<div class="menu_button"><i class="fa-solid fa-seedling"></i> Добавить арку</div>');
    add.on('click', async () => {
        const who = await askText('Чей характер будет меняться?');
        if (!who || !who.trim()) return;
        const t = await askText('Что сейчас → во что может развиться (например «лень → ответственность»)');
        if (!t || !t.trim()) return;
        st.arcs.push({ id: st.nextArcId++, who: who.trim(), text: t.trim(), stage: 1, current: '', stimuli: [], sinceShift: 0, at: ctx().chat.length });
        await commit();
    });
    det.append(add);
}

async function closeIntrigue(id, status) {
    const st = store();
    const i = st?.intrigues.findIndex(n => n.id === id) ?? -1;
    if (i < 0) return;
    const [it] = st.intrigues.splice(i, 1);
    if (status !== 'deleted') {
        Object.assign(it, { kind: 'intrigue', status, closedAt: ctx().chat.length });
        st.archive.push(it);
    }
    await commit();
}

async function closeNote(id, status) {
    const st = store();
    const i = st?.notes.findIndex(n => n.id === id) ?? -1;
    if (i < 0) return;
    const [n] = st.notes.splice(i, 1);
    if (status !== 'deleted') {
        n.status = status;
        n.closedAt = ctx().chat.length;
        st.archive.push(n);
    }
    await commit();
}

async function commit() {
    await ctx().saveMetadata();
    updateInjection();
    renderPanel();
}

function bind(id, key, kind = 'text') {
    const el = $(`#${id}`);
    const s = settings();
    if (kind === 'checkbox') {
        el.prop('checked', !!s[key]).on('change', () => {
            s[key] = el.prop('checked');
            saveSettings();
            updateInjection();
            renderPanel();
        });
    } else {
        el.val(s[key]).on('input change', () => {
            s[key] = kind === 'number' ? Number(el.val()) : el.val();
            saveSettings();
            updateInjection();
            if (kind === 'number') setStatus('');
        });
    }
}

jQuery(async () => {
    const c = ctx();
    $('#extensions_settings2').append(PANEL_HTML);

    bind('nnb_enabled', 'enabled', 'checkbox');
    bind('nnb_toasts', 'showToasts', 'checkbox');
    bind('nnb_spoilers', 'hideSpoilers', 'checkbox');
    bind('nnb_interval', 'interval', 'number');
    bind('nnb_depth', 'depth', 'number');
    bind('nnb_max', 'maxActive', 'number');
    bind('nnb_max_int', 'maxIntrigues', 'number');
    bind('nnb_min_stim', 'minStimuli', 'number');
    bind('nnb_role', 'role', 'number');
    bind('nnb_think_prompt', 'thinkPrompt');
    bind('nnb_inject_prompt', 'injectPrompt');

    $('#nnb_custom_genre').on('input', function () {
        const st = store();
        if (!st) return;
        st.direction.customGenre = $(this).val();
        saveDirectionSoon();
    });
    $('#nnb_mix').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.mixMode = $(this).val();
        saveDirectionSoon();
    });
    $('#nnb_intrigues_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.intrigues = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_arcs_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.arcs = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_npcs_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.npcs = $(this).prop('checked');
        saveDirectionSoon();
        updateInjection();
        renderPanel();
    });
    $('#nnb_avoid').on('input', function () {
        const st = store();
        if (!st) return;
        st.direction.avoid = $(this).val();
        saveDirectionSoon();
    });
    $('#nnb_inspiration').on('input', function () {
        const st = store();
        if (!st) return;
        st.direction.inspiration = $(this).val();
        saveDirectionSoon();
    });

    $('#nnb_think_now').on('click', () => think(true));
    $('#nnb_add').on('click', async () => {
        const st = store();
        if (!st) return toastr.warning('Сначала открой чат', 'Блокнот рассказчика');
        const t = await askText('Новая запись (можно начать с [тег])');
        if (!t || !t.trim()) return;
        const m = t.trim().match(/^\[([^\]]{1,40})\]\s*(.+)$/s);
        st.notes.push({ id: st.nextId++, tag: m ? m[1] : '', text: m ? m[2] : t.trim(), at: ctx().chat.length });
        await commit();
    });
    $('#nnb_clear').on('click', async () => {
        const st = store();
        if (!st || !confirm('Удалить все записи и архив этого чата?')) return;
        st.notes = [];
        st.archive = [];
        st.lastRaw = '';
        st.rejected = [];
        st.intrigues = [];
        await commit();
    });
    $('#nnb_reset_think').on('click', () => {
        settings().thinkPrompt = DEFAULT_THINK;
        $('#nnb_think_prompt').val(DEFAULT_THINK);
        saveSettings();
    });
    $('#nnb_reset_inject').on('click', () => {
        settings().injectPrompt = DEFAULT_INJECT;
        $('#nnb_inject_prompt').val(DEFAULT_INJECT);
        saveSettings();
        updateInjection();
    });

    const ev = c.event_types;
    c.eventSource.on(ev.MESSAGE_RECEIVED, onMessageReceived);
    for (const e of [ev.MESSAGE_SENT, ev.CHAT_CHANGED, ev.MESSAGE_DELETED]) {
        if (e) c.eventSource.on(e, () => { updateInjection(); renderPanel(); });
    }
    c.eventSource.on(ev.CHAT_CHANGED, renderDirection);
    if (ev.CHAT_COMPLETION_PROMPT_READY) c.eventSource.on(ev.CHAT_COMPLETION_PROMPT_READY, fixOwnPromptRole);

    updateInjection();
    renderPanel();
    renderDirection();
});
