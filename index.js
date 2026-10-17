// Блокнот рассказчика — модель раз в N сообщений сама решает,
// что хочет реализовать / спросить / придумать, и записывает это.
// Записи хранятся в метаданных чата и подмешиваются в промпт.

const MODULE = 'npc_notebook';
const INJECT_KEY = 'npc_notebook_inject';

// Константы SillyTavern (extension_prompt_types / extension_prompt_roles)
const POS_IN_CHAT = 1;

const DEFAULT_THINK = `[OOC: Пауза в ролевой игре. Сейчас ты НЕ пишешь ответ персонажа. На минуту ты — автор этой истории и ведёшь свой рабочий блокнот. Перечитай чат целиком и пройди по всем разделам ниже.

{{direction}}

{{time}}

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

  // ===================== Время и место =====================
  // Календарь ведёт код: модель только сообщает, сколько прошло времени или какая теперь дата.

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  const COUNTRIES = {
      UK: { name: 'Великобритания', keys: ['великобритан', 'британ', 'англи', 'шотланд', 'уэльс', 'лондон', 'uk', 'united kingdom', 'england', 'britain'] },
      US: { name: 'США', keys: ['сша', 'америк', 'штат', 'нью-йорк', 'калифорни', 'usa', 'united states', 'america'] },
      JP: { name: 'Япония', keys: ['япони', 'токио', 'осака', 'киото', 'japan'] },
      RU: { name: 'Россия', keys: ['росси', 'москв', 'петербург', 'russia'] },
  };

  function detectCountry(text) {
      const t = String(text || '').toLowerCase();
      for (const [code, c] of Object.entries(COUNTRIES)) {
          if (c.keys.some(k => (k.length <= 3 ? new RegExp(`(^|[^a-zа-яё])${k}([^a-zа-яё]|$)`).test(t) : t.includes(k)))) return code;
      }
      return '';
  }

  // Даты храним как 'YYYY-MM-DD', считаем в UTC, чтобы не мешали часовые пояса
  function toDate(iso) {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
  }
  function toIso(dt) {
      return dt.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
      const dt = toDate(iso);
      dt.setUTCDate(dt.getUTCDate() + n);
      return toIso(dt);
  }
  function addMonths(iso, n) {
      const dt = toDate(iso);
      const day = dt.getUTCDate();
      dt.setUTCDate(1);
      dt.setUTCMonth(dt.getUTCMonth() + n);
      const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, last));
      return toIso(dt);
  }
  function daysBetween(a, b) {
      return Math.round((toDate(b) - toDate(a)) / 86400000);
  }
  function ymd(y, m, d) {
      return toIso(new Date(Date.UTC(y, m - 1, d)));
  }
  function formatDate(iso, withYear = true) {
      const dt = toDate(iso);
      return `${dt.getUTCDate()} ${MONTHS_GEN[dt.getUTCMonth()]}${withYear ? ' ' + dt.getUTCFullYear() : ''}`;
  }
  function weekday(iso) {
      return WEEKDAYS[toDate(iso).getUTCDay()];
  }
  function plural(n, one, few, many) {
      const a = Math.abs(n) % 100, b = a % 10;
      if (a > 10 && a < 20) return many;
      if (b > 1 && b < 5) return few;
      if (b === 1) return one;
      return many;
  }
  function daysWord(n) {
      return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  }

  // Пасха: западная (григорианская) и православная (юлианская + 13 дней, верно для 1900–2099)
  function westernEaster(y) {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
      const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
      return ymd(y, month, day);
  }
  function orthodoxEaster(y) {
      const a = y % 4, b = y % 7, c = y % 19;
      const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
      const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
      return addDays(ymd(y, month, day), 13);
  }
  // n-й день недели месяца (wd: 0 — вс, 1 — пн…); n = -1 — последний
  function nthWeekday(y, m, wd, n) {
      if (n > 0) {
          const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
      }
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lastWd = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
      return ymd(y, m, lastDay - ((lastWd - wd + 7) % 7));
  }

  // Праздники и события. Правила: d — фиксированная дата [месяц, день], to — конец периода,
  // nth — [месяц, день недели, номер], easter / orth — смещение от западной / православной Пасхи, len — длительность в днях
  const HOLIDAYS = {
      ALL: [
          { name: 'Новый год', d: [1, 1] },
          { name: 'День святого Валентина', d: [2, 14] },
          { name: 'Хэллоуин', d: [10, 31] },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25] },
          { name: 'Канун Нового года', d: [12, 31] },
      ],
      UK: [
          { name: 'Новый год', d: [1, 1], note: 'выходной; после вечеринок в канун' },
          { name: 'Ночь Бёрнса', d: [1, 25], note: 'шотландский праздник: хаггис, стихи Роберта Бёрнса' },
          { name: 'День святого Валентина', d: [2, 14], note: 'открытки и ужины в ресторанах' },
          { name: 'Блинный вторник (Pancake Day)', easter: -47, note: 'все едят блины с лимоном и сахаром, школьные забеги с блинами' },
          { name: 'День матери (Mothering Sunday)', easter: -21, note: 'цветы и открытки мамам' },
          { name: 'День святого Патрика', d: [3, 17], note: 'ирландский праздник, отмечают в пабах: зелёный цвет, Guinness' },
          { name: 'День дурака', d: [4, 1], note: 'розыгрыши до полудня' },
          { name: 'Страстная пятница', easter: -2, note: 'выходной, булочки с крестом (hot cross buns)' },
          { name: 'Пасха', easter: 0, note: 'шоколадные яйца, охота за яйцами для детей' },
          { name: 'Пасхальный понедельник', easter: 1, note: 'банковский выходной' },
          { name: 'Майский банковский выходной', nth: [5, 1, 1], note: 'длинные выходные' },
          { name: 'Весенний банковский выходной', nth: [5, 1, -1], note: 'длинные выходные, часто поездки за город' },
          { name: 'День отца', nth: [6, 0, 3] },
          { name: 'Уимблдон', d: [6, 29], len: 14, note: 'теннисный турнир: клубника со сливками, все смотрят матчи' },
          { name: 'Летние школьные каникулы', d: [7, 22], to: [9, 3], note: 'семьи уезжают в отпуск, на море или в Европу' },
          { name: 'Летний банковский выходной', nth: [8, 1, -1], note: 'последний длинный уикенд лета, Ноттинг-Хиллский карнавал в Лондоне' },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмы, тыквы, дети ходят за сладостями' },
          { name: 'Ночь Гая Фокса (Bonfire Night)', d: [11, 5], note: 'костры и фейерверки' },
          { name: 'Воскресенье памяти', nth: [11, 0, 2], note: 'минута молчания, красные маки на одежде (их носят с конца октября)' },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25], note: 'главный праздник года: индейка, крекеры с бумажными коронами, речь короля по ТВ' },
          { name: 'День подарков (Boxing Day)', d: [12, 26], note: 'выходной, распродажи, футбол' },
          { name: 'Канун Нового года (Хогманай)', d: [12, 31], note: 'вечеринки, фейерверки, «Auld Lang Syne» в полночь' },
      ],
      US: [
          { name: 'Новый год', d: [1, 1] },
          { name: 'День Мартина Лютера Кинга', nth: [1, 1, 3], note: 'федеральный выходной' },
          { name: 'Супербоул', nth: [2, 0, 2], note: 'финал по американскому футболу: вечеринки, крылышки, реклама' },
          { name: 'День святого Валентина', d: [2, 14], note: 'открытки, шоколад, школьники обмениваются валентинками' },
          { name: 'День святого Патрика', d: [3, 17], note: 'всё зелёное, парады, особенно в Нью-Йорке, Бостоне и Чикаго' },
          { name: 'Пасха', easter: 0, note: 'охота за яйцами, пасхальный кролик' },
          { name: 'День матери', nth: [5, 0, 2], note: 'цветы, завтрак маме' },
          { name: 'День памяти (Memorial Day)', nth: [5, 1, -1], note: 'неофициальное начало лета: барбекю, открытие бассейнов' },
          { name: 'Выпускные', d: [5, 20], to: [6, 15], note: 'школьные и университетские выпускные, проммы' },
          { name: 'День отца', nth: [6, 0, 3] },
          { name: 'День независимости', d: [7, 4], note: 'фейерверки, барбекю, флаги' },
          { name: 'День труда', nth: [9, 1, 1], note: 'конец лета, после него начинается учебный год' },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмы, тыквы, trick-or-treat, украшенные дома' },
          { name: 'День благодарения', nth: [11, 4, 4], note: 'главный семейный праздник: индейка, тыквенный пирог, парад Macy\'s' },
          { name: 'Чёрная пятница', nth: [11, 4, 4], shift: 1, note: 'огромные распродажи' },
          { name: 'Сочельник', d: [12, 24] },
          { name: 'Рождество', d: [12, 25], note: 'ёлка, подарки, носки у камина, рождественские огни на домах' },
          { name: 'Канун Нового года', d: [12, 31], note: 'вечеринки, падение шара на Таймс-сквер' },
      ],
      JP: [
          { name: 'Сёгацу (Новый год)', d: [1, 1], to: [1, 3], note: 'главный праздник: первое посещение храма (хацумодэ), осэти, новогодние открытки, семья' },
          { name: 'День совершеннолетия', nth: [1, 1, 2], note: '20-летние в праздничных кимоно' },
          { name: 'Сэцубун', d: [2, 3], note: 'бросают бобы со словами «Демоны вон, удача в дом!»' },
          { name: 'День святого Валентина', d: [2, 14], note: 'в Японии шоколад дарят девушки — любимым и коллегам' },
          { name: 'Хинамацури (праздник девочек)', d: [3, 3], note: 'выставка кукол хина' },
          { name: 'Белый день', d: [3, 14], note: 'парни отвечают подарками на валентинки' },
          { name: 'Ханами', d: [3, 25], to: [4, 10], note: 'цветёт сакура: пикники под деревьями' },
          { name: 'Начало учебного и рабочего года', d: [4, 1], note: 'новые классы, первокурсники, новые сотрудники' },
          { name: 'Золотая неделя', d: [4, 29], to: [5, 5], note: 'череда выходных, все путешествуют' },
          { name: 'День детей', d: [5, 5], note: 'вывешивают карпов-коинобори' },
          { name: 'Сезон дождей (цую)', d: [6, 7], to: [7, 19], note: 'постоянные дожди, сырость, цветут гортензии' },
          { name: 'Танабата', d: [7, 7], note: 'желания на бумажных полосках на бамбуке' },
          { name: 'Летние фестивали', d: [7, 20], to: [8, 31], note: 'мацури, юкаты, фейерверки, уличная еда' },
          { name: 'Обон', d: [8, 13], to: [8, 16], note: 'поминовение предков, поездки в родные места, танцы бон-одори' },
          { name: 'День почитания старших', nth: [9, 1, 3] },
          { name: 'Хэллоуин', d: [10, 31], note: 'костюмированные толпы в Сибуе' },
          { name: 'Сити-го-сан', d: [11, 15], note: 'дети 3, 5 и 7 лет в нарядах идут в храм' },
          { name: 'Сочельник', d: [12, 24], note: 'в Японии — романтический вечер для пар, курица из KFC и клубничный торт' },
          { name: 'Омисока (канун Нового года)', d: [12, 31], note: 'уборка, лапша тосикоси-соба, 108 ударов храмового колокола' },
      ],
      RU: [
          { name: 'Новогодние каникулы', d: [1, 1], to: [1, 8], note: 'длинные выходные: оливье, мандарины, гости' },
          { name: 'Рождество', d: [1, 7], note: 'православное Рождество' },
          { name: 'Старый Новый год', d: [1, 14] },
          { name: 'Крещение', d: [1, 19], note: 'купание в проруби' },
          { name: 'Татьянин день', d: [1, 25], note: 'день студентов' },
          { name: 'День святого Валентина', d: [2, 14] },
          { name: 'Масленица', orth: -55, len: 7, note: 'неделя блинов, в последний день сжигают чучело' },
          { name: 'День защитника Отечества', d: [2, 23], note: 'поздравляют мужчин' },
          { name: 'Международный женский день', d: [3, 8], note: 'цветы, особенно тюльпаны и мимоза, поздравляют женщин' },
          { name: 'День смеха', d: [4, 1] },
          { name: 'Пасха', orth: 0, note: 'куличи, крашеные яйца, «Христос воскресе!»' },
          { name: 'Майские праздники', d: [5, 1], to: [5, 11], note: 'шашлыки, дачи, открытие сезона' },
          { name: 'День Победы', d: [5, 9], note: 'парад, салют, георгиевские ленточки' },
          { name: 'День России', d: [6, 12] },
          { name: 'Ивана Купала', d: [7, 7], note: 'венки, костры, гадания' },
          { name: 'День знаний', d: [9, 1], note: 'начало учебного года, линейки, букеты' },
          { name: 'День учителя', d: [10, 5] },
          { name: 'Хэллоуин', d: [10, 31], note: 'не официальный праздник, но молодёжь устраивает костюмированные вечеринки, в барах и клубах тематические ночи' },
          { name: 'День народного единства', d: [11, 4] },
          { name: 'Канун Нового года', d: [12, 31], note: 'ёлка, оливье, речь президента, бой курантов' },
      ],
  };

  function occurrences(h, y) {
      let start;
      if (h.d) start = ymd(y, h.d[0], h.d[1]);
      else if (h.nth) start = addDays(nthWeekday(y, h.nth[0], h.nth[1], h.nth[2]), h.shift || 0);
      else if (h.easter !== undefined) start = addDays(westernEaster(y), h.easter);
      else if (h.orth !== undefined) start = addDays(orthodoxEaster(y), h.orth);
      else if (h.md) start = ymd(y, Number(h.md.slice(0, 2)), Number(h.md.slice(3, 5)));
      else return null;
      let end = start;
      if (h.to) {
          end = ymd(y, h.to[0], h.to[1]);
          if (end < start) end = ymd(y + 1, h.to[0], h.to[1]);
      } else if (h.len) end = addDays(start, h.len - 1);
      return { start, end };
  }

  function holidaysFor(st) {
      const code = st.time.country;
      const base = HOLIDAYS[code] || HOLIDAYS.ALL;
      const custom = (st.time.custom || []).map(c => ({ name: c.name, md: c.md, note: c.note, custom: true }));
      return base.concat(custom);
  }

  // Праздники, которые идут сейчас или начнутся в ближайшие days дней
  function upcoming(st, days) {
      const today = st.time.date;
      const y = toDate(today).getUTCFullYear();
      const out = [];
      for (const h of holidaysFor(st)) {
          for (const yy of [y - 1, y, y + 1]) {
              const o = occurrences(h, yy);
              if (!o) continue;
              if (o.end < today) continue;
              const inDays = daysBetween(today, o.start);
              if (inDays > days) continue;
              out.push(Object.assign({}, h, { start: o.start, end: o.end, inDays: inDays, ongoing: o.start <= today }));
              break;
          }
      }
      return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  // Сезон и его приметы (все поддерживаемые страны — в Северном полушарии)
  const SEASON_HINTS = {
      'зима': 'холодно, рано темнеет; тёплая одежда, горячие напитки, снег или слякоть',
      'весна': 'теплеет, всё цветёт, дни становятся длиннее, погода переменчивая',
      'лето': 'тепло или жарко, длинные светлые вечера; отпуска, пляжи, пикники, прогулки допоздна',
      'осень': 'холодает, листопад, дожди, рано темнеет; начало учебного года, уютные вечера дома',
  };
  function season(iso) {
      const m = toDate(iso).getUTCMonth() + 1, d = toDate(iso).getUTCDate();
      const name = [12, 1, 2].includes(m) ? 'зима' : m <= 5 ? 'весна' : m <= 8 ? 'лето' : 'осень';
      const idx = { 'зима': [12, 1, 2], 'весна': [3, 4, 5], 'лето': [6, 7, 8], 'осень': [9, 10, 11] }[name].indexOf(m);
      const phase = idx === 0 ? (d <= 10 ? 'начало' : 'первая половина') : idx === 1 ? 'середина' : (d >= 20 ? 'конец' : 'вторая половина');
      return { name, phase, hint: SEASON_HINTS[name] };
  }

  // Разбор даты из ответа модели или ввода: 2025-02-14, 14.02.2025, 14.02, «14 февраля 2025», «14 февраля»
  function parseDateText(text, refIso) {
      const t = String(text || '').trim().toLowerCase();
      let y, m, d;
      let mm = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (mm) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
      if (!mm && (mm = t.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/))) {
          d = Number(mm[1]); m = Number(mm[2]);
          if (mm[3]) y = Number(mm[3].length === 2 ? '20' + mm[3] : mm[3]);
      }
      if (!m) {
          mm = t.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
          if (mm) {
              const mi = MONTHS_GEN.findIndex(x => mm[2].startsWith(x.slice(0, 3)));
              if (mi >= 0) { d = Number(mm[1]); m = mi + 1; if (mm[3]) y = Number(mm[3]); }
          }
      }
      if (!m || !d || m > 12 || d > 31) return null;
      if (!y) {
          // год не указан — берём ближайшую такую дату не раньше текущей даты истории
          const ref = refIso || toIso(new Date());
          y = toDate(ref).getUTCFullYear();
          if (ymd(y, m, d) < ref) y += 1;
      }
      const iso = ymd(y, m, d);
      return toDate(iso).getUTCMonth() + 1 === m ? iso : null;
  }

  // «+3 дня», «2 недели», «месяц», «полгода»
  function parseDuration(text) {
      const t = String(text || '').toLowerCase().replace(',', '.');
      const mm = t.match(/(\d+(?:\.\d+)?)?\s*(дн|ден|сут|недел|нед|месяц|мес|год|лет|полгода)/);
      if (!mm) return null;
      if (mm[2] === 'полгода') return { months: 6 };
      const n = mm[1] ? Number(mm[1]) : 1;
      if (/^(дн|ден|сут)/.test(mm[2])) return { days: Math.round(n) };
      if (/^нед/.test(mm[2])) return { days: Math.round(n * 7) };
      if (/^мес/.test(mm[2])) return { months: Math.round(n) };
      return { months: Math.round(n * 12) };
  }

  function applyDuration(iso, dur) {
      return dur.months ? addMonths(iso, dur.months) : addDays(iso, dur.days);
  }

  function placeLine(st) {
      const t = st.time;
      const country = COUNTRIES[t.country]?.name || t.countryName || '';
      return [t.city, country].filter(Boolean).join(', ');
  }

  function holidayLine(h, today) {
      const when = h.ongoing
          ? (h.start === h.end ? 'сегодня' : `идёт сейчас (до ${formatDate(h.end, false)})`)
          : h.inDays === 1 ? 'завтра' : `через ${daysWord(h.inDays)} (${formatDate(h.start, false)})`;
      return `— ${h.name}: ${when}${h.note ? ` — ${h.note}` : ''}`;
  }

  // ---------- Хроника: когда что было ----------
  function agoText(days) {
      if (days <= 0) return 'сегодня';
      if (days === 1) return 'вчера';
      if (days < 7) return `${daysWord(days)} назад`;
      if (days < 14) return 'неделю назад';
      if (days < 28) return `${Math.round(days / 7)} ${plural(Math.round(days / 7), 'неделю', 'недели', 'недель')} назад`;
      if (days < 60) return 'месяц назад';
      if (days < 365) { const m = Math.round(days / 30); return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`; }
      const y = Math.round(days / 365);
      return `${y} ${plural(y, 'год', 'года', 'лет')} назад`;
  }
  function timeline(st) {
      if (!Array.isArray(st.time.timeline)) st.time.timeline = [];
      return st.time.timeline;
  }
  function addEvent(st, date, text) {
      const list = timeline(st);
      text = String(text || '').trim();
      if (!text || !date) return false;
      if (list.some(e => e.text.toLowerCase() === text.toLowerCase())) return false;
      list.push({ date, text });
      list.sort((a, b) => a.date.localeCompare(b.date));
      if (list.length > 60) list.splice(0, list.length - 60);
      return true;
  }
  function chronicleLines(st, count) {
      const today = st.time.date;
      return timeline(st).slice(-count).map(e => `— ${formatDate(e.date, false)}${today ? ` (${agoText(daysBetween(e.date, today))})` : ''}: ${e.text}`);
  }

  // Шапка для обычных ответов
  function buildTimeInjection(st) {
      const t = st.time;
      if (!st.direction.time || (!t.date && !placeLine(st))) return '';
      const lines = ['[Время и место истории — держись их, даже если давно не упоминались.'];
      if (t.date) {
          const s = season(t.date);
          lines.push(`Сейчас: ${weekday(t.date)}, ${formatDate(t.date)}. ${s.name[0].toUpperCase() + s.name.slice(1)} (${s.phase}): ${s.hint}.`);
      }
      const place = placeLine(st);
      if (place) lines.push(`Место: ${place}. Еда, деньги, бытовые мелочи, обращения, праздники — местные; не переноси реалии других стран.`);
      if (t.flavor) lines.push(`Местный колорит: ${t.flavor}`);
      if (t.date) {
          const up = upcoming(st, 21);
          if (up.length) {
              lines.push('Праздники и события рядом (персонажи о них знают; разыгрывать не обязательно, но игнорировать странно):');
              up.slice(0, 4).forEach(h => lines.push(holidayLine(h, t.date)));
          }
          const chron = chronicleLines(st, 12);
          if (chron.length) {
              lines.push('Хроника — когда что произошло (держись этих сроков; не путай «на прошлой неделе» и «месяц назад»):');
              chron.forEach(l => lines.push(l));
          }
      }
      return lines.join('\n') + ']';
  }

  // Раздел для размышления
  function buildTimeSection(st) {
      if (!st?.direction?.time) return '';
      const t = st.time;
      const lines = ['Время и место. Календарь ведёт код — ты только сообщаешь изменения.'];
      if (t.date) {
          lines.push(`Последняя известная дата истории: ${weekday(t.date)}, ${formatDate(t.date)}.`);
      } else {
          lines.push('Дата истории ещё не задана. Определи её по чату (упоминания месяца, погоды, праздников, сезона). Если точных подсказок нет — выбери правдоподобную дату, которая подходит к происходящему, и задай её командой DATE.');
      }
      const place = placeLine(st);
      lines.push(place ? `Место: ${place}.` : 'Место ещё не задано. Определи страну и город по чату и задай командой PLACE.');
      if (t.date) {
          const up = upcoming(st, 45);
          if (up.length) {
              lines.push('Ближайшие праздники и события:');
              up.slice(0, 6).forEach(h => lines.push(holidayLine(h, t.date)));
          }
      }
      lines.push('');
      lines.push('Команды для времени и места:');
      lines.push('TIME +N дней / недель / месяцев — сколько сюжетного времени прошло в чате с последней известной даты (оцени по событиям: ночёвки, «на следующий день», таймскипы). Если прошло меньше суток — не пиши ничего.');
      lines.push('DATE ДД.ММ.ГГГГ — если в чате прямо названа дата или нужно задать её впервые.');
      lines.push('PLACE Страна: Город — если место задано впервые или персонажи переехали.');
      lines.push('EVENT: важное событие из чата с прошлой проверки — знакомство, ссора, признание, первый поцелуй, переезд, поездка, праздник. Одна строка, кратко. Дату плагин поставит сам; если событие было не сегодня — EVENT ДД.ММ: текст. Не повторяй то, что уже есть в хронике.');
      const recent = chronicleLines(st, 6);
      if (recent.length) { lines.push('Последнее в хронике:'); recent.forEach(l => lines.push(l)); }
      return lines.join('\n');
  }

  // Обработка команд TIME / DATE / PLACE / LOCAL. Возвращает true, если строка распознана.
  function applyTimeCommand(st, line, res) {
      const t = st.time;
      let m;
      if ((m = line.match(/^TIME\s*[:：]?\s*\+?\s*(.+)$/i))) {
          if (!st.direction.time || !t.date) return true;
          const dur = parseDuration(m[1]);
          if (dur && (dur.days > 0 || dur.months > 0)) {
              const before = t.date;
              t.date = applyDuration(t.date, dur);
              res.timeMoved = daysBetween(before, t.date);
          }
          return true;
      }
      if ((m = line.match(/^DATE\s*[:：]?\s*(.+)$/i))) {
          if (!st.direction.time) return true;
          const iso = parseDateText(m[1], t.date);
          if (iso) {
              if (t.date && iso !== t.date) res.timeMoved = daysBetween(t.date, iso);
              else if (!t.date) res.dateSet = iso;
              t.date = iso;
          }
          return true;
      }
      if ((m = line.match(/^PLACE\s*[:：]?\s*(.+)$/i))) {
          if (!st.direction.time) return true;
          let countryText = m[1], city = '';
          const sep = m[1].match(/^\[?([^\]:：]+?)\]?\s*[:：—–]\s*(.+)$/);
          if (sep) { countryText = sep[1]; city = sep[2]; }
          else if (m[1].includes(',')) { const parts = m[1].split(','); countryText = parts.pop(); city = parts.join(','); }
          const code = detectCountry(countryText) || detectCountry(m[1]);
          const newCountryName = code ? '' : countryText.trim();
          if (code !== t.country || newCountryName !== t.countryName) {
              if (!t.flavorLocked) t.flavor = '';
              res.placeSet = true;
          }
          if (city.trim() !== t.city) res.placeSet = true;
          t.country = code;
          t.countryName = newCountryName;
          t.city = city.trim();
          return true;
      }
      if ((m = line.match(/^EVENT\s*\[?(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)?\]?\s*[:：—–-]\s*(.+)$/i))) {
          if (!st.direction.time || !t.date) return true;
          let date = t.date;
          if (m[1]) {
              const d = parseDateText(m[1].replace(/[-/]/g, '.'), '1900-01-01');
              if (d) {
                  // год не указан — берём ближайшую такую дату не позже текущей
                  date = /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/.test(m[1]) ? d : `${t.date.slice(0, 4)}${d.slice(4)}`;
                  if (date > t.date) date = `${Number(t.date.slice(0, 4)) - 1}${d.slice(4)}`;
              }
          }
          if (addEvent(st, date, m[2])) (res.events = res.events || []).push(m[2].trim());
          return true;
      }
      if ((m = line.match(/^LOCAL\s*[:：—–-]\s*(.+)$/i))) {
          if (st.direction.time && !t.flavorLocked) t.flavor = m[1].trim();
          return true;
      }
      return false;
  }



  // Колорит — отдельным коротким запросом, чтобы модель его не пропускала
  function flavorPrompt(st) {
      return 'Напиши 2–3 предложения о местном колорите для ролевой игры, действие которой происходит здесь: ' + placeLine(st) + '. ' +
          'Перечисли конкретно: типичная еда и напитки, валюта и привычки с деньгами (например, чаевые), транспорт, климат, бытовые мелочи и манера общения местных. ' +
          'Это справка для автора, чтобы не путать реалии разных стран. Пиши по-русски, без вступления и без списков — сразу текст.';
  }
  function cleanFlavor(raw) {
      return String(raw || '').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2800\u3000\u3164\uFEFF]/g, ' ')
          .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/\*\*/g, '').trim()
          .replace(/^["«]|["»]$/g, '').trim();
  }

  // ===================== Праздничные события =====================
  // Традиции (классические задачи), скрытая задача, метки в ответах, итог и медали.

  var TRADITIONS = [
    { match: ['хэллоуин'], emoji: '🎃', vibe: 'тыквы на крыльцах, гирлянды из летучих мышей, костюмы в витринах, запах корицы и сладостей', tasks: ['Вырезать фонарь из тыквы', 'Выбрать или смастерить костюм', 'Раздать сладости детям или сходить за сладостями самим', 'Посмотреть ужастик вместе', 'Сходить на хэллоуинскую вечеринку', 'Украсить дом к празднику'] },
    { match: ['валентин'], emoji: '💘', vibe: 'сердечки в витринах, очереди в цветочных, парочки в кафе', tasks: ['Подарить валентинку', 'Устроить романтический ужин', 'Сделать подарок своими руками', 'Сходить на свидание', 'Признаться кому-то в чувствах'] },
    { match: ['белый день'], emoji: '🍬', vibe: 'в магазинах белый шоколад и зефир в подарочных коробках', tasks: ['Ответить на валентинку подарком', 'Выбрать белый шоколад или сладости', 'Вручить подарок лично'] },
    { country: 'JP', match: ['сочельник'], emoji: '🎄', vibe: 'иллюминация, парочки на улицах, очереди за курицей и клубничными тортами', tasks: ['Сходить на свидание', 'Съесть рождественский клубничный торт', 'Заказать курицу из KFC', 'Погулять под иллюминацией'] },
    { match: ['рождество', 'сочельник'], emoji: '🎁', vibe: 'ёлки в окнах, рождественские ярмарки, огоньки, глинтвейн и музыка', tasks: ['Нарядить ёлку', 'Обменяться подарками', 'Испечь рождественское печенье', 'Спеть или послушать рождественские песни', 'Повесить носки для подарков'] },
    { match: ['сёгацу'], emoji: '⛩', vibe: 'очереди у храмов, новогодние украшения из сосны и бамбука, тишина закрытых магазинов', tasks: ['Сходить в храм на хацумодэ', 'Попробовать осэти', 'Вытянуть предсказание омикудзи', 'Отправить новогодние открытки'] },
    { match: ['омисока'], emoji: '🔔', vibe: 'генеральная уборка, запах лапши, ожидание колокола', tasks: ['Сделать генеральную уборку', 'Съесть тосикоси-собу', 'Послушать удары колокола в полночь'] },
    { match: ['новый год', 'новогод', 'канун нового', 'хогманай'], emoji: '🎆', vibe: 'гирлянды, ёлки, предпраздничная суета, запах мандаринов', tasks: ['Нарядить ёлку', 'Приготовить праздничный стол', 'Загадать желание в полночь', 'Посмотреть салют', 'Подарить подарки'] },
    { match: ['масленица'], emoji: '🥞', vibe: 'запах блинов отовсюду, ярмарки, гулянья', tasks: ['Напечь блинов', 'Сходить на гулянья', 'Сжечь чучело Масленицы', 'Попросить прощения в Прощёное воскресенье'] },
    { match: ['блинный'], emoji: '🥞', vibe: 'везде блины, школьники тренируются к блинным забегам', tasks: ['Напечь блинов', 'Попробовать блины с лимоном и сахаром', 'Поучаствовать в блинном забеге'] },
    { match: ['пасха'], emoji: '🐣', vibe: 'крашеные яйца, весенние цветы, праздничная выпечка в витринах', tasks: ['Покрасить яйца', 'Устроить охоту за яйцами', 'Испечь праздничную выпечку', 'Собраться на семейный обед'] },
    { match: ['благодарения'], emoji: '🦃', vibe: 'запах индейки и тыквенного пирога, все едут к родным', tasks: ['Приготовить индейку', 'Испечь тыквенный пирог', 'Собраться за общим столом', 'Сказать, за что благодарен', 'Посмотреть парад или футбол'] },
    { match: ['гая фокса'], emoji: '🎆', vibe: 'запах дыма, костры в парках, хлопки фейерверков', tasks: ['Сходить на костёр', 'Посмотреть фейерверк', 'Пожарить зефир на огне'] },
    { match: ['независимости'], emoji: '🎇', vibe: 'флаги, барбекю во дворах, ожидание фейерверков', tasks: ['Устроить барбекю', 'Посмотреть фейерверк', 'Надеть что-то в цветах флага'] },
    { match: ['женский'], emoji: '💐', vibe: 'тюльпаны и мимоза на каждом углу, очереди в цветочных', tasks: ['Подарить цветы', 'Поздравить близких и коллег', 'Устроить приятный сюрприз'] },
    { match: ['защитника'], emoji: '🎖', vibe: 'открытки, поздравления в офисах, носки и пена для бритья в подарочных наборах', tasks: ['Поздравить мужчин', 'Подарить что-то практичное', 'Устроить праздничный ужин'] },
    { match: ['танабата'], emoji: '🎋', vibe: 'бамбук с разноцветными бумажными полосками, юкаты', tasks: ['Написать желание на бумажной полоске', 'Повесить его на бамбук', 'Надеть юкату'] },
    { match: ['ханами'], emoji: '🌸', vibe: 'розовые облака сакуры, пикники в парках, лепестки на асфальте', tasks: ['Устроить пикник под сакурой', 'Занять место под деревом с утра', 'Сделать фото среди цветов'] },
    { match: ['обон'], emoji: '🏮', vibe: 'фонарики, танцы бон-одори, поезда переполнены едущими домой', tasks: ['Съездить в родные места', 'Станцевать бон-одори', 'Зажечь фонарики'] },
    { match: ['летние фестивали'], emoji: '🎐', vibe: 'юкаты, лотки с уличной едой, фейерверки над рекой', tasks: ['Надеть юкату', 'Попробовать уличную еду', 'Посмотреть фейерверк', 'Поймать золотую рыбку на ярмарке'] },
    { match: ['супербоул'], emoji: '🏈', vibe: 'все обсуждают матч и рекламу, в магазинах горы крылышек и чипсов', tasks: ['Устроить вечеринку у телевизора', 'Наготовить крылышек', 'Поспорить на исход матча'] },
    { match: ['патрика'], emoji: '☘', vibe: 'всё зелёное, парады, переполненные пабы', tasks: ['Надеть что-то зелёное', 'Сходить в паб', 'Посмотреть парад'] },
    { match: ['рожден'], emoji: '🎂', vibe: 'именинника поздравляют с утра', tasks: ['Выбрать подарок', 'Устроить сюрприз', 'Испечь или заказать торт', 'Собрать друзей', 'Сказать тёплые слова'] },
  ];

  function traditionsFor(h, country) {
    var name = String(h.name || '').toLowerCase();
    for (var i = 0; i < TRADITIONS.length; i++) {
      var t = TRADITIONS[i];
      if (t.country && t.country !== country) continue;
      if (t.match.some(function (m) { return name.indexOf(m) >= 0; })) return t;
    }
    if (h.custom) return { emoji: '🗓', vibe: '', tasks: ['Отметить эту дату вместе', 'Сделать что-то памятное'] };
    return null;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  function ensureHolidayState(st) {
    if (st.holiday === undefined) st.holiday = null;
    if (!st.holidayDone || typeof st.holidayDone !== 'object') st.holidayDone = {};
    if (!Array.isArray(st.medals)) st.medals = [];
    if (!Array.isArray(st.memories)) st.memories = [];
    if (!Array.isArray(st.traces)) st.traces = [];
    if (!st.notified || typeof st.notified !== 'object') st.notified = {};
  }

  // Праздник, который пора активировать (за leadDays дней до начала и до его конца)
  function holidayToActivate(st, leadDays) {
    var t = st.time;
    if (!t.date || (st.holiday && !st.holiday.finished)) return null;
    var list = upcoming(st, leadDays);
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      var key = h.name + '|' + h.start;
      if (st.holidayDone[key]) continue;
      var tr = traditionsFor(h, t.country);
      if (!tr) continue;
      return { h: h, key: key, tr: tr };
    }
    return null;
  }

  function newHoliday(found) {
    var classic = shuffle(found.tr.tasks).slice(0, 2).map(function (text) { return { text: text, done: false, hidden: false, kind: 'classic' }; });
    return {
      key: found.key, name: found.h.name, emoji: found.tr.emoji, vibe: found.tr.vibe, note: found.h.note || '',
      start: found.h.start, end: found.h.end, tasks: classic, finished: false
    };
  }

  function activationPrompt(hol, st, names) {
    return [
      '[OOC: Пауза в ролевой игре. Ты — помощник автора. Скоро праздник: ' + hol.name + ' (' + formatDate(hol.start, false) + ')' + (placeLine(st) ? ', место: ' + placeLine(st) : '') + '.',
      'Классические традиции уже выбраны: ' + hol.tasks.map(function (x) { return '«' + x.text + '»'; }).join(', ') + '.',
      'Придумай по контексту этой ролевой ещё две праздничные задачи для ' + names.user + ' — связанные с праздником И с персонажами, отношениями, происходящим в истории. Лёгкие, выполнимые за пару сцен, в духе истории.',
      'STORY: открытая сюжетная задача (игрок её видит)',
      'SECRET: скрытая задача-сюрприз (игрок её не видит, а ты будешь ненавязчиво создавать для неё поводы)',
      'Ответь ровно двумя строками в этом формате, без пояснений.]'
    ].join('\n');
  }

  function applyActivation(hol, raw) {
    var text = String(raw || '').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2800\u3000\u3164\uFEFF]/g, ' ').replace(/\*\*/g, '');
    var story = text.match(/STORY\s*[:：—–-]\s*(.+)/i);
    var secret = text.match(/SECRET\s*[:：—–-]\s*(.+)/i);
    if (story) hol.tasks.push({ text: story[1].trim(), done: false, hidden: false, kind: 'story' });
    if (secret) hol.tasks.push({ text: secret[1].trim(), done: false, hidden: true, kind: 'secret' });
  }

  function whenText(hol, today) {
    if (today < hol.start) {
      var d = daysBetween(today, hol.start);
      return d === 1 ? 'завтра' : 'через ' + daysWord(d);
    }
    if (today > hol.end) return 'уже прошёл';
    return hol.start === hol.end ? 'сегодня' : 'идёт сейчас';
  }

  // Блок праздника для обычных ответов модели
  function buildHolidayInjection(st) {
    ensureHolidayState(st);
    var out = [];
    var hol = st.holiday;
    var today = st.time.date;
    if (hol && !hol.finished && today) {
      var lines = ['[Праздничное событие: ' + hol.emoji + ' ' + hol.name + ' — ' + whenText(hol, today) + '.'];
      if (hol.vibe) lines.push('Атмосфера вокруг: ' + hol.vibe + '.');
      var open = hol.tasks.map(function (x, i) { return { x: x, n: i + 1 }; }).filter(function (o) { return !o.x.hidden; });
      lines.push('Праздничные традиции, которые игрок может выполнить (персонажи могут предлагать, но не навязывай):');
      open.forEach(function (o) { lines.push(o.n + '. ' + o.x.text + (o.x.done ? ' — уже сделано' : '')); });
      var sec = hol.tasks.map(function (x, i) { return { x: x, n: i + 1 }; }).filter(function (o) { return o.x.hidden && !o.x.done; });
      if (sec.length) lines.push('Секретная задача (игрок о ней не знает; создавай для неё ненавязчивые поводы, не раскрывай прямо): ' + sec.map(function (o) { return o.n + '. ' + o.x.text; }).join('; '));
      lines.push('Служебные метки: если в твоём ответе одна из задач по-настоящему выполнена — допиши в самом конце ответа <!--✓номер-->. Если в ответе наступил следующий день — допиши <!--день+1--> (или +N, если прошло несколько дней). Метки невидимы для игрока; не упоминай их в тексте.]');
      out.push(lines.join('\n'));
    }
    var traces = st.traces.filter(function (x) { return today && today <= x.until; });
    if (traces.length) out.push('[Следы недавних праздников — они ещё заметны в сцене: ' + traces.map(function (x) { return x.text; }).join(' ') + ']');
    if (st.memories.length) out.push('[Воспоминания о прошлых праздниках (персонажи могут на них ссылаться): ' + st.memories.slice(-5).map(function (m) { return m.text; }).join(' ') + ']');
    return out.join('\n\n');
  }

  function fullInjection(st) {
    return [buildTimeInjection(st), buildHolidayInjection(st)].filter(Boolean).join('\n\n');
  }

  // Строки для плановой проверки: подстраховка, если модель забыла поставить метку
  function holidayCheckSection(st) {
    ensureHolidayState(st);
    var hol = st.holiday;
    if (!hol || hol.finished) return '';
    var lines = ['Праздник «' + hol.name + '», задачи:'];
    hol.tasks.forEach(function (x, i) { lines.push((i + 1) + '. ' + x.text + (x.hidden ? ' (секретная)' : '') + (x.done ? ' — выполнено' : '')); });
    lines.push('TASK номер — если задача уже выполнена в чате, но выше не отмечена.');
    return lines.join('\n');
  }

  function markTask(st, n, res) {
    var hol = st.holiday;
    if (!hol || hol.finished) return;
    var x = hol.tasks[Number(n) - 1];
    if (!x || x.done) return;
    x.done = true;
    (res.tasksDone = res.tasksDone || []).push(x);
  }

  // Метки в обычном ответе модели: <!--✓2-->, <!--день+1-->
  var TAG_RE = /<!--\s*(✓|v|done)\s*#?(\d+)\s*-->|<!--\s*(день|day)\s*\+\s*(\d+)\s*-->/gi;
  function applyReplyTags(st, text, res) {
    var m;
    TAG_RE.lastIndex = 0;
    var found = false;
    while ((m = TAG_RE.exec(String(text || '')))) {
      found = true;
      if (m[2]) markTask(st, m[2], res);
      else if (m[4] && st.time.date) {
        var n = Math.min(60, Number(m[4]) || 1);
        st.time.date = addDays(st.time.date, n);
        res.timeMoved = (res.timeMoved || 0) + n;
      }
    }
    return found;
  }
  function stripTags(text) {
    return String(text || '').replace(TAG_RE, '').replace(/\s+$/, '');
  }

  function tierOf(hol) {
    var open = hol.tasks.filter(function (x) { return !x.hidden; });
    var done = open.filter(function (x) { return x.done; }).length;
    var secret = hol.tasks.some(function (x) { return x.hidden && x.done; });
    var share = open.length ? done / open.length : 0;
    var tier = done === 0 ? 'anti' : share < 0.5 ? 'bronze' : share < 1 ? 'silver' : 'gold';
    return { tier: tier, done: done, total: open.length, secret: secret };
  }
  var TIER_NAMES = { anti: 'антимедаль', bronze: 'бронза', silver: 'серебро', gold: 'золото' };
  var TIER_ICONS = { anti: '🥔', bronze: '🥉', silver: '🥈', gold: '🥇' };

  function finalePrompt(hol, st, names) {
    var t = tierOf(hol);
    return [
      '[OOC: Пауза в ролевой игре. Ты — помощник автора. Праздник «' + hol.name + '» закончился. Перечитай, как он прошёл в чате (если он прошёл за кадром из-за таймскипа — оцени, как он мог пройти).',
      'Задачи праздника: ' + hol.tasks.map(function (x) { return '«' + x.text + '»' + (x.hidden ? ' (секретная)' : '') + ' — ' + (x.done ? 'выполнено' : 'нет'); }).join('; ') + '.',
      'Итог: выполнено ' + t.done + ' из ' + t.total + ' открытых традиций' + (t.secret ? ', и секретная задача тоже' : '') + '. Уровень медали: ' + TIER_NAMES[t.tier] + '.',
      'Ответь ровно тремя строками:',
      'MEDAL: эмодзи | смешное название | одна строка с юмором о том, как ' + names.user + ' на самом деле провёл(а) этот праздник' + (t.tier === 'anti' ? ' (это антимедаль за то, что праздник прошёл мимо)' : ''),
      'OUTCOME: 1–2 предложения о том, как это отразилось на отношениях: кто доволен, кто разочарован. ' + (t.tier === 'anti' || t.tier === 'bronze' ? 'Добавь лёгкие последствия в духе истории.' : 'Отметь, чем праздник запомнится.'),
      'TRACE: что осталось от праздника в ближайшие дни — предмет, фото, остатки еды, следы веселья.]'
    ].join('\n').replace(/\{\{user\}\}/gi, names.user);
  }

  function applyFinale(hol, st, raw) {
    var t = tierOf(hol);
    var text = String(raw || '').replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2800\u3000\u3164\uFEFF]/g, ' ').replace(/\*\*/g, '');
    var medal = text.match(/MEDAL\s*[:：—–-]\s*(.+)/i);
    var outcome = text.match(/OUTCOME\s*[:：—–-]\s*(.+)/i);
    var trace = text.match(/TRACE\s*[:：—–-]\s*(.+)/i);
    var parts = medal ? medal[1].split('|').map(function (s) { return s.trim(); }) : [];
    var m = {
      emoji: parts[0] || hol.emoji,
      title: parts[1] || (TIER_NAMES[t.tier][0].toUpperCase() + TIER_NAMES[t.tier].slice(1) + ': ' + hol.name),
      desc: parts[2] || ('Выполнено ' + t.done + ' из ' + t.total + ' традиций.'),
      tier: t.tier, secret: t.secret, holiday: hol.name, date: hol.end
    };
    st.medals.push(m);
    var year = hol.end.slice(0, 4);
    if (outcome) st.memories.push({ text: hol.name + ' ' + year + ': ' + outcome[1].trim(), date: hol.end });
    if (st.memories.length > 12) st.memories.splice(0, st.memories.length - 12);
    if (trace) st.traces.push({ text: trace[1].trim(), until: addDays(hol.end, 5) });
    st.traces = st.traces.filter(function (x) { return x.until >= (st.time.date || x.until); });
    hol.finished = true;
    st.holidayDone[hol.key] = true;
    addEvent(st, hol.end, hol.name + ': ' + (outcome ? outcome[1].trim() : 'праздник прошёл') + ' (медаль «' + m.title + '»)');
    return m;
  }

  // Напоминания: за leadDays дней и в сам день — по одному разу
  function dueReminders(st, leadDays) {
    ensureHolidayState(st);
    var out = [];
    if (!st.time.date) return out;
    upcoming(st, leadDays).forEach(function (h) {
      var key = h.name + '|' + h.start;
      var stage = h.ongoing || h.inDays === 0 ? 'today' : 'soon';
      var seen = st.notified[key] || [];
      if (seen.indexOf(stage) >= 0) return;
      seen.push(stage);
      st.notified[key] = seen;
      var tr = traditionsFor(h, st.time.country);
      var emoji = (tr && tr.emoji) || '📅';
      out.push(stage === 'today'
        ? emoji + ' Сегодня — ' + h.name
        : emoji + ' ' + (h.inDays === 1 ? 'Завтра' : 'Через ' + daysWord(h.inDays)) + ' — ' + h.name);
    });
    var keys = Object.keys(st.notified);
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function (k) { delete st.notified[k]; });
    return out;
  }

  // ---------- Движок праздника (общий для всех версий) ----------
  // io: { generate(prompt, withContext) -> текст, toast(text), names, lead, events, showToasts }
  // Меняет st на месте; сохранение — на стороне вызывающего.
  async function holidayProgress(st, io, opts) {
    opts = opts || {};
    ensureHolidayState(st);
    if (!st.time.date) return;
    var reminders = dueReminders(st, io.lead);
    if (io.showToasts) reminders.forEach(function (x) { io.toast(x); });
    if (!io.events) return;
    var hol = st.holiday;
    if (hol && !hol.finished && (opts.finish || st.time.date > hol.end)) {
      var raw = '';
      try { raw = await io.generate(finalePrompt(hol, st, io.names), true); } catch (e) { raw = ''; }
      if (!hol.finished) {
        var medal = applyFinale(hol, st, raw);
        io.toast('🏅 ' + medal.emoji + ' «' + medal.title + '» — ' + medal.desc);
      }
    }
    var found = holidayToActivate(st, io.lead);
    if (found) {
      var h = newHoliday(found);
      var raw2 = '';
      try { raw2 = await io.generate(activationPrompt(h, st, io.names), true); } catch (e) { raw2 = ''; }
      applyActivation(h, raw2);
      st.holiday = h;
      var open = h.tasks.filter(function (x) { return !x.hidden; }).length;
      io.toast(h.emoji + ' Праздничное событие: ' + h.name + '\nТрадиций: ' + open + (h.tasks.length > open ? ' + 🔒 секретная' : ''));
    }
  }

  function holidaySummary(res) {
    var out = [];
    (res.tasksDone || []).forEach(function (x) { out.push(x.hidden ? '🔓 Секретная задача выполнена: ' + x.text : '✓ ' + x.text); });
    return out;
  }

  // Дни рождения
  function normNameB(x) { return String(x || '').trim().toLowerCase().replace(/ё/g, 'е'); }
  function hasBday(st, who) {
    var k = normNameB(who);
    return st.time.custom.some(function (c) { return c.bday && normNameB(c.who) === k; });
  }
  function bdaySection(st, userName, charNames) {
    var known = st.time.custom.filter(function (c) { return c.bday; }).map(function (c) { var md = c.md.split('-').map(Number); return c.who + ' — ' + md[1] + ' ' + MONTHS_GEN[md[0] - 1]; });
    var lines = ['Дни рождения' + (known.length ? ' (уже известны: ' + known.join(', ') + ')' : '') + '.'];
    var missing = [userName].concat(charNames || []).filter(function (n) { return n && !hasBday(st, n); });
    if (missing.length) lines.push('Ещё не заданы для: ' + missing.join(', ') + '. Найди дату в карточке персонажа, описании персоны или в чате; если её нигде нет — придумай правдоподобную, подходящую персонажу.');
    lines.push('BDAY Имя: ДД.ММ — день рождения ' + (missing.length ? 'для них, а также ' : '') + 'для значимого NPC, если о нём есть сведения в истории или он важен для сюжета.');
    return lines.join('\n');
  }
  // Команды TASK и BDAY. Возвращает true, если строка распознана.
  function applyEventCommand(st, line, res) {
    var m = line.match(/^TASK\s*✓?\s*#?\s*(\d+)/i);
    if (m) { markTask(st, m[1], res); return true; }
    m = line.match(/^BDAY\s*[:：]?\s*\[?([^\]:：]{1,60}?)\]?\s*[:：—–-]\s*(.+)$/i);
    if (m) {
      var who = m[1].trim();
      var iso = parseDateText(m[2], '2000-01-01');
      if (iso && !hasBday(st, who)) {
        st.time.custom.push({ name: 'День рождения: ' + who, md: iso.slice(5), bday: true, who: who });
        (res.bdays = res.bdays || []).push(who);
      }
      return true;
    }
    return false;
  }


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
    events: true,
    leadDays: 3,
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
    if (s.promptVersion < 3) {
        // стандартный промпт v2 → v3 (добавлен раздел времени и места)
        if (s.thinkPrompt.includes('ведёшь свой рабочий блокнот') && !s.thinkPrompt.includes('{{time}}')) {
            s.thinkPrompt = DEFAULT_THINK;
        }
        s.promptVersion = 3;
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
    if (st.direction.time === undefined) st.direction.time = true;
    if (!st.time) st.time = { date: '', country: '', countryName: '', city: '', flavor: '', flavorLocked: false, custom: [] };
    if (!Array.isArray(st.time.custom)) st.time.custom = [];
    if (!Array.isArray(st.time.timeline)) st.time.timeline = [];
    ensureHolidayState(st);
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

// Если все арки касаются только главного персонажа — подталкиваем модель к NPC
function npcArcNudge(st) {
    const charName = ctx().name2 || '';
    const norm = x => String(x || '').toLowerCase().replace(/ё/g, 'е');
    const arcsAboutNpc = st.arcs.filter(a => norm(a.who) !== norm(charName)).length;
    if (arcsAboutNpc || !st.npcs.length) return '';
    return `\nСейчас ни одной арки нет ни у NPC, ни у их отношений. Посмотри на карточки NPC (${st.npcs.slice(0, 6).map(n => n.name).join(', ')}) и на линии между ними — заведи арку хотя бы для одной, если в истории для неё есть почва.\n`;
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
${npcArcNudge(st)}
Команды для них (с новой строки, вместе с остальными):
ARC [Имя]: черта сейчас → во что может развиться. Если персонаж уже заметно меняется под влиянием событий или отношений — заведи арку; если почвы нет — не выдумывай.
ARC [Имя + Имя]: как сейчас устроены их отношения → куда они могут прийти. Так же веди линии отношений между NPC: дружба, соперничество, роман, любовный треугольник (тогда указывай всех троих).
Арки бывают не только у {{char}}: значимые NPC и их отношения друг с другом тоже меняются, даже когда {{user}} не рядом. Особенно держи линии, о которых игрок прямо заявлял (например, «у них будет любовный треугольник»).
STIMULUS #A1: что в чате подтолкнуло изменение (только то, что действительно произошло)
SHIFT #A1: как теперь проявляется характер — переход на следующую стадию. Возможен, только когда с прошлого сдвига накопилось не меньше ${need} стимулов.
REGRESS #A1: что отбросило персонажа назад
DROP #A1 — арка больше не актуальна
Изменения должны быть заслуженными и постепенными. Не меняй ядро личности: грубиян может научиться заботе, но остаётся собой — с тем же юмором, манерой речи и привычками. Конец арки — один заметный шаг роста, а не другая личность: черты, на которых держится характер (тревожность, застенчивость, вспыльчивость, лень и т.п.), смягчаются, но не исчезают. Формулируй цель так: «всё ещё [прежняя черта], но [что изменилось]», а не «уверенный», «раскрепощённый», «бесстрашный». Арки не считаются в лимит новых записей.`;
}

function buildIntrigueSection(st) {
    if (!st?.direction?.intrigues) return '';
    const max = Math.max(1, Number(settings().maxIntrigues) || 5);
    return `Тайны и интриги. Параллельно задумкам ты ведёшь скрытые сюжетные линии: тайны, загадки, слухи (правдивые или ложные), заговоры и интриги NPC. Записывай суть так, как её знает только автор. Это касается не только {{char}} и {{user}}: у NPC свои секреты, романы и сплетни друг о друге — их тоже заводи.

Текущие тайны:
${formatIntrigues(st.intrigues)}

Команды для них (с новой строки, вместе с остальными):
INTRIGUE [тайна|загадка|слух|интрига]: в чём правда на самом деле
CLUE #T1: что из этой тайны уже прозвучало или открылось в чате (только то, что действительно было)
SOLVED #T1 — тайна раскрыта
DROP #T1 — линия больше не нужна
${st.intrigues.length ? 'Новую тайну заводи, если она по-настоящему обогатит историю.' : 'Сейчас у истории нет ни одной тайны — заведи хотя бы одну, подходящую к жанру и происходящему.'} Одновременно держи не больше ${max}.`;
}

function fillTemplate(template, notes, direction = '', intrigues = '', npcs = '', arcs = '', time = '') {
    const c = ctx();
    const MARK = '\u0001NNB_NOTES\u0001';
    const DMARK = '\u0001NNB_DIR\u0001';
    const IMARK = '\u0001NNB_INT\u0001';
    const NMARK = '\u0001NNB_NPC\u0001';
    const AMARK = '\u0001NNB_ARC\u0001';
    const TMARK = '\u0001NNB_TIME\u0001';
    const withMark = c.substituteParams(template
        .replaceAll('{{notes}}', MARK)
        .replaceAll('{{direction}}', DMARK)
        .replaceAll('{{intrigues}}', IMARK)
        .replaceAll('{{npcs}}', NMARK)
        .replaceAll('{{arcs}}', AMARK)
        .replaceAll('{{time}}', TMARK));
    return withMark
        .replaceAll(MARK, formatNotes(notes))
        .replaceAll(DMARK, direction)
        .replaceAll(IMARK, intrigues)
        .replaceAll(NMARK, c.substituteParams(npcs))
        .replaceAll(AMARK, c.substituteParams(arcs))
        .replaceAll(TMARK, c.substituteParams(time))
        .replace(/\n{3,}/g, '\n\n');
}

function updateInjection() {
    const c = ctx();
    const s = settings();
    const st = store();
    const showIntrigues = st?.direction?.intrigues && st.intrigues.length;
    const showNpcs = st?.direction?.npcs && st.npcs.length;
    const showArcs = st?.direction?.arcs && (st.arcs.length || st.evolved.length);
    const timeBlock = st && st.direction.time ? [buildTimeInjection(st), s.events ? buildHolidayInjection(st) : ''].filter(Boolean).join('\n\n') : '';
    if (!s.enabled || !st || (!st.notes.length && !showIntrigues && !showNpcs && !showArcs && !timeBlock)) {
        c.setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
        return;
    }
    const blocks = [];
    if (timeBlock) blocks.push(timeBlock);
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
        if (applyTimeCommand(st, line, res)) continue;
        if (st.direction.time && applyEventCommand(st, line, res)) continue;

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
    if (res.timeMoved) parts.push(`📅 ${res.timeMoved > 0 ? 'прошло' : 'назад на'} ${daysWord(Math.abs(res.timeMoved))} → ${formatDate(store().time.date)}`);
    else if (res.dateSet) parts.push(`📅 дата истории: ${formatDate(res.dateSet)}`);
    if (res.placeSet) parts.push(`📍 место: ${placeLine(store())}`);
    if (res.events) parts.push(`📜 в хронику: ${res.events.length}`);
    if (res.bdays) parts.push(`🎂 дни рождения: ${res.bdays.join(', ')}`);
    holidaySummary(res).forEach(x => parts.push(escapeHtml(x)));
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
        const raw = await quietGenerate(fillTemplate(tpl, st.notes, buildDirection(st), buildIntrigueSection(st), buildNpcSection(st), buildArcSection(st), buildTimeSectionFull(st)));
        if (ctx().chatId !== chatIdAtStart) return; // чат сменили, пока модель думала
        st.lastRaw = String(raw ?? '');
        const res = parseAndApply(raw);
        report(res, manual, raw);
        if (st.direction.time) {
            await fillFlavor(st, false);
            await holidayStep(st);
        }
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

function storyNames() {
    const c = ctx();
    let chars = [];
    try {
        if (c.groupId && Array.isArray(c.groups)) {
            const g = c.groups.find(x => x.id === c.groupId);
            chars = (g?.members || []).map(av => c.characters.find(ch => ch.avatar === av)?.name).filter(Boolean);
        }
    } catch (e) { /* ignore */ }
    if (!chars.length && c.name2) chars = [c.name2];
    return { user: c.name1 || 'игрок', char: chars.join(', ') || 'персонаж', chars };
}

function buildTimeSectionFull(st) {
    if (!st?.direction?.time) return '';
    const names = storyNames();
    return [buildTimeSection(st), bdaySection(st, names.user, names.chars), settings().events ? holidayCheckSection(st) : ''].filter(Boolean).join('\n\n');
}

// Если в своём промпте нет нужных разделов, вставляем их перед финальной инструкцией
function ensureSections(tpl) {
    const missing = ['direction', 'time', 'npcs', 'arcs', 'intrigues'].filter(k => !tpl.includes(`{{${k}}}`));
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

// Колорит — отдельным запросом (модель не пропустит его, как строку среди многих команд)
async function fillFlavor(st, manual) {
    const t = st.time;
    if (!placeLine(st) || (!manual && (t.flavor || t.flavorLocked))) return false;
    try {
        const text = cleanFlavor(await quietGenerate(flavorPrompt(st)));
        if (!text) { if (manual) toastr.warning('Модель не написала колорит — попробуй ещё раз', 'Блокнот рассказчика'); return false; }
        t.flavor = text;
        t.flavorLocked = false;
        if (manual) toastr.success('🧭 Колорит обновлён', 'Блокнот рассказчика');
        return true;
    } catch (err) {
        if (manual) toastr.error(String(err?.message || err), 'Блокнот рассказчика: ошибка');
        return false;
    }
}

// Напоминания, итог закончившегося праздника, запуск нового. Вызывать внутри busy.
async function holidayStep(st, opts) {
    const s = settings();
    await holidayProgress(st, {
        generate: p => quietGenerate(p),
        toast: x => toastr.info(escapeHtml(x).replace(/\n/g, '<br>'), 'Блокнот рассказчика', { escapeHtml: false, timeOut: 9000 }),
        names: storyNames(),
        lead: Math.max(1, Number(s.leadDays) || 3),
        events: !!s.events,
        showToasts: !!s.showToasts,
    }, opts);
}

async function runHolidayStep(opts) {
    if (busy) return;
    const st = store();
    if (!st || !st.direction.time) return;
    const chatId = ctx().chatId;
    busy = true;
    setStatus('Проверяю праздники…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        await holidayStep(st, opts);
    } catch (err) {
        console.error('[npc_notebook]', err);
    } finally {
        if (ctx().chatId === chatId) await ctx().saveMetadata();
        busy = false;
        updateInjection();
        renderPanel();
    }
}

async function runFlavor() {
    if (busy) return;
    const st = store();
    if (!st) return;
    busy = true;
    setStatus('Модель пишет местный колорит…');
    ctx().setExtensionPrompt(INJECT_KEY, '', POS_IN_CHAT, 0);
    try {
        await fillFlavor(st, true);
        await ctx().saveMetadata();
    } finally {
        busy = false;
        updateInjection();
        renderPanel();
    }
}

// Метки в ответе модели: <!--✓2--> (задача праздника выполнена), <!--день+1--> (наступил следующий день)
async function processReplyTags() {
    const st = store();
    const s = settings();
    if (!st || !s.enabled || !st.direction.time) return false;
    const c = ctx();
    const id = c.chat.length - 1;
    const msg = c.chat[id];
    if (!msg || msg.is_user || typeof msg.mes !== 'string' || !msg.mes.includes('<!--')) return false;
    const res = {};
    if (!applyReplyTags(st, msg.mes, res)) return false;
    msg.mes = stripTags(msg.mes);
    try {
        if (typeof c.updateMessageBlock === 'function') c.updateMessageBlock(id, msg);
        await c.saveChat();
    } catch (e) { /* метки невидимы, можно оставить */ }
    const parts = holidaySummary(res);
    if (res.timeMoved) parts.unshift(`📅 прошло ${daysWord(res.timeMoved)} → ${formatDate(st.time.date)}`);
    if (parts.length && s.showToasts) toastr.success(parts.map(escapeHtml).join('<br>'), 'Блокнот рассказчика', { escapeHtml: false, timeOut: 8000 });
    await c.saveMetadata();
    if (res.timeMoved) await runHolidayStep();
    return true;
}

async function onMessageReceived() {
    try { await processReplyTags(); } catch (e) { console.error('[npc_notebook] reply tags', e); }
    onMessageReceivedThink();
}

function onMessageReceivedThink() {
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
      <label class="checkbox_label"><input type="checkbox" id="nnb_events"> Праздничные события (традиции и медали)</label>
      <div class="nnb-row"><label for="nnb_lead">За сколько дней напоминать о праздниках</label><input type="number" min="1" max="7" class="text_pole" id="nnb_lead"></div>
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
        <label class="checkbox_label"><input type="checkbox" id="nnb_time_on"> Время и место в этом чате</label>
      </div>

      <div class="nnb-status" id="nnb_status"></div>
      <div class="nnb-buttons">
        <div class="menu_button" id="nnb_think_now"><i class="fa-solid fa-feather"></i> Подумать сейчас</div>
        <div class="menu_button" id="nnb_add"><i class="fa-solid fa-plus"></i> Добавить запись</div>
        <div class="menu_button" id="nnb_clear"><i class="fa-solid fa-broom"></i> Очистить блокнот</div>
      </div>

      <div id="nnb_time_box"></div>
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

    renderTime(st);
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
    $('#nnb_time_on').prop('checked', !!st?.direction.time).prop('disabled', !enabled);
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

function renderTime(st) {
    const root = $('#nnb_time_box').empty();
    if (!st.direction.time) return;
    const t = st.time;
    const det = $('<details open class="nnb-section"><summary>📅 Время и место</summary></details>');
    root.append(det);

    renderHolidayCard(st, det);
    const head = $('<div class="nnb-time-now"></div>');
    if (t.date) {
        const s = season(t.date);
        head.text(`${weekday(t.date)}, ${formatDate(t.date)} · ${s.name}, ${s.phase}`);
    } else {
        head.text('Дата не задана — модель определит её при размышлении, или задай сама.');
    }
    det.append(head);

    const dateRow = $(`<div class="nnb-row nnb-time-row">
        <input type="date" class="text_pole nnb-date">
        <div class="menu_button nnb-shift" data-d="-1">−1 д</div>
        <div class="menu_button nnb-shift" data-d="1">+1 д</div>
        <div class="menu_button nnb-shift" data-d="7">+1 нед</div>
        <div class="menu_button nnb-shift" data-m="1">+1 мес</div>
      </div>`);
    dateRow.find('.nnb-date').val(t.date).on('change', async function () {
        const v = $(this).val();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { t.date = v; await commit(); runHolidayStep(); }
    });
    dateRow.find('.nnb-shift').on('click', async function () {
        const base = t.date || toIso(new Date());
        const d = Number($(this).data('d') || 0), mo = Number($(this).data('m') || 0);
        t.date = mo ? addMonths(base, mo) : addDays(base, d);
        await commit();
        runHolidayStep();
    });
    det.append(dateRow);

    const placeRow = $(`<div class="nnb-row nnb-time-row">
        <select class="text_pole nnb-country nnb-wide">
          <option value="">Страна не задана</option>
          <option value="UK">Великобритания</option>
          <option value="US">США</option>
          <option value="JP">Япония</option>
          <option value="RU">Россия</option>
          <option value="other">Другая…</option>
        </select>
        <input type="text" class="text_pole nnb-city" placeholder="Город">
      </div>`);
    const other = $('<input type="text" class="text_pole nnb-country-name" placeholder="Название страны">');
    const sel = placeRow.find('.nnb-country');
    sel.val(t.country || (t.countryName ? 'other' : ''));
    other.val(t.countryName).toggle(!t.country && !!t.countryName);
    const placeChanged = async () => {
        if (!t.flavorLocked) t.flavor = '';
        await commit();
        if (placeLine(st) && !t.flavor) runFlavor();
    };
    sel.on('change', async function () {
        const v = $(this).val();
        if (v === 'other') { t.country = ''; other.show().trigger('focus'); return; }
        t.country = v;
        t.countryName = '';
        await placeChanged();
    });
    other.on('change', async function () { t.country = ''; t.countryName = $(this).val().trim(); await placeChanged(); });
    placeRow.find('.nnb-city').val(t.city).on('change', async function () { t.city = $(this).val().trim(); await commit(); });
    det.append(placeRow, other);

    const flavor = $('<textarea class="text_pole nnb-insp" rows="3" placeholder="Местный колорит: еда, деньги, транспорт, климат, привычки. Если оставить пустым, модель заполнит сама, когда известна страна."></textarea>');
    flavor.val(t.flavor).on('change', async function () {
        t.flavor = $(this).val().trim();
        t.flavorLocked = !!t.flavor;
        await commit();
    });
    det.append(flavor);
    const genFlavor = $('<div class="menu_button"><i class="fa-solid fa-compass"></i> Сгенерировать колорит</div>');
    genFlavor.on('click', () => {
        if (!placeLine(st)) return toastr.warning('Сначала укажи страну или город', 'Блокнот рассказчика');
        runFlavor();
    });
    det.append(genFlavor);

    if (t.date) {
        const up = upcoming(st, 60);
        det.append('<div class="nnb-subhead">Ближайшие праздники и события</div>');
        if (!up.length) det.append('<div class="nnb-empty">В ближайшие два месяца ничего нет.</div>');
        for (const h of up) {
            const row = $('<div class="nnb-npc-status"></div>');
            const when = h.ongoing ? 'идёт сейчас' : h.inDays === 0 ? 'сегодня' : `через ${daysWord(h.inDays)}`;
            row.text(`${formatDate(h.start, false)} — ${h.name} (${when})`);
            det.append(row);
        }
    }

    if (t.custom.length) det.append('<div class="nnb-subhead">Свои даты</div>');
    t.custom.forEach((c, i) => {
        const row = $('<div class="nnb-note"><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
        const [mm, dd] = c.md.split('-').map(Number);
        row.find('.nnb-npc-text').text(`${dd} ${MONTHS_GEN[mm - 1]} — ${c.name}${c.note ? ` (${c.note})` : ''}`);
        row.find('.fa-trash').on('click', async () => { t.custom.splice(i, 1); await commit(); });
        det.append(row);
    });
    const add = $('<div class="menu_button"><i class="fa-solid fa-cake-candles"></i> Добавить свою дату</div>');
    add.on('click', async () => {
        const name = await askText('Что за дата? Например «День рождения Деку» или «Годовщина знакомства»');
        if (!name || !name.trim()) return;
        const when = await askText('Когда? Например «20 февраля» или «20.02»');
        if (!when) return;
        const iso = parseDateText(when, '2000-01-01');
        if (!iso) return toastr.warning('Не поняла дату. Напиши, например, «20 февраля» или «20.02».', 'Блокнот рассказчика');
        t.custom.push({ name: name.trim(), md: iso.slice(5) });
        await commit();
    });
    det.append(add);
    renderChronicleAndMedals(st, det);
}

function renderHolidayCard(st, det) {
    const hol = st.holiday;
    if (!settings().events || !hol || hol.finished || !st.time.date) return;
    const t = tierOf(hol);
    const box = $('<div class="nnb-note nnb-event"><div class="nnb-event-title"></div><div class="nnb-meta"></div><div class="nnb-tasks"></div></div>');
    box.find('.nnb-event-title').text(`${hol.emoji} ${hol.name} — ${whenText(hol, st.time.date)}`);
    box.find('.nnb-meta').text(`Традиции: ${t.done} из ${t.total}${hol.tasks.some(x => x.hidden) ? ' · есть секретная задача' : ''}`);
    hol.tasks.forEach(x => {
        const row = $('<label class="checkbox_label nnb-task"><input type="checkbox"><span></span></label>');
        row.find('span').text(x.hidden && !x.done ? '🔒 Секретная задача' : `${x.hidden ? '🔓 ' : ''}${x.text}`);
        row.find('input').prop('checked', !!x.done).on('change', async function () { x.done = $(this).prop('checked'); await commit(); });
        box.find('.nnb-tasks').append(row);
    });
    const fin = $('<div class="menu_button"><i class="fa-solid fa-flag-checkered"></i> Завершить праздник и получить медаль</div>');
    fin.on('click', () => runHolidayStep({ finish: true }));
    box.append(fin);
    det.append(box);
}

function renderChronicleAndMedals(st, det) {
    const list = st.time.timeline || [];
    const chron = $('<details class="nnb-section"><summary></summary></details>');
    chron.find('summary').text(`📜 Хроника (${list.length})`);
    if (!list.length) chron.append('<div class="nnb-empty">Здесь будут важные события с датами — модель записывает их при размышлении.</div>');
    [...list].reverse().forEach(e => {
        const row = $('<div class="nnb-note"><div class="nnb-meta"></div><div class="nnb-npc-text"></div><div class="nnb-actions"><i class="fa-solid fa-trash" title="Удалить"></i></div></div>');
        row.find('.nnb-meta').text(formatDate(e.date) + (st.time.date ? ` · ${agoText(daysBetween(e.date, st.time.date))}` : ''));
        row.find('.nnb-npc-text').text(e.text);
        row.find('.fa-trash').on('click', async () => { list.splice(list.indexOf(e), 1); await commit(); });
        chron.append(row);
    });
    const add = $('<div class="menu_button"><i class="fa-solid fa-plus"></i> Добавить событие</div>');
    add.on('click', async () => {
        const text = await askText('Что произошло?');
        if (!text || !text.trim()) return;
        const when = await askText('Когда? Например «14 октября» или «14.10.2024». Пусто — сегодня по истории');
        if (when === null) return;
        let date = when.trim() ? parseDateText(when, '1900-01-01') : st.time.date;
        if (!date) return toastr.warning('Не поняла дату', 'Блокнот рассказчика');
        if (st.time.date && date > st.time.date && !/\d{4}/.test(when)) date = `${Number(st.time.date.slice(0, 4)) - 1}${date.slice(4)}`;
        addEvent(st, date, text);
        await commit();
    });
    chron.append(add);
    det.append(chron);

    if (!st.medals.length) return;
    const med = $('<details class="nnb-section"><summary></summary></details>');
    med.find('summary').text(`🏅 Витрина медалей (${st.medals.length})`);
    [...st.medals].reverse().forEach(m => {
        const row = $('<div class="nnb-note"><div class="nnb-npc-text"></div><div class="nnb-meta"></div><div class="nnb-npc-status"></div></div>');
        row.find('.nnb-npc-text').text(`${m.emoji || ''} «${m.title}»${m.secret ? ' ✨' : ''}`);
        row.find('.nnb-meta').text(`${TIER_ICONS[m.tier] || ''} ${TIER_NAMES[m.tier] || ''} · ${m.holiday} ${String(m.date || '').slice(0, 4)}`);
        row.find('.nnb-npc-status').text(m.desc);
        med.append(row);
    });
    det.append(med);
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
    bind('nnb_events', 'events', 'checkbox');
    bind('nnb_lead', 'leadDays', 'number');
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
    $('#nnb_time_on').on('change', function () {
        const st = store();
        if (!st) return;
        st.direction.time = $(this).prop('checked');
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
