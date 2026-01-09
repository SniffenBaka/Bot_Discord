// =========================================
//  DISCORD TTS BOT – FULL FIXED EDITION
// =========================================

// === IMPORT MODULES ===
require('dotenv').config({ path: './info.env' });
const fs = require('fs');
const {
  Client, GatewayIntentBits, Routes, REST, Partials, SlashCommandBuilder,
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  StreamType, entersState, VoiceConnectionStatus,
} = require('@discordjs/voice');
const gtts = require('google-tts-api');
const { spawn } = require('child_process');
const https = require('https');

// === TOKEN & ID ===
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const OWNER_ID = "1020648077335461971"; // ← THAY BẰNG ID CỦA BẠN

// ==== TTS ENGINE CHỌN API ====
// gtts  = google-tts-api (như hiện tại, nhanh, free)
// fpt   = FPT.AI Text To Speech (giọng Việt tự nhiên, cần FPT_API_KEY)
let currentVoiceEngine = 'gtts';

const FPT_TTS_URL = 'https://api.fpt.ai/hmi/tts/v5';
const FPT_API_KEY = process.env.FPT_API_KEY || null;
const FPT_VOICE = process.env.FPT_VOICE || 'banmai'; // banmai, lannhi, leminh, ...

// === CLIENT DISCORD ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
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
const userRules = {}; // { userID: { block: true, limit: N, delay: sec, lastMessage: timestamp } }

// === SAVE / LOAD RULES ===
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

// Load rules on start
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
//  EXPAND ABBREVIATION & NUMBERS
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
      const w = words[i];
      if (/^[A-ZĐ]+$/.test(w))
        result.push(w.split("").map(ch => vietnameseAlphabet[ch.toLowerCase()] || ch).join(" "));
      else result.push(w);
      i++;
    }
  }
  return result.join(" ");
}

// =======================================
//  HỌC DẤU & TỰ THÊM DẤU
// =======================================
const ACCENT_FILE = './accent_learn.json';
let accentData = {};

// load/save
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

// bỏ dấu tiếng Việt
function removeAccents(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// học từ các câu có dấu user gõ
function learnAccentsFromText(text) {
  const tokens = text.split(/\s+/);
  for (const t of tokens) {
    const word = t.toLowerCase().replace(/[^a-zA-ZÀ-ỹà-ỹĐđ]/g, '');
    if (!word) continue;
    const base = removeAccents(word);
    if (!base) continue;
    if (base === word) continue; // không có dấu thì bỏ qua

    if (!accentData[base]) accentData[base] = {};
    accentData[base][word] = (accentData[base][word] || 0) + 1;
  }
  saveAccentData();
}

// áp dụng dấu đã học cho text không dấu
function applyAccentToText(text) {
  const tokens = text.split(/\s+/);
  const out = tokens.map(tok => {
    const core = tok.replace(/[^a-zA-ZÀ-ỹà-ỹĐđ]/g, '');
    if (!core) return tok;

    const lower = core.toLowerCase();
    const base = removeAccents(lower);
    if (!base || !accentData[base]) return tok;

    let best = null;
    let max = 0;
    for (const [w, c] of Object.entries(accentData[base])) {
      if (c > max) {
        max = c;
        best = w;
      }
    }
    if (!best) return tok;

    // thay phần chữ, giữ lại dấu câu/prefix/suffix
    return tok.replace(core, best);
  });
  return out.join(" ");
}

accentData = loadAccentData();

// =======================================
//  ĐỌC SỐ THÔNG MINH (50k, 0.1, v.v.)
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
      const a = numStr[0];
      const b = numStr[1];
      const tens = parseInt(a, 10);
      const ones = parseInt(b, 10);
      let res = "";

      if (tens === 1) res = "mười";
      else res = (map[a] || a) + " mươi";

      if (ones === 0) return res;
      if (ones === 1 && tens > 1) return res + " mốt";
      if (ones === 5 && tens >= 1) return res + " lăm";
      return res + " " + (map[b] || b);
    }

    // số dài hơn 2 chữ số → đọc từng số
    return numStr.split("").map(d => map[d] || d).join(" ");
  }

  // 1) Số thập phân: 0.1 → "không chấm một"
  text = text.replace(/(\d+)\.(\d+)/g, (match, intPart, fracPart) => {
    const intSpeak = intPart.split("").map(d => map[d] || d).join(" ");
    const fracSpeak = fracPart.split("").map(d => map[d] || d).join(" ");
    return `${intSpeak} chấm ${fracSpeak}`;
  });

  // 2) 50k / 50 k → "năm mươi ka" (k = nghìn)
  const K_WORD = "ka"; // thích thì đổi "ka" thành "kờ" hay "kar" tùy bạn

  text = text.replace(/(\d+)\s*k\b/gi, (m, num) => `${readInt(num)} ${K_WORD}`);
  text = text.replace(/(\d+)k\b/gi, (m, num) => `${readInt(num)} ${K_WORD}`);

  // 3) Các số còn lại
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
//            TTS ENGINE
// =======================================
let connection;
const player = createAudioPlayer();
let speed = 1.0;
let volume = 1.0;

