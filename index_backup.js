// === IMPORT THƯ VIỆN ===
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
const OWNER_ID = "YOUR_DISCORD_ID"; // 🔧 Thay bằng ID Discord của bạn

// === CLIENT DISCORD ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// === FILE TỪ ĐIỂN TUỲ CHỈNH ===
const CUSTOM_FILE = './custom_slang.json';
if (!fs.existsSync(CUSTOM_FILE)) fs.writeFileSync(CUSTOM_FILE, JSON.stringify({}, null, 2));

// === CẤU HÌNH BOT ===
let connection;
const player = createAudioPlayer();
let speed = 1.0;
let volume = 1.0;
const queue = [];
let isPlaying = false;

// === LOG HỖ TRỢ ===
function logInfo(msg) { console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`); }
function logSuccess(msg) { console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`); }
function logWarn(msg) { console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`); }
function logError(msg) { console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`); }

// === TỪ VIẾT TẮT ===
function loadCustomSlang() {
  try { return JSON.parse(fs.readFileSync(CUSTOM_FILE)); }
  catch { return {}; }
}
function saveCustomSlang(data) {
  fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2));
}
function getAllSlang() {
  const defaultSlang = {
    vl: 'vãi lờ', vcl: 'vãi cả lờ', cc: 'con cặc', dm: 'địt mẹ',
    thg: 'thằng', m: 'mày', ko: 'không', k: 'không',
    dc: 'được', bh: 'bây giờ', j: 'gì', r: 'rồi',
    lm: 'làm', ns: 'nói', de: 'để', vao: 'vào',
    day: 'đây', no: 'nó', v: 'vờ',
  };
  return { ...defaultSlang, ...loadCustomSlang() };
}

// === XỬ LÝ CHỮ VIẾT HOA ===
const vietnameseAlphabet = {
  a: 'a', b: 'bê', c: 'xê', d: 'đê', e: 'e', g: 'gờ',
  h: 'hát', i: 'i', k: 'ca', l: 'el', m: 'em', n: 'en',
  o: 'o', p: 'pê', q: 'quy', r: 'a', s: 'ét', t: 'tê',
  u: 'u', v: 'vê', x: 'ích', y: 'i dài', f: 'ép', j: 'gi',
  w: 'đắp liu', z: 'dét', đ: 'đờ',
};

