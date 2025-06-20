require('dotenv').config();
const axios = require('axios');
const { Telegraf } = require('telegraf');
const OpenAI = require('openai');
const cron = require('node-cron');

const fs = require('fs');
const path = require('path');
const SENT_FILE = path.join(__dirname, 'sent.json');

const tmdbKey = process.env.TMDB_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const bot = new Telegraf(telegramToken);
const openai = new OpenAI({ apiKey: openaiKey });

function loadSentMovies() {
  if (!fs.existsSync(SENT_FILE)) return [];
  return JSON.parse(fs.readFileSync(SENT_FILE, 'utf-8'));
}

function saveSentMovies(ids) {
  fs.writeFileSync(SENT_FILE, JSON.stringify(ids, null, 2), 'utf-8');
}

// Завантажити топові фільми
async function fetchTopMovies() {
  const url = `https://api.themoviedb.org/3/movie/top_rated?api_key=${tmdbKey}&language=uk-UA&page=1`;
  const response = await axios.get(url);
  return response.data.results;
}

// Критик оцінює фільм
async function evaluateMovie(movie) {
  const prompt = `
Ти кінокритик. Чи рекомендуєш цей фільм аудиторії, яка любить сильні, захопливі, емоційні стрічки?
Назва: ${movie.title}
Опис: ${movie.overview}
Рейтинг: ${movie.vote_average}
Відповідь лише "Так" або "Ні" з коротким поясненням до 15 слів.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 50,
    temperature: 0.7,
  });

  return completion.choices[0].message.content.trim();
}

// Генерує адаптований опис
async function generateAdaptedDescription(movie) {
  const prompt = `
Напиши короткий, емоційний опис фільму "${movie.title}" на основі:
${movie.overview}
Пиши 2-3 речення, як для TikTok чи Telegram. Без води. В тебе є 200 символів.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
    temperature: 0.8,
  });

  return completion.choices[0].message.content.trim();
}

// Екранування спецсимволів для HTML
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Формат повідомлення
function formatMessage(movie, adaptedDescription, index) {
  const releaseYear = movie.release_date?.slice(0, 4) || 'N/A';
  const rating = movie.vote_average.toFixed(1);
  const title = escapeHTML(movie.title);
  const description = escapeHTML(adaptedDescription);
  const uniqueTag = `#film${getTodayDate()}_${index}`;

  return `
🎬 Назва: <b>${title}</b> (${releaseYear})
⭐️ Рейтинг: <b>${rating}/10</b>

📖 <u>Про що фільм:</u>
${description}

🔎 Пошук у Telegram: ${uniqueTag}
#фільм #рекомендація

<a href="https://www.themoviedb.org/movie/${movie.id}">Детальніше на TMDB</a>
`.trim();
}

// Дата як YYYYMMDD
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0].replace(/-/g, '');
}

// Основна функція
async function run() {
  try {
    const sentIds = loadSentMovies();
    const movies = await fetchTopMovies();
    const goodMovies = movies.filter(m => m.vote_average >= 8 && !sentIds.includes(m.id));
    const recommended = [];

    for (const movie of goodMovies) {
      if (recommended.length >= 3) break;
      const eval = await evaluateMovie(movie);
      if (eval.toLowerCase().startsWith('так')) {
        recommended.push(movie);
      }
    }

    if (recommended.length === 0) {
      console.log('Не знайдено підходящих фільмів.');
      return;
    }

    for (let i = 0; i < recommended.length; i++) {
      const movie = recommended[i];
      const adaptedDescription = await generateAdaptedDescription(movie);
      const msg = formatMessage(movie, adaptedDescription, i + 1);
      const posterUrl = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;

      await bot.telegram.sendPhoto(chatId, posterUrl, {
        caption: msg,
        parse_mode: 'HTML',
      });

      console.log(`✅ Відправлено: ${movie.title}`);
      sentIds.push(movie.id);
    }
    saveSentMovies(sentIds);

  } catch (err) {
    console.error('❌ Помилка:', err.message);
  }
  
}

function generateRandomCron() {
  const minute = Math.floor(Math.random() * 60); 
  const hour = Math.floor(Math.random() * 24); 
  const dayOfWeek = Math.floor(Math.random() * 7); 

  return `${minute} ${hour} * * ${dayOfWeek}`;
}

const randomSchedule = generateRandomCron();

cron.schedule('randomSchedule', () => {
    console.log(`▶️ Cron стартував (${randomSchedule})`);
    run();
});
run();
