// =========================================
//  DISCORD TTS BOT – ELEVENLABS PRO EDITION
//  WINDOWS + NODE 20 + DISCORD.JS 14 READY
// =========================================

require('dotenv').config({ path: './info.env' });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const https = require('https');
const { spawn } = require('child_process');

const {
  Client, GatewayIntentBits, Routes, REST, Partials, SlashCommandBuilder,
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  StreamType, entersState, VoiceConnectionStatus,
} = require('@discordjs/voice');

const gtts = require('google-tts-api');

// === TOKEN & ID ===
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const OWNER_ID = "1020648077335461971"; // đổi thành ID của bạn

// ==== TTS ENGINE ====
let currentVoiceEngine = 'gtts'; // 'gtts' | '11labs'

// ==== ELEVENLABS CONFIG ====
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVEN_DEFAULT_VOICE_ID = process.env.ELEVEN_DEFAULT_VOICE_ID || 'EXAMPLE_DEFAULT_VOICE_ID';

const ELEVEN_VOICE_PRESETS = {
  vi_female_1: process.env.ELEVEN_VOICE_VI_F1 || ELEVEN_DEFAULT_VOICE_ID,
  vi_female_2: process.env.ELEVEN_VOICE_VI_F2 || ELEVEN_DEFAULT_VOICE_ID,
  vi_female_3: process.env.ELEVEN_VOICE_VI_F3 || ELEVEN_DEFAULT_VOICE_ID,
  vi_male_1: process.env.ELEVEN_VOICE_VI_M1 || ELEVEN_DEFAULT_VOICE_ID,
  vi_male_2: process.env.ELEVEN_VOICE_VI_M2 || ELEVEN_DEFAULT_VOICE_ID,
};

// === CLIENT DISCORD ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// === LOG UTILS ===
const logInfo = msg => console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
const logSuccess = msg => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`);
const logWarn = msg => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`);
const logError = msg => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);

// =======================================
//  USER RULES (BLOCK, LIMIT, DELAY)
// =======================================
const userRules = {};

function loadRules() {
  if (fs.existsSync("./rules.json")) {
    try { return JSON.parse(fs.readFileSync("./rules.json")); }
    catch { return {}; }
  }
  return {};
}
function saveRules() {
  fs.writeFileSync("./rules.json", JSON.stringify(userRules, null, 2));
}
Object.assign(userRules, loadRules());

// =======================================
//          CUSTOM SLANG
// =======================================
const CUSTOM_FILE = './custom_slang.json';
if (!fs.existsSync(CUSTOM_FILE))
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify({}, null, 2));

function loadCustomSlang() {
  try { return JSON.parse(fs.readFileSync(CUSTOM_FILE)); }
  catch { return {}; }
}
function saveCustomSlang(data) {
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2));
}

function getAllSlang() {
  const def = {
    vl: 'vãi lờ', vcl: 'vãi cả lờ', cc: 'con cặc', dm: 'địt mẹ',
    thg: 'thằng', m: 'mày', ko: 'không', k: 'không',
    dc: 'được', bh: 'bây giờ', j: 'gì', r: 'rồi',
    lm: 'làm', ns: 'nói', de: 'để', vao: 'vào',
    day: 'đây', no: 'nó', v: 'vờ',
  };
  return { ...def, ...loadCustomSlang() };
}

// =======================================
//  EXPAND ABBREVIATION & UPPERCASE FIX
// =======================================
const vietnameseAlphabet = {
  a: 'a', b: 'bê', c: 'xê', d: 'đê', e: 'e', g: 'gờ',
  h: 'hát', i: 'i', k: 'ca', l: 'el', m: 'em', n: 'en',
  o: 'o', p: 'pê', q: 'quy', r: 'a', s: 'ét', t: 'tê',
  u: 'u', v: 'vê', x: 'ích', y: 'i dài', f: 'ép', j: 'gi',
  w: 'đắp liu', z: 'dét', đ: 'đờ',
};