// === HÀM THAY TỪ VIẾT TẮT ===
function expandSlang(text) {
  const slang = getAllSlang();
  const words = text.split(/\s+/);
  const result = [];

  for (let i = 0; i < words.length;) {
    let matched = false;
    for (let len = Math.min(5, words.length - i); len > 0; len--) {
      const phrase = words.slice(i, i + len).join(' ').toLowerCase();
      if (slang[phrase]) {
        result.push(slang[phrase]);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const w = words[i];
      if (/^[A-ZĐ]+$/.test(w)) {
        result.push(w.split('').map(ch => vietnameseAlphabet[ch.toLowerCase()] || ch).join(' '));
      } else result.push(w);
      i++;
    }
  }
  return result.join(' ');
}

// === CHUYỂN SỐ SANG CHỮ ===
function normalizeNumbers(text) {
  const map = { '0': 'không', '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn', '5': 'năm', '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín' };
  return text.replace(/\d+/g, n => n.split('').map(d => map[d] || d).join(' '));
}

// === HÀM BỎ QUA LINK (NHƯNG VẪN LOG) ===
function extractAndMaskLinks(text) {
  if (typeof text !== 'string') text = String(text);
  const skipped = [];

  // 1️⃣ Code block (```...```) và inline code (`...`)
  text = text.replace(/```[\s\S]*?```/g, m => {
    skipped.push(m);
    return '[code-block]';
  });
  text = text.replace(/`[^`]+`/g, m => {
    skipped.push(m);
    return '[inline-code]';
  });

  // 2️⃣ Link (http / https)
  text = text.replace(/https?:\/\/[^\s]+/gi, m => {
    skipped.push(m);
    return '[link]';
  });

  // 3️⃣ Mention user, role, channel (<@123>, <@!123>, <@&456>, <#789>)
  text = text.replace(/<[@#&]!?[\d]+>/g, m => {
    skipped.push(m);
    return '[mention]';
  });

  // 4️⃣ Emoji custom (<:smile:123> hoặc <a:wave:456>)
  text = text.replace(/<a?:\w+:\d+>/g, m => {
    skipped.push(m);
    return '[emoji]';
  });

  // 5️⃣ Làm gọn nhiều khoảng trắng liên tiếp
  text = text.replace(/\s{2,}/g, ' ').trim();

  return { maskedText: text, links: skipped };
}

// === TTS GOOGLE (TỰ GHÉP FFMPEG) ===
async function speak(text, username = "Người dùng") {
  try {
    if (!text) return null;
    text = text.trim();
    if (!text) return null;

    const maxLen = 190;
    const chunks = [];
    let current = "";
    for (const word of text.split(/\s+/)) {
      if ((current + " " + word).length > maxLen) {
        chunks.push(current.trim());
        current = word;
      } else current += " " + word;
    }
    if (current.trim()) chunks.push(current.trim());

    const tmpFiles = [];
    let totalBytes = 0;
    const start = Date.now();

    for (const chunk of chunks) {
      const url = gtts.getAudioUrl(chunk, { lang: 'vi', slow: speed < 1.0 });
      const tmp = `./tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
      const file = fs.createWriteStream(tmp);
      await new Promise((res, rej) => {
        https.get(url, r => {
          r.pipe(file);
          r.on('data', b => totalBytes += b.length);
          r.on('end', res);
          r.on('error', rej);
        }).on('error', rej);
      });
      tmpFiles.push(tmp);
    }

    const elapsed = (Date.now() - start) / 1000;
    const kb = (totalBytes / 1024).toFixed(1);
    const speedKBps = (totalBytes / 1024 / elapsed).toFixed(1);
    logInfo(`📥 TTS tải: ${kb} KB | ${speedKBps} kB/s | ${elapsed.toFixed(2)}s`);

    const listFile = './tts_list.txt';
    fs.writeFileSync(listFile, tmpFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));

    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'quiet', '-f', 'concat', '-safe', '0',
      '-i', listFile, '-filter:a', `atempo=${Math.min(Math.max(speed, 0.5), 2.0)}`,
      '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'
    ]);

    ffmpeg.on('close', () => {
      tmpFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    });

    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume.setVolume(volume);
    logSuccess(`🎧 ${username} đã nói: "${text.slice(0, 50)}"`);
    return resource;
  } catch (err) {
    logError(`❌ speak(): ${err.message}`);
    return null;
  }
}

// === HÀNG ĐỢI PHÁT ===
async function playQueue() {
  if (isPlaying || queue.length === 0) return;
  isPlaying = true;
  const item = queue.shift();

  try {
    const resource = await speak(item.text, item.username);
    if (resource) {
      player.play(resource);
      const preview = item.raw.length > 80 ? item.raw.slice(0, 77) + '...' : item.raw;
      if (item.links?.length) logInfo(`▶️ ${item.username}: "${preview}" (links skipped: ${item.links.length})`);
      else logInfo(`▶️ ${item.username}: "${preview}"`);
      player.once('idle', () => { isPlaying = false; playQueue(); });
    } else { isPlaying = false; playQueue(); }
  } catch (err) { logError(`playQueue: ${err.message}`); isPlaying = false; playQueue(); }
}

// === SLASH COMMANDS ===
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('joinbot').setDescription('Bot vào voice channel của bạn'),
    new SlashCommandBuilder().setName('leavebot').setDescription('Bot rời voice channel'),
    new SlashCommandBuilder().setName('themtu').setDescription('Thêm từ viết tắt mới')
      .addStringOption(o => o.setName('tu_viet_tat').setDescription('Từ viết tắt').setRequired(true))
      .addStringOption(o => o.setName('cach_doc').setDescription('Cách đọc').setRequired(true)),
    new SlashCommandBuilder().setName('xoatu').setDescription('Xoá từ viết tắt')
      .addStringOption(o => o.setName('tu_viet_tat').setDescription('Từ cần xoá').setRequired(true)),
    new SlashCommandBuilder().setName('viettat').setDescription('Xem danh sách từ viết tắt'),
    new SlashCommandBuilder().setName('tocdo').setDescription('Chỉnh tốc độ đọc (0.5 - 2.0)')
      .addNumberOption(o => o.setName('gia_tri').setDescription('Giá trị').setRequired(true)),
    new SlashCommandBuilder().setName('amluong').setDescription('Chỉnh âm lượng (0.1 - 2.0)')
      .addNumberOption(o => o.setName('gia_tri').setDescription('Giá trị').setRequired(true)),
    new SlashCommandBuilder().setName('shutdown').setDescription('Tắt bot (chỉ admin)'),
  ].map(cmd => cmd.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  logSuccess('✅ Slash commands đã đăng ký.');
}

