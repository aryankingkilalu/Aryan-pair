const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  Browsers,
} = require('@whiskeysockets/baileys');
const { makeid } = require('./gen-id');
const { upload } = require('./mega');

const router = express.Router();

function removeFile(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();

  async function startSession() {
    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

    try {
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
      });

      sock.ev.on('creds.update', saveCreds);

      let sessionSent = false;

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !res.headersSent) {
          try { return res.end(await QRCode.toBuffer(qr)); } catch (_) {}
        }

        if (connection === 'open') {
          if (sessionSent) return;
          sessionSent = true;
          await delay(5000);
          const rf = __dirname + '/temp/' + id + '/creds.json';
          const safeId = sock.user.id.replace(/[^0-9a-zA-Z]/g, '_');
          // Normalize JID: strip device suffix (:1) → number@s.whatsapp.net
          const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
          console.log('[qr.js] Connection open! user:', sock.user.id, '→ sending to:', myJid);

          try {
            if (!fs.existsSync(rf)) {
              console.error('[qr.js] creds.json not found at', rf);
              return;
            }

            // ─── Step 1: Try Mega upload (up to 3 attempts) ───────────────
            let string_session = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const mega_url = await upload(fs.createReadStream(rf), safeId + '.json');
                string_session = mega_url.replace('https://mega.nz/file/', '');
                console.log('[session] Mega upload OK on attempt', attempt, '→', mega_url);
                break;
              } catch (megaErr) {
                console.error('[session] Mega attempt', attempt, 'failed:', megaErr.message);
                if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
              }
            }

            // ─── Step 2: Abort if Mega failed — never send base64 ────────
            if (!string_session) {
              console.error('[qr.js] Mega failed all 3 attempts — aborting, not sending base64');
              await sock.sendMessage(myJid, {
                text: '❌ Session upload failed. Please try scanning again.',
              }).catch(() => {});
              return;
            }

            // ─── Step 3: Send session ID (retry up to 3 times) ───────────
            let sent = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                await sock.sendMessage(myJid, { text: 'Teddy-xmd:~' + string_session });
                console.log('✅ [qr.js] Session ID sent on attempt', attempt, 'to', myJid);
                sent = true;
                break;
              } catch (sendErr) {
                console.error('[qr.js] sendMessage attempt', attempt, 'failed:', sendErr.message);
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
              }
            }

            if (!sent) {
              console.error('[qr.js] All sendMessage attempts failed for', myJid);
            }

            // ─── Step 4: Send promo image ─────────────────────────────────
            if (sent) {
              const sessionCaptions = [
`╔━━〔 ✅ SESSION CONNECTED 〕━━━
┃ 👋 Hello, Operator!
┃ 🔐 Session ID is now active.
┃ 🔁 Use in: SESSION_ID variable
┃ 🤖 Thanks for using ARYAN_TECH!
╚━━━━━━━━━━━━━━━━━━━━`,
`⟿ SYSTEM LOG >>> SESSION ONLINE ✅
┌────────────────────┐
│ 🧠 User Authenticated
│ 🔒 SESSION_ID Acquired
│ 🧬 Inject into ENV Variable
│ 🤖 Bot Ready for Commands
└────────────────────┘`,
`🟢 SESSION ONLINE — ACCESS GRANTED 🟢
━━━━━━━━━━━━━━━━━━━━━━━
🧑‍💻 Welcome, Operator.
🛡️  Keep your SESSION_ID private.
📥 Input it into: SESSION_ID
💾 Bot system booted successfully.
━━━━━━━━━━━━━━━━━━━━━━━`,
`> ✅ SESSION CONNECTED
> 👋 Hello! Your session is active.
> 🔐 Do NOT share your SESSION_ID.
> 📌 Use it in: SESSION_ID variable.
> 🤖 Thank you for choosing HANS_TECH.`,
`💻 SYSTEM ALERT: SESSION CONNECTED ✅
━━━━━━━━━━━━━━━━━━━━━━━━
🧑‍💻 Hello Agent,
🔐 Secure your SESSION_ID at all costs.
📍 ENV Variable: SESSION_ID
🤖 Bot Module: Online & Synced
━━━━━━━━━━━━━━━━━━━━━━━━`
              ];
              const randomCaption = sessionCaptions[Math.floor(Math.random() * sessionCaptions.length)];
              try {
                await sock.sendMessage(myJid, {
                  image: { url: 'https://res.cloudinary.com/dqxlb29uz/image/upload/v1782583438/bwm_uploads/media-1782583438533.jpg' },
                  caption: randomCaption,
                  contextInfo: {
                    forwardingScore: 5,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                      newsletterName: 'ARYAN',
                      newsletterJid: '120363421104812135@newsletter',
                    },
                  },
                });
                console.log('[qr.js] Promo image sent');
              } catch (imgErr) {
                console.error('[qr.js] Promo image send failed:', imgErr.message);
              }
            }

          } catch (e) {
            console.error('[qr.js] Critical error sending session:', e.message, e.stack);
          }

          // Cleanup — never call process.exit()
          try { sock.ws.close(); } catch (_) {}
          removeFile('./temp/' + id);

        } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
          await delay(2000);
          startSession();
        }
      });
    } catch (err) {
      console.error('[qr.js] Setup error:', err.message);
      removeFile('./temp/' + id);
      if (!res.headersSent) res.send({ code: '❗ Service Unavailable' });
    }
  }

  await startSession();
});

module.exports = router;