// --- GOOGLE TTS (cũ) ---
async function speakGTTS(text, username = "Người dùng") {
  try {
    if (!text) return null;
    text = text.trim();
    if (!text) return null;

    const maxLen = 190;
    const chunks = [];
    let cur = "";

    for (const w of text.split(/\s+/)) {
      if ((cur + " " + w).length > maxLen) {
        chunks.push(cur.trim());
        cur = w;
      } else cur += " " + w;
    }
    if (cur.trim()) chunks.push(cur.trim());

    const tmpFiles = [];
    let bytes = 0;
    const start = Date.now();

    for (const chunk of chunks) {
      const url = gtts.getAudioUrl(chunk, { lang: "vi", slow: speed < 1.0 });
      const tmp = `./tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;

      await new Promise((resolve, reject) => {
        const f = fs.createWriteStream(tmp);
        https.get(url, res => {
          res.pipe(f);
          res.on("data", b => bytes += b.length);
          res.on("end", resolve);
          res.on("error", reject);
        }).on("error", reject);
      });

      tmpFiles.push(tmp);
    }

    const sec = (Date.now() - start) / 1000;
    const kb = (bytes / 1024).toFixed(1);
    const speedKB = (bytes / 1024 / sec).toFixed(1);
    logInfo(`📥 TTS tải: ${kb} KB | ${speedKB} kB/s | ${sec.toFixed(2)}s`);

    const list = "./tts_list.txt";
    fs.writeFileSync(list, tmpFiles.map(f => `file '${f}'`).join("\n"));

    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "quiet",
      "-f", "concat", "-safe", "0",
      "-i", list,
      "-filter:a", `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
      "-ac", "2", "-ar", "48000",
      "-f", "s16le", "pipe:1"
    ]);

    ffmpeg.on("close", () => {
      tmpFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      fs.existsSync(list) && fs.unlinkSync(list);
    });

    const res = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw, inlineVolume: true
    });
    res.volume.setVolume(volume);

    logSuccess(`🎧 ${username} đã nói: "${text.slice(0, 50)}"`);
    return res;

  } catch (err) {
    logError(`TTS ERROR: ${err.message}`);
    return null;
  }
}