// === EVENT READY ===
client.once('clientReady', () => logSuccess(`🤖 Bot đăng nhập: ${client.user.tag}`));

// === HANDLE LỆNH ===
client.on('interactionCreate', async i => {
  if (!i.isChatInputCommand()) return;
  const name = i.commandName;

  if (name === 'shutdown') {
    if (i.user.id !== OWNER_ID) return i.reply({ content: '🚫 Bạn không có quyền.', flags: 64 });
    await i.reply({ content: '👋 Bot đang tắt...', flags: 64 });
    if (connection) connection.destroy();
    logWarn('🛑 Bot đã tắt bởi admin.');
    process.exit(0);
  }

  if (name === 'joinbot') {
    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ content: '⚠️ Vào kênh thoại trước.', flags: 64 });
    connection = joinVoiceChannel({ channelId: vc.id, guildId: i.guild.id, adapterCreator: i.guild.voiceAdapterCreator });
    connection.subscribe(player);
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    logSuccess(`Đã vào kênh: ${vc.name}`);
    return i.reply({ content: `✅ Bot đã vào **${vc.name}**.`, flags: 64 });
  }

  if (name === 'leavebot') {
    if (connection) { connection.destroy(); connection = null; logWarn('Bot rời kênh.'); return i.reply({ content: '👋 Bot đã rời kênh thoại.', flags: 64 }); }
    return i.reply({ content: '⚠️ Bot chưa ở trong kênh.', flags: 64 });
  }

  if (name === 'themtu') {
    const tu = i.options.getString('tu_viet_tat').toLowerCase();
    const nghia = i.options.getString('cach_doc');
    const cur = loadCustomSlang(); cur[tu] = nghia; saveCustomSlang(cur);
    logSuccess(`+ Thêm từ: ${tu} → ${nghia}`);
    return i.reply({ content: `✅ Đã thêm: **${tu} → ${nghia}**`, flags: 64 });
  }

  if (name === 'xoatu') {
    const tu = i.options.getString('tu_viet_tat').toLowerCase();
    const cur = loadCustomSlang();
    if (cur[tu]) { delete cur[tu]; saveCustomSlang(cur); logWarn(`- Xoá từ: ${tu}`); return i.reply({ content: `🗑️ Đã xoá **${tu}**`, flags: 64 }); }
    return i.reply({ content: `⚠️ Không có từ **${tu}**`, flags: 64 });
  }

  if (name === 'viettat') {
    const all = getAllSlang();
    const formatted = Object.entries(all).map(([k, v]) => `🔹 **${k}** → ${v}`).join('\n');
    return i.reply({ content: formatted || '📭 Không có từ nào.', flags: 64 });
  }

  if (name === 'tocdo') {
    const val = i.options.getNumber('gia_tri');
    if (val < 0.5 || val > 2.0) return i.reply({ content: '⚠️ Phạm vi: 0.5–2.0', flags: 64 });
    speed = val; logInfo(`Tốc độ đọc = ${speed}x`);
    return i.reply({ content: `⚙️ Đặt tốc độ = **${speed.toFixed(2)}x**`, flags: 64 });
  }

  if (name === 'amluong') {
    const val = i.options.getNumber('gia_tri');
    if (val < 0.1 || val > 2.0) return i.reply({ content: '⚠️ Phạm vi: 0.1–2.0', flags: 64 });
    volume = val; logInfo(`Âm lượng = ${volume}x`);
    return i.reply({ content: `🔊 Đặt âm lượng = **${volume.toFixed(2)}x**`, flags: 64 });
  }
});

// === MESSAGE EVENT ===
client.on('messageCreate', async msg => {
  try {
    if (msg.author.bot || !connection) return;
    const username = msg.member?.displayName || msg.author.username || 'Người dùng';
    if (!msg.content) return;
    const rawText = msg.content.trim();
    if (!rawText) return;

    const { maskedText, links } = extractAndMaskLinks(rawText);
    const expanded = expandSlang(maskedText);
    const normalized = normalizeNumbers(expanded);
    if (links.length > 0) logInfo(`🔗 ${links.length} link bị bỏ qua: ${links.join(', ')}`);

    queue.push({ text: normalized, username, raw: rawText, links });
    playQueue();
  } catch (err) {
    logError(`messageCreate: ${err.message}`);
  }
});

// === KHỞI ĐỘNG BOT ===
registerCommands().then(() => client.login(token));
