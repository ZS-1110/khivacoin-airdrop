require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const fs = require('fs');

const app = express();

// CORS — barcha domenlardan so'rovga ruxsat
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());

const MAX_PARTICIPANTS = 80000;
const AIRDROP_AMOUNT_UI = 2500;
const TOKEN_DECIMALS = 9;
const AIRDROP_AMOUNT = AIRDROP_AMOUNT_UI * Math.pow(10, TOKEN_DECIMALS);
const PORT = process.env.PORT || 3001;

// DB
const DB_FILE = './claimed_wallets.json';
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ claimed: [] }));
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { claimed: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function hasClaimed(wallet) { return loadDB().claimed.some(c => c.wallet === wallet); }
function recordClaim(wallet, txHash) {
  const db = loadDB();
  db.claimed.push({ wallet, txHash, amount: AIRDROP_AMOUNT_UI, date: new Date().toISOString() });
  saveDB(db);
}

// Solana
function getSender() {
  const key = process.env.SENDER_PRIVATE_KEY;
  if (!key) throw new Error('SENDER_PRIVATE_KEY topilmadi!');
  return Keypair.fromSecretKey(bs58.decode(key));
}

async function sendTokens(recipientAddress) {
  const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const sender = getSender();
  const mint = new PublicKey(process.env.TOKEN_MINT);
  const recipient = new PublicKey(recipientAddress);
  const senderATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, sender.publicKey);
  const recipientATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, recipient);
  const tx = new Transaction().add(
    createTransferInstruction(senderATA.address, recipientATA.address, sender.publicKey, AIRDROP_AMOUNT, [], TOKEN_PROGRAM_ID)
  );
  const sig = await connection.sendTransaction(tx, [sender]);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

// Routes
app.get('/api/health', (req, res) => {
  const db = loadDB();
  res.json({ status: 'ok', participants: db.claimed.length, max: MAX_PARTICIPANTS });
});

app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const participants = db.claimed.length;
  res.json({
    participants,
    remaining: Math.max(0, MAX_PARTICIPANTS - participants),
    percent: Math.round((participants / MAX_PARTICIPANTS) * 100),
    max: MAX_PARTICIPANTS
  });
});

app.post('/api/claim', async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ success: false, message: 'Wallet manzili kerak' });
  try { new PublicKey(wallet); }
  catch { return res.status(400).json({ success: false, message: "Noto'g'ri wallet manzili" }); }
  if (hasClaimed(wallet)) return res.status(400).json({ success: false, message: 'Bu wallet allaqachon airdrop olgan!' });
  const db = loadDB();
  if (db.claimed.length >= MAX_PARTICIPANTS) return res.status(400).json({ success: false, message: "Airdrop tugadi!" });
  try {
    console.log(`[CLAIM] ${wallet} → ${AIRDROP_AMOUNT_UI} KIC`);
    const txHash = await sendTokens(wallet);
    recordClaim(wallet, txHash);
    console.log(`[OK] TX: ${txHash} | ${db.claimed.length + 1}/${MAX_PARTICIPANTS}`);
    res.json({ success: true, txHash, amount: AIRDROP_AMOUNT_UI });
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Xato: ' + err.message });
  }
});

app.listen(PORT, () => console.log(`KhivaCoin Backend ishga tushdi: port ${PORT}`));