// --- FPT.AI TTS ---
async function speakFPT(text, username = "Người dùng") {
  try {
    if (!text) return null;
    text = text.trim();
    if (!text) return null;

    if (!FPT_API_KEY) {
      logWarn("FPT_API_KEY chưa cấu hình, fallback sang Google TTS.");
      return await speakGTTS(text, username);
    }

    // FPT giới hạn khoảng vài nghìn ký tự / request → cắt cho an toàn
    const payload = text.length > 4900 ? text.slice(0, 4900) : text;

    const meta = await new Promise((resolve, reject) => {
      const req = https.request(FPT_TTS_URL, {
        method: "POST",
        headers: {
          "api_key": FPT_API_KEY,
          "voice": FPT_VOICE,
          "speed": "0",
          "format": "mp3",
          "Content-Type": "text/plain; charset=utf-8",
        },
      }, res => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    if (!meta || meta.error !== 0 || !meta.async) {
      logError("FPT TTS trả về lỗi: " + JSON.stringify(meta));
      return null;
    }

    const tmp = `./tts_fpt_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
    let bytes = 0;
    const start = Date.now();

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmp);
      https.get(meta.async, res => {
        res.pipe(file);
        res.on("data", b => bytes += b.length);
        res.on("end", resolve);
        res.on("error", reject);
      }).on("error", reject);
    });

    const sec = (Date.now() - start) / 1000;
    const kb = (bytes / 1024).toFixed(1);
    const speedKB = (bytes / 1024 / sec).toFixed(1);
    logInfo(`📥 FPT TTS tải: ${kb} KB | ${speedKB} kB/s | ${sec.toFixed(2)}s`);

    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "quiet",
      "-i", tmp,
      "-filter:a", `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
      "-ac", "2", "-ar", "48000",
      "-f", "s16le", "pipe:1"
    ]);

    ffmpeg.on("close", () => {
      fs.existsSync(tmp) && fs.unlinkSync(tmp);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume.setVolume(volume);

    logSuccess(`🎧 [FPT] ${username} đã nói: "${text.slice(0, 50)}"`);
    return resource;

  } catch (err) {
    logError(`FPT TTS ERROR: ${err.message}`);
    return null;
  }
}

// --- DISPATCHER: dùng engine hiện tại ---
async function speak(text, username = "Người dùng") {
  if (currentVoiceEngine === 'fpt') {
    return await speakFPT(text, username);
  }
  return await speakGTTS(text, username);
}

// =======================================
//             QUEUE SYSTEM
// =======================================
const queue = [];
let isPlaying = false;

async function playQueue() {
  if (isPlaying || queue.length === 0) return;
  isPlaying = true;

  const item = queue.shift();

  try {
    const res = await speak(item.text, item.username);
    if (!res) { isPlaying = false; return playQueue(); }

    player.play(res);

    const preview = item.raw.length > 80 ? item.raw.slice(0, 80) + "..." : item.raw;
    if (item.links.length > 0)
      logInfo(`▶️ ${item.username}: "${preview}" (skip ${item.links.length} links)`);
    else
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
      .addIntegerOption(o => o.setName("value").setDescription("Số ký tự (đặt -1 để xóa)").setRequired(true)),

    new SlashCommandBuilder()
      .setName('delay')
      .setDescription('Delay chat của người dùng')
      .addUserOption(o => o.setName("user").setDescription("Người cần delay").setRequired(true))
      .addIntegerOption(o => o.setName("seconds").setDescription("Delay (giây), -1 để xóa").setRequired(true)),

    new SlashCommandBuilder()
      .setName('list')
      .setDescription('Xem danh sách block / limit / delay'),

    new SlashCommandBuilder().setName('themtu')
      .setDescription('Thêm từ viết tắt')
      .addStringOption(o => o.setName("tu").setDescription("Từ").setRequired(true))
      .addStringOption(o => o.setName("doc").setDescription("Cách đọc").setRequired(true)),

    new SlashCommandBuilder().setName('xoatu')
      .setDescription('Xóa từ viết tắt')
      .addStringOption(o => o.setName("tu").setDescription("Từ cần xóa").setRequired(true)),

    new SlashCommandBuilder().setName('viettat')
      .setDescription('Xem danh sách từ viết tắt'),

    new SlashCommandBuilder().setName('tocdo')
      .setDescription('Tốc độ đọc (0.5 – 2.0)')
      .addNumberOption(o => o.setName("value").setDescription("Tốc độ").setRequired(true)),

    new SlashCommandBuilder().setName('amluong')
      .setDescription('Âm lượng (0.1 – 2.0)')
      .addNumberOption(o => o.setName("value").setDescription("Âm lượng").setRequired(true)),

    new SlashCommandBuilder()
      .setName('voice')
      .setDescription('Đổi API giọng đọc')
      .addStringOption(o =>
        o.setName('api')
          .setDescription('Chọn engine TTS')
          .setRequired(true)
          .addChoices(
            { name: 'Google TTS (nhanh, free)', value: 'gtts' },
            { name: 'FPT.AI TTS (giọng Việt, cần API key)', value: 'fpt' },
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

  // ADMIN ONLY
  if (["block", "unblock", "delay", "limit", "shutdown"].includes(name)) {
    if (i.user.id !== OWNER_ID)
      return i.reply({ content: "🚫 Bạn không có quyền.", flags: 64 });
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

    return i.reply({ content: `✅ Đã unblock **${user.username}**`, flags: 64 });
  }

  // ====== LIMIT ======
  if (name === "limit") {
    const user = i.options.getUser("user");
    const v = i.options.getInteger("value");

    userRules[user.id] = userRules[user.id] || {};

    if (v === -1) {
      delete userRules[user.id].limit;
      saveRules();
      return i.reply({ content: `♻️ Đã xóa giới hạn ký tự của **${user.username}**`, flags: 64 });
    }

    userRules[user.id].limit = v;
    saveRules();

    return i.reply({ content: `✂️ Giới hạn **${user.username}** còn ${v} ký tự`, flags: 64 });
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

    return i.reply({ content: `⏳ Delay **${user.username}** = ${sec}s`, flags: 64 });
  }

  // ====== LIST ======
  if (name === "list") {
    let txt = "📋 **Danh sách người bị rule:**\n\n";
    for (const [uid, rule] of Object.entries(userRules)) {
      const u = await i.guild.members.fetch(uid).catch(() => null);
      txt += `👤 **${u?.displayName || uid}**\n`;
      if (rule.block) txt += `   • 🚫 Blocked\n`;
      if (rule.limit) txt += `   • ✂ Limit: ${rule.limit}\n`;
      if (rule.delay) txt += `   • ⏳ Delay: ${rule.delay}s\n`;
      txt += "\n";
    }
    if (txt.trim() === "📋 **Danh sách người bị rule:**") txt += "Không có ai.";

    return i.reply({ content: txt, flags: 64 });
  }

  // ====== JOIN ======
  if (name === 'joinbot') {
    const vc = i.member.voice.channel;
    if (!vc) {
      return i.reply({
        content: '⚠️ Bạn phải vào kênh thoại trước.',
        flags: 64
      });
    }

    // ⚡ TRẢ LỜI NGAY LẬP TỨC — tránh timeout interaction
    await i.reply({
      content: `⏳ Đang vào kênh **${vc.name}**...`,
      flags: 64
    });

    try {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: i.guild.id,
        adapterCreator: i.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);

      // Chờ kết nối nhưng KHÔNG BLOCK interaction
      entersState(connection, VoiceConnectionStatus.Ready, 15_000)
        .then(() => {
          logSuccess(`Đã vào kênh: ${vc.name}`);
          i.editReply({
            content: `✅ Đã vào **${vc.name}**!`
          });
        })
        .catch(err => {
          logError(`Join lỗi: ${err.message}`);
          i.editReply({
            content: `❌ Không thể vào kênh: ${err.message}`
          });
        });

    } catch (err) {
      logError(`Joinbot exception: ${err.message}`);
      return i.editReply({
        content: `❌ Lỗi khi vào kênh: ${err.message}`
      });
    }
  }

  // ====== LEAVE ======
  if (name === "leavebot") {
    if (connection) {
      connection.destroy();
      connection = null;
      return i.reply({ content: "👋 Bot đã rời voice.", flags: 64 });
    }
    return i.reply({ content: "⚠️ Bot không ở voice.", flags: 64 });
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
    const out = Object.entries(all).map(([k, v]) => `🔹 **${k}** → ${v}`).join("\n");
    return i.reply({ content: out, flags: 64 });
  }

  // ====== SPEED ======
  if (name === "tocdo") {
    let v = i.options.getNumber("value");
    if (v < 0.5 || v > 2.0) return i.reply({ content: "⚠️ 0.5 – 2.0", flags: 64 });
    speed = v;
    return i.reply({ content: `⚙️ Tốc độ = ${speed}x`, flags: 64 });
  }

  // ====== VOLUME ======
  if (name === "amluong") {
    let v = i.options.getNumber("value");
    if (v < 0.1 || v > 2.0) return i.reply({ content: "⚠️ 0.1 – 2.0", flags: 64 });
    volume = v;
    return i.reply({ content: `🔊 Âm lượng = ${volume}x`, flags: 64 });
  }

  // ====== VOICE (đổi API TTS) ======
  if (name === "voice") {
    const api = i.options.getString("api"); // gtts | fpt

    if (api === 'fpt' && !FPT_API_KEY) {
      return i.reply({
        content: "⚠️ Bạn chọn FPT.AI nhưng chưa cấu hình `FPT_API_KEY` trong info.env.",
        flags: 64
      });
    }

    currentVoiceEngine = api;

    const label = api === 'gtts'
      ? 'Google TTS (google-tts-api)'
      : 'FPT.AI TTS';

    return i.reply({
      content: `🎙️ Đã chuyển engine giọng đọc sang **${label}**.`,
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
//          MESSAGE EVENT
// =======================================
client.on("messageCreate", async msg => {
  try {
    if (!connection) return;
    if (msg.author.bot) return;

    const uid = msg.author.id;
    const raw = msg.content.trim();
    if (!raw) return;

    // ============================
    //         RULE CHECKER
    // ============================

    // BLOCK
    if (userRules[uid]?.block) {
      return msg.reply({ content: "😒 M đã bị khóa mõm rồi con.", allowedMentions: { repliedUser: false } });
    }

    // LIMIT
    if (userRules[uid]?.limit && raw.length > userRules[uid].limit) {
      return msg.reply({ content: `⚠️ Mày vượt quá ${userRules[uid].limit} ký tự rồi đó.`, allowedMentions: { repliedUser: false } });
    }

    // DELAY
    if (userRules[uid]?.delay) {
      const now = Date.now();
      const last = userRules[uid].lastMessage || 0;
      const waitSec = userRules[uid].delay;

      if (now - last < waitSec * 1000) {
        const remain = ((waitSec * 1000 - (now - last)) / 1000).toFixed(1);
        return msg.reply({ content: `⏳ Miệng m chưa hồi chiêu, đợi thêm ${remain}s.`, allowedMentions: { repliedUser: false } });
      }

      userRules[uid].lastMessage = now;
      saveRules();
    }

    // ============================
    //   HỌC DẤU TỪ CÂU USER GÕ
    // ============================
    // Những từ có dấu trong câu này sẽ được lưu lại để sau đọc đúng cho bản không dấu
    learnAccentsFromText(raw);

    // ============================
    //   EXPAND & NORMALIZE TEXT
    // ============================
    const username = msg.member?.displayName || msg.author.username;

    const { maskedText, links } = extractAndMaskLinks(raw);
    const expanded = expandSlang(maskedText);
    const withAccents = applyAccentToText(expanded);
    const normalized = normalizeNumbers(withAccents);

    if (links.length > 0)
      logInfo(`🔗 ${username} skip ${links.length} link: ${links.join(', ')}`);

    queue.push({ text: normalized, username, raw, links });
    playQueue();

  } catch (err) {
    logError("messageCreate: " + err.message);
  }
});

// =======================================
//              START BOT
// =======================================
registerCommands()
  .then(() => client.login(token))
  .catch(err => {
    console.error("Startup error:", err);
    process.exit(1);
  });