function expandSlang(text) {
  const slang = getAllSlang();
  const words = text.split(/\s+/);
  const result = [];

  for (let i = 0; i < words.length;) {
    let matched = false;

    for (let len = Math.min(5, words.length - i); len > 0; len--) {
      const phrase = words.slice(i, i + len).join(" ").toLowerCase();
      if (slang[phrase]) {
        result.push(slang[phrase]);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      let w = words[i];

      // Nếu từ IN HOA dài >= 3 → hạ xuống thường để đọc bình thường
      if (/^[A-ZĐ]{3,}$/.test(w)) {
        w = w.toLowerCase();
      }
      // Từ viết tắt 1–2 ký tự → đánh vần
      else if (/^[A-ZĐ]{1,2}$/.test(w)) {
        w = w.split("")
          .map(ch => vietnameseAlphabet[ch.toLowerCase()] || ch)
          .join(" ");
      }
      result.push(w);
      i++;
    }
  }
  return result.join(" ");
}

// =======================================
//  HỌC DẤU & AUTO-ACCENT FIX
// =======================================
const ACCENT_FILE = './accent_learn.json';
let accentData = {};

function loadAccentData() {
  if (!fs.existsSync(ACCENT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACCENT_FILE));
  } catch {
    return {};
  }
}
function saveAccentData() {
  fs.writeFileSync(ACCENT_FILE, JSON.stringify(accentData, null, 2));
}
accentData = loadAccentData();

function removeAccents(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

const ACCENT_REGEX = /[À-ỹà-ỹĐđ]/;

function learnAccentsFromText(text) {
  const tokens = text.split(/\s+/);
  for (const t of tokens) {
    const word = t.toLowerCase().replace(/[^a-zA-ZÀ-ỹđĐ]/g, '');
    if (!word) continue;
    const base = removeAccents(word);
    if (!base) continue;
    if (base === word) continue;

    if (!accentData[base]) accentData[base] = {};
    accentData[base][word] = (accentData[base][word] || 0) + 1;
  }
  saveAccentData();
}

function applyAccentToText(text) {
  const tokens = text.split(/\s+/);
  return tokens.map(tok => {
    const core = tok.replace(/[^a-zA-ZÀ-ỹđĐ]/g, '');
    if (!core) return tok;

    // đã có dấu rồi thì giữ nguyên
    if (ACCENT_REGEX.test(core)) return tok;

    const lower = core.toLowerCase();
    const base = removeAccents(lower);
    if (!base || !accentData[base]) return tok;

    let best = null;
    let max = 0;
    for (const [w, c] of Object.entries(accentData[base])) {
      if (c > max) { max = c; best = w; }
    }
    if (!best) return tok;

    return tok.replace(core, best);
  }).join(" ");
}

// =======================================
//  ĐỌC SỐ TỐI ƯU
// =======================================
function normalizeNumbers(text) {
  const map = {
    "0": "không", "1": "một", "2": "hai", "3": "ba", "4": "bốn",
    "5": "năm", "6": "sáu", "7": "bảy", "8": "tám", "9": "chín"
  };

  function readInt(numStr) {
    if (!numStr) return "";
    if (numStr.length === 1) return map[numStr] || numStr;

    if (numStr.length === 2) {
      const a = numStr[0], b = numStr[1];
      const tens = parseInt(a), ones = parseInt(b);
      let res = "";

      if (tens === 1) res = "mười";
      else res = (map[a] || a) + " mươi";

      if (ones === 0) return res;
      if (ones === 1 && tens > 1) return res + " mốt";
      if (ones === 5 && tens >= 1) return res + " lăm";
      return res + " " + (map[b] || b);
    }

    return numStr.split("").map(d => map[d] || d).join(" ");
  }

  text = text.replace(/(\d+)\.(\d+)/g, (m, a, b) => {
    const A = a.split("").map(d => map[d] || d).join(" ");
    const B = b.split("").map(d => map[d] || d).join(" ");
    return `${A} chấm ${B}`;
  });

  const K_WORD = "ka";
  text = text.replace(/(\d+)\s*k\b/gi, (m, n) => `${readInt(n)} ${K_WORD}`);
  text = text.replace(/(\d+)k\b/gi, (m, n) => `${readInt(n)} ${K_WORD}`);

  text = text.replace(/\d+/g, num => {
    if (num.length <= 2) return readInt(num);
    return num.split("").map(d => map[d] || d).join(" ");
  });

  return text;
}

// =======================================
//  MASK LINKS, MENTION, CODE, EMOJI
// =======================================
function extractAndMaskLinks(text) {
  if (typeof text !== "string") text = String(text);
  const skipped = [];

  text = text.replace(/```[\s\S]*?```/g, m => { skipped.push(m); return "[code-block]"; });
  text = text.replace(/`[^`]+`/g, m => { skipped.push(m); return "[inline-code]"; });
  text = text.replace(/https?:\/\/[^\s]+/gi, m => { skipped.push(m); return "[link]"; });
  text = text.replace(/<[@#&]!?[\d]+>/g, m => { skipped.push(m); return "[mention]"; });
  text = text.replace(/<a?:\w+:\d+>/g, m => { skipped.push(m); return "[emoji]"; });

  text = text.replace(/\s{2,}/g, " ").trim();
  return { maskedText: text, links: skipped };
}

// =======================================
//     TTS STREAM ENGINE BASE
// =======================================
let connection;
const player = createAudioPlayer();
let speed = 1.0;
let volume = 1.0;

const TTS_MAX_CHARS = 190;

function splitTextForTTS(text, maxLen = TTS_MAX_CHARS) {
  const chunks = [];
  let current = "";

  for (const w of text.split(/\s+/)) {
    if (!w) continue;
    const test = current ? current + " " + w : w;

    if (test.length > maxLen) {
      if (current) chunks.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// =======================================
//     GOOGLE TTS STREAM
// =======================================
async function speakGTTS(text, username = "User") {
  try {
    if (!text || !(text = text.trim())) return null;

    const chunks = splitTextForTTS(text, TTS_MAX_CHARS);
    if (!chunks.length) return null;

    return await new Promise((resolve) => {
      const start = Date.now();
      let bytes = 0;

      const ffmpeg = spawn("ffmpeg", [
        "-loglevel", "quiet",
        "-f", "mp3",
        "-i", "pipe:0",
        "-filter:a", `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
        "-ac", "2",
        "-ar", "48000",
        "-f", "s16le",
        "pipe:1"
      ], { windowsHide: true });

      ffmpeg.on("close", () => {
        if (bytes > 0) {
          const sec = (Date.now() - start) / 1000;
          const kb = (bytes / 1024).toFixed(1);
          const sKB = (bytes / 1024 / sec).toFixed(1);
          logInfo(`📥 GTTS stream: ${kb} KB | ${sKB} kB/s | ${sec.toFixed(2)}s`);
        }
      });

      ffmpeg.on("error", err => {
        logError(`FFmpeg GTTS error: ${err.message}`);
        resolve(null);
      });

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });
      resource.volume.setVolume(volume);

      let index = 0;

      function streamChunk() {
        if (index >= chunks.length) {
          try { ffmpeg.stdin.end(); } catch {}
          return;
        }

        const part = chunks[index++];
        const url = gtts.getAudioUrl(part, {
          lang: "vi",
          slow: speed < 1.0
        });

        const req = https.get(url, res => {
          res.on("data", b => { bytes += b.length; });
          res.on("end", () => streamChunk());
          res.on("error", err => {
            logError(`GTTS stream err: ${err.message}`);
            ffmpeg.kill("SIGKILL");
          });

          res.pipe(ffmpeg.stdin, { end: false });
        });

        req.on("error", err => {
          logError(`GTTS HTTPS err: ${err.message}`);
          ffmpeg.kill("SIGKILL");
        });
      }

      streamChunk();

      logSuccess(`🎧 [GTTS] ${username}: "${text.slice(0, 50)}"`);
      resolve(resource);
    });

  } catch (err) {
    logError(`speakGTTS error: ${err.message}`);
    return null;
  }
}

// =======================================
//   ELEVENLABS CACHE + STREAM TTS
// =======================================
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function getCachePath(voiceId, text) {
  const h = hashText(text);
  const dir = path.join(CACHE_DIR, voiceId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${h}.mp3`);
}

// đọc file cache qua ffmpeg
function createFfmpegResourceFromFile(filePath) {
  const ffmpeg = spawn("ffmpeg", [
    "-loglevel", "quiet",
    "-f", "mp3",
    "-i", filePath,
    "-filter:a", `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
    "-ac", "2",
    "-ar", "48000",
    "-f", "s16le",
    "pipe:1"
  ], { windowsHide: true });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  resource.volume.setVolume(volume);

  ffmpeg.on("error", err => {
    logError("FFmpeg cache error: " + err.message);
  });

  return resource;
}

async function speakEleven(text, username = "User", opts = {}) {
  try {
    if (!text || !(text = text.trim())) return null;
    if (!ELEVEN_API_KEY) {
      logWarn("Thiếu ELEVEN_API_KEY → fallback GTTS");
      return speakGTTS(text, username);
    }

    // xác định voiceId cho user
    const voiceId = resolveUserVoice(opts.userId) || ELEVEN_DEFAULT_VOICE_ID;
    const cachePath = getCachePath(voiceId, text);

    if (fs.existsSync(cachePath)) {
      logInfo(`🎵 Cache hit ElevenLabs [${voiceId}]`);
      return createFfmpegResourceFromFile(cachePath);
    }

    // không có cache → gọi ElevenLabs API, stream về, đồng thời ghi file
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

    const payload = JSON.stringify({
      text: text,
      model_id: "eleven_turbo_v2_5",
	  language_id: "vi",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.3,
        use_speaker_boost: true
      }
    });

    return await new Promise(resolve => {
      let bytes = 0;
      const start = Date.now();

      const ffmpeg = spawn("ffmpeg", [
        "-loglevel", "quiet",
        "-f", "mp3",
        "-i", "pipe:0",
        "-filter:a", `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
        "-ac", "2",
        "-ar", "48000",
        "-f", "s16le",
        "pipe:1"
      ], { windowsHide: true });

      ffmpeg.on("close", () => {
        if (bytes > 0) {
          const sec = (Date.now() - start) / 1000;
          const kb = (bytes / 1024).toFixed(1);
          const sKB = (bytes / 1024 / sec).toFixed(1);
          logInfo(`📥 11Labs stream: ${kb} KB | ${sKB} kB/s | ${sec.toFixed(2)}s`);
        }
      });

      ffmpeg.on("error", err => {
        logError(`FFmpeg 11Labs error: ${err.message}`);
        resolve(null);
      });

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });
      resource.volume.setVolume(volume);

      const fileStream = fs.createWriteStream(cachePath);

      const req = https.request(url, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        }
      }, res => {
        res.on("data", b => {
          bytes += b.length;
        });

        res.on("end", () => {
          try { ffmpeg.stdin.end(); } catch {}
          fileStream.end();
        });

        res.on("error", err => {
          logError(`ElevenLabs stream err: ${err.message}`);
          ffmpeg.kill("SIGKILL");
          fileStream.close();
        });

        // stream tới ffmpeg và ghi ra file cache
        res.pipe(ffmpeg.stdin);
        res.pipe(fileStream);
      });

      req.on("error", err => {
        logError(`ElevenLabs HTTPS err: ${err.message}`);
        ffmpeg.kill("SIGKILL");
        fileStream.close();
        resolve(null);
      });

      req.write(payload);
      req.end();

      logSuccess(`🎧 [11Labs] ${username} (${voiceId}): "${text.slice(0, 50)}"`);
      resolve(resource);
    });

  } catch (err) {
    logError(`speakEleven error: ${err.message}`);
    return null;
  }
}

// =======================================
//       DISPATCH ENGINE
// =======================================
async function speak(text, username = "User", opts = {}) {
  switch (currentVoiceEngine) {
    case "gtts":
      return speakGTTS(text, username);
    case "11labs":
      return speakEleven(text, username, opts);
    default:
      return speakGTTS(text, username);
  }
}

// =======================================
//           QUEUE SYSTEM
// =======================================
const queue = [];
let isPlaying = false;

async function playQueue() {
  if (isPlaying || queue.length === 0) return;

  isPlaying = true;
  const item = queue.shift();

  try {
    const res = await speak(item.text, item.username, { userId: item.userId });
    if (!res) { isPlaying = false; return playQueue(); }

    player.play(res);

    const preview = item.raw.length > 80 ? item.raw.slice(0, 80) + "..." : item.raw;
    logInfo(`▶️ ${item.username}: "${preview}"`);

    player.once("idle", () => {
      isPlaying = false;
      playQueue();
    });

  } catch (err) {
    logError(`Queue error: ${err.message}`);
    isPlaying = false;
    playQueue();
  }
}

// =======================================
//       USER VOICE PREFERENCE (11Labs)
// =======================================
const USER_VOICE_FILE = './user_voices.json';
let userVoices = {};

function loadUserVoices() {
  if (!fs.existsSync(USER_VOICE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USER_VOICE_FILE));
  } catch {
    return {};
  }
}
function saveUserVoices() {
  fs.writeFileSync(USER_VOICE_FILE, JSON.stringify(userVoices, null, 2));
}
userVoices = loadUserVoices();

function resolveUserVoice(userId) {
  if (!userId) return ELEVEN_DEFAULT_VOICE_ID;
  const presetKey = userVoices[userId];
  if (!presetKey) return ELEVEN_DEFAULT_VOICE_ID;
  return ELEVEN_VOICE_PRESETS[presetKey] || ELEVEN_DEFAULT_VOICE_ID;
}

// =======================================
//        SLASH COMMAND REGISTER
// =======================================
async function registerCommands() {
  const cmds = [
    new SlashCommandBuilder().setName('joinbot').setDescription('Bot vào kênh voice'),
    new SlashCommandBuilder().setName('leavebot').setDescription('Bot rời kênh voice'),

    new SlashCommandBuilder()
      .setName('block')
      .setDescription('Chặn người dùng')
      .addUserOption(o => o.setName("user").setDescription("Người cần block").setRequired(true)),

    new SlashCommandBuilder()
      .setName('unblock')
      .setDescription('Bỏ chặn người dùng')
      .addUserOption(o => o.setName("user").setDescription("Người cần unblock").setRequired(true)),

    new SlashCommandBuilder()
      .setName('limit')
      .setDescription('Giới hạn ký tự người dùng')
      .addUserOption(o => o.setName("user").setDescription("Người cần giới hạn").setRequired(true))
      .addIntegerOption(o => o.setName("value").setDescription("Số ký tự (-1 = xóa)").setRequired(true)),

    new SlashCommandBuilder()
      .setName('delay')
      .setDescription('Delay chat người dùng')
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption(o => o.setName("seconds").setDescription("Delay giây (-1 = xóa)").setRequired(true)),

    new SlashCommandBuilder().setName('list')
      .setDescription('Xem danh sách block / limit / delay'),

    new SlashCommandBuilder()
      .setName('themtu')
      .setDescription('Thêm từ viết tắt')
      .addStringOption(o => o.setName("tu").setDescription("Từ").setRequired(true))
      .addStringOption(o => o.setName("doc").setDescription("Cách đọc").setRequired(true)),

    new SlashCommandBuilder()
      .setName('xoatu')
      .setDescription('Xóa từ viết tắt')
      .addStringOption(o => o.setName("tu").setDescription("Từ cần xóa").setRequired(true)),

    new SlashCommandBuilder().setName('viettat')
      .setDescription('Xem danh sách từ viết tắt'),

    new SlashCommandBuilder()
      .setName('tocdo')
      .setDescription('Tốc độ đọc (0.5 – 2.0)')
      .addNumberOption(o => o.setName("value").setDescription("Tốc độ").setRequired(true)),

    new SlashCommandBuilder()
      .setName('amluong')
      .setDescription('Âm lượng (0.1 – 2.0)')
      .addNumberOption(o => o.setName("value").setDescription("Âm lượng").setRequired(true)),

    // Chọn ENGINE: gtts / 11labs
    new SlashCommandBuilder()
      .setName('voiceengine')
      .setDescription('Đổi engine giọng đọc')
      .addStringOption(o =>
        o.setName('engine')
          .setDescription('Chọn engine')
          .setRequired(true)
          .addChoices(
            { name: 'Google TTS (Nhanh, free)', value: 'gtts' },
            { name: 'ElevenLabs (Giọng Việt tự nhiên)', value: '11labs' },
          )
      ),

    // User tự chọn preset giọng
    new SlashCommandBuilder()
      .setName('myvoice')
      .setDescription('Chọn giọng ElevenLabs cho riêng bạn')
      .addStringOption(o =>
        o.setName('voice')
          .setDescription('Chọn giọng')
          .setRequired(true)
          .addChoices(
            { name: 'Nam 1 (Phuoc)', value: 'vi_female_1' },
            { name: 'Nam 2 (Trung)', value: 'vi_female_2' },
            { name: 'Nam 3 (Tran Thanh)', value: 'vi_female_3' },
            { name: 'Nữ 1 (Hien)', value: 'vi_male_1' },
            { name: 'Nữ 2 (Linh Tong)', value: 'vi_male_2' },
          )
      ),

    // Admin set giọng cho người khác
    new SlashCommandBuilder()
      .setName('setvoice')
      .setDescription('Set giọng ElevenLabs cho user (admin)')
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o =>
        o.setName('voice')
          .setDescription('Chọn giọng')
          .setRequired(true)
          .addChoices(
            { name: 'Nữ 1 (vi_female_1)', value: 'vi_female_1' },
            { name: 'Nữ 2 (vi_female_2)', value: 'vi_female_2' },
            { name: 'Nữ 3 (vi_female_3)', value: 'vi_female_3' },
            { name: 'Nam 1 (vi_male_1)', value: 'vi_male_1' },
            { name: 'Nam 2 (vi_male_2)', value: 'vi_male_2' },
          )
      ),

    new SlashCommandBuilder().setName('shutdown')
      .setDescription('Tắt bot (chỉ OWNER)'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: cmds });

  logSuccess("Slash commands registered.");
}

// =======================================
//            BOT READY
// =======================================
client.once('ready', () => {
  logSuccess(`🤖 Bot đã đăng nhập: ${client.user.tag}`);
});

// =======================================
//         SLASH COMMAND HANDLER
// =======================================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const name = i.commandName;

  // ADMIN ONLY COMMANDS
  if (["block", "unblock", "limit", "delay", "shutdown", "setvoice"].includes(name)) {
    if (i.user.id !== OWNER_ID)
      return i.reply({ content: "🚫 Bạn không có quyền dùng lệnh này.", flags: 64 });
  }

  // ====== BLOCK ======
  if (name === "block") {
    const user = i.options.getUser("user");
    userRules[user.id] = userRules[user.id] || {};
    userRules[user.id].block = true;
    saveRules();
    return i.reply({ content: `🚫 Đã block **${user.username}**`, flags: 64 });
  }

  // ====== UNBLOCK ======
  if (name === "unblock") {
    const user = i.options.getUser("user");
    if (userRules[user.id]) delete userRules[user.id].block;
    saveRules();
    return i.reply({ content: `✅ Đã bỏ block **${user.username}**`, flags: 64 });
  }

  // ====== LIMIT ======
  if (name === "limit") {
    const user = i.options.getUser("user");
    const v = i.options.getInteger("value");

    userRules[user.id] = userRules[user.id] || {};

    if (v === -1) {
      delete userRules[user.id].limit;
      saveRules();
      return i.reply({ content: `♻️ Đã xóa limit của **${user.username}**`, flags: 64 });
    }

    userRules[user.id].limit = v;
    saveRules();
    return i.reply({ content: `✂️ Đã đặt limit cho **${user.username}** = ${v} ký tự`, flags: 64 });
  }

  // ====== DELAY ======
  if (name === "delay") {
    const user = i.options.getUser("user");
    const sec = i.options.getInteger("seconds");

    userRules[user.id] = userRules[user.id] || {};

    if (sec === -1) {
      delete userRules[user.id].delay;
      saveRules();
      return i.reply({ content: `♻️ Đã xóa delay của **${user.username}**`, flags: 64 });
    }

    userRules[user.id].delay = sec;
    saveRules();
    return i.reply({ content: `⏳ Delay chat của **${user.username}** = ${sec}s`, flags: 64 });
  }

  // ====== LIST ======
  if (name === "list") {
    let txt = "📋 **Danh sách rule người dùng:**\n\n";

    for (const [uid, rule] of Object.entries(userRules)) {
      const u = await i.guild.members.fetch(uid).catch(() => null);
      txt += `👤 **${u?.displayName || uid}**\n`;
      if (rule.block) txt += `   • 🚫 Blocked\n`;
      if (rule.limit) txt += `   • ✂ Limit: ${rule.limit}\n`;
      if (rule.delay) txt += `   • ⏳ Delay: ${rule.delay}s\n`;
      txt += "\n";
    }

    if (txt.trim() === "📋 **Danh sách rule người dùng:**") txt += "Không có ai.";

    return i.reply({ content: txt, flags: 64 });
  }

  // ====== JOIN ======
  if (name === "joinbot") {
    const vc = i.member.voice.channel;
    if (!vc) {
      return i.reply({ content: "⚠️ Bạn phải vào kênh voice trước.", flags: 64 });
    }

    await i.reply({ content: `⏳ Đang vào kênh **${vc.name}**...`, flags: 64 });

    try {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: i.guild.id,
        adapterCreator: i.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);

      entersState(connection, VoiceConnectionStatus.Ready, 15000)
        .then(() => {
          logSuccess(`Bot đã vào voice: ${vc.name}`);
          i.editReply({ content: `✅ Đã vào **${vc.name}**!` });
        })
        .catch(err => {
          logError("Join error: " + err.message);
          i.editReply({ content: `❌ Không vào được: ${err.message}` });
        });

    } catch (err) {
      logError("Join exception: " + err.message);
      return i.editReply({ content: `❌ Lỗi join: ${err.message}` });
    }
  }

  // ====== LEAVE ======
  if (name === "leavebot") {
    if (connection) {
      connection.destroy();
      connection = null;
      return i.reply({ content: "👋 Bot đã rời voice.", flags: 64 });
    }
    return i.reply({ content: "⚠️ Bot không ở voice nào.", flags: 64 });
  }

  // ====== ADD SLANG ======
  if (name === "themtu") {
    const tu = i.options.getString("tu").toLowerCase();
    const doc = i.options.getString("doc");

    const cur = loadCustomSlang();
    cur[tu] = doc;
    saveCustomSlang(cur);

    return i.reply({ content: `✨ Đã thêm: **${tu} → ${doc}**`, flags: 64 });
  }

  // ====== REMOVE SLANG ======
  if (name === "xoatu") {
    const tu = i.options.getString("tu").toLowerCase();
    const cur = loadCustomSlang();

    if (cur[tu]) {
      delete cur[tu];
      saveCustomSlang(cur);
      return i.reply({ content: `🗑️ Đã xóa **${tu}**`, flags: 64 });
    }

    return i.reply({ content: `⚠️ Không tồn tại từ đó.`, flags: 64 });
  }

  // ====== SHOW SLANG ======
  if (name === "viettat") {
    const all = getAllSlang();
    const out = Object.entries(all)
      .map(([k, v]) => `🔹 **${k}** → ${v}`)
      .join("\n");

    return i.reply({ content: out, flags: 64 });
  }

  // ====== SPEED ======
  if (name === "tocdo") {
    let v = i.options.getNumber("value");
    if (v < 0.5 || v > 2.0)
      return i.reply({ content: "⚠️ Tốc độ hợp lệ: 0.5 – 2.0", flags: 64 });

    speed = v;
    return i.reply({ content: `⚙️ Tốc độ đọc = ${speed}x`, flags: 64 });
  }

  // ====== VOLUME ======
  if (name === "amluong") {
    let v = i.options.getNumber("value");
    if (v < 0.1 || v > 2.0)
      return i.reply({ content: "⚠️ Âm lượng hợp lệ: 0.1 – 2.0", flags: 64 });

    volume = v;
    return i.reply({ content: `🔊 Âm lượng = ${volume}x`, flags: 64 });
  }

  // ====== VOICE ENGINE ======
  if (name === "voiceengine") {
    const api = i.options.getString("engine");

    if (api === '11labs' && !ELEVEN_API_KEY) {
      return i.reply({
        content: "⚠️ Bạn chọn ElevenLabs nhưng chưa cấu hình `ELEVEN_API_KEY`.",
        flags: 64
      });
    }

    currentVoiceEngine = api;
    const label = api === "gtts" ? "Google TTS" : "ElevenLabs";

    return i.reply({ content: `🎙️ Đã đổi engine sang **${label}**.`, flags: 64 });
  }

  // ====== MYVOICE (USER CHỌN GIỌNG) ======
  if (name === "myvoice") {
    const voiceKey = i.options.getString("voice");
    if (!ELEVEN_VOICE_PRESETS[voiceKey]) {
      return i.reply({ content: "⚠️ Giọng này chưa được cấu hình ID.", flags: 64 });
    }
    userVoices[i.user.id] = voiceKey;
    saveUserVoices();
    return i.reply({
      content: `✅ Giọng ElevenLabs của bạn đã đổi sang **${voiceKey}**.\n(Đảm bảo engine đang là \`11labs\` bằng /voiceengine)`,
      flags: 64
    });
  }

  // ====== SETVOICE (ADMIN SET CHO USER KHÁC) ======
  if (name === "setvoice") {
    const user = i.options.getUser("user");
    const voiceKey = i.options.getString("voice");

    if (!ELEVEN_VOICE_PRESETS[voiceKey]) {
      return i.reply({ content: "⚠️ Giọng này chưa được cấu hình ID.", flags: 64 });
    }

    userVoices[user.id] = voiceKey;
    saveUserVoices();

    return i.reply({
      content: `✅ Đã set giọng **${voiceKey}** cho **${user.username}**.`,
      flags: 64
    });
  }

  // ====== SHUTDOWN ======
  if (name === "shutdown") {
    await i.reply({ content: "🛑 Bot đang tắt...", flags: 64 });
    process.exit(0);
  }
});

// =======================================
//          MESSAGE EVENT (TTS TRIGGER)
// =======================================
client.on("messageCreate", async msg => {
  try {
    if (!connection) return;
    if (msg.author.bot) return;

    const uid = msg.author.id;
    const raw = msg.content.trim();
    if (!raw) return;

    // BLOCK
    if (userRules[uid]?.block) {
      return msg.reply({
        content: "😒 M đã bị khóa mõm rồi con.",
        allowedMentions: { repliedUser: false }
      });
    }

    // LIMIT
    if (userRules[uid]?.limit && raw.length > userRules[uid].limit) {
      return msg.reply({
        content: `⚠️ Quá giới hạn ${userRules[uid].limit} ký tự.`,
        allowedMentions: { repliedUser: false }
      });
    }

    // DELAY CHECK
    if (userRules[uid]?.delay) {
      const now = Date.now();
      const last = userRules[uid].lastMessage || 0;
      const sec = userRules[uid].delay;

      if (now - last < sec * 1000) {
        const remain = ((sec * 1000 - (now - last)) / 1000).toFixed(1);
        return msg.reply({
          content: `⏳ Miệng m chưa hồi chiêu, đợi thêm ${remain}s.`,
          allowedMentions: { repliedUser: false }
        });
      }

      userRules[uid].lastMessage = now;
      saveRules();
    }

    // HỌC DẤU TỪ CÂU GỐC CÓ DẤU
    learnAccentsFromText(raw);

    const username = msg.member?.displayName || msg.author.username;
    const { maskedText, links } = extractAndMaskLinks(raw);

    let processed = expandSlang(maskedText);
    processed = applyAccentToText(processed);
    processed = normalizeNumbers(processed);

    if (links.length > 0)
      logInfo(`🔗 ${username} skip ${links.length} link: ${links.join(', ')}`);

    queue.push({ text: processed, username, raw, links, userId: uid });
    playQueue();

  } catch (err) {
    logError("messageCreate error: " + err.message);
  }
});

// =======================================
//     CMD/CONSOLE TTS INPUT (REALTIME)
// =======================================
// Gõ trực tiếp trong terminal: bot sẽ đọc trên voice hiện tại
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', line => {
  if (!connection) {
    logWarn("Chưa có connection voice. Dùng /joinbot trong server trước.");
    return;
  }

  const raw = line.trim();
  if (!raw) return;

  // học dấu từ console
  learnAccentsFromText(raw);

  const { maskedText } = extractAndMaskLinks(raw);
  let processed = expandSlang(maskedText);
  processed = applyAccentToText(processed);
  processed = normalizeNumbers(processed);

  queue.push({
    text: processed,
    username: "Console",
    raw,
    links: [],
    userId: null,
  });
  playQueue();
});

// =======================================
//              START BOT
// =======================================
registerCommands().then(() => {
  client.login(token);
}).catch(err => {
  logError("Register commands error: " + err.message);
});
