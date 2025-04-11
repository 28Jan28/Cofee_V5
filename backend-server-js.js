// Dříve nedokončený server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('bodyParser');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import modelů
const User = require('./models/User');
const CoffeeOption = require('./models/CoffeeOption');
const Transaction = require('./models/Transaction');
const Terminal = require('./models/Terminal');

// Inicializace Express aplikace
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Připojení k MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coffee-system';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false
})
.then(() => console.log('MongoDB připojeno'))
.catch(err => {
  console.error('Chyba připojení k MongoDB:', err);
  process.exit(1);
});

// Základní routy

// Uživatelé
app.get('/api/v1/users', async (req, res) => {
  try {
    const users = await User.find().select('-passwordHash');
    res.json(users);
  } catch (err) {
    console.error('Chyba při načítání uživatelů:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

app.get('/api/v1/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'Uživatel nenalezen' });
    res.json(user);
  } catch (err) {
    console.error('Chyba při načítání uživatele:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

app.post('/api/v1/users', async (req, res) => {
  try {
    const newUser = new User(req.body);
    await newUser.save();
    res.status(201).json(newUser);
  } catch (err) {
    console.error('Chyba při vytváření uživatele:', err);
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/v1/users/:id', async (req, res) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).select('-passwordHash');
    
    if (!updatedUser) return res.status(404).json({ error: 'Uživatel nenalezen' });
    res.json(updatedUser);
  } catch (err) {
    console.error('Chyba při aktualizaci uživatele:', err);
    res.status(400).json({ error: err.message });
  }
});

// RFID endpoint
app.post('/api/v1/rfid/authenticate', async (req, res) => {
  try {
    const { rfidCode } = req.body;
    if (!rfidCode) return res.status(400).json({ error: 'RFID kód je povinný' });
    
    const user = await User.findOne({ rfidCode }).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'Uživatel s tímto RFID kódem nenalezen' });
    
    res.json({ user });
  } catch (err) {
    console.error('Chyba při RFID autentizaci:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Možnosti kávy
app.get('/api/v1/coffee-options', async (req, res) => {
  try {
    const options = await CoffeeOption.find();
    res.json(options);
  } catch (err) {
    console.error('Chyba při načítání možností kávy:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Transakce
app.post('/api/v1/transactions', async (req, res) => {
  try {
    const { userId, coffeeOptionId, terminalId, offlineId } = req.body;
    
    // Kontrola existence uživatele a možnosti kávy
    const [user, coffeeOption] = await Promise.all([
      User.findById(userId),
      CoffeeOption.findById(coffeeOptionId)
    ]);
    
    if (!user) return res.status(404).json({ error: 'Uživatel nenalezen' });
    if (!coffeeOption) return res.status(404).json({ error: 'Možnost kávy nenalezena' });
    
    // Vytvoření nové transakce
    const transaction = new Transaction({
      user: userId,
      coffeeOption: coffeeOptionId,
      terminal: terminalId,
      price: coffeeOption.price,
      offlineId
    });
    
    await transaction.save();
    
    // Aktualizace statistik uživatele
    user.coffeeCount = (user.coffeeCount || 0) + 1;
    user.lastCoffee = new Date();
    await user.save();
    
    res.status(201).json({ transaction });
  } catch (err) {
    console.error('Chyba při vytváření transakce:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/v1/users/:id/transactions', async (req, res) => {
  try {
    const userId = req.params.id;
    const transactions = await Transaction.find({ user: userId })
      .populate('coffeeOption')
      .sort({ timestamp: -1 })
      .limit(20);
    
    res.json({ transactions });
  } catch (err) {
    console.error('Chyba při načítání transakcí uživatele:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Synchronizace - Nový endpoint pro synchronizaci terminálů
app.get('/api/v1/terminal/sync', async (req, res) => {
  try {
    const { terminalId, lastSync } = req.query;
    
    if (!terminalId) {
      return res.status(400).json({ error: 'ID terminálu je povinné' });
    }
    
    let terminal = await Terminal.findOne({ terminalId });
    
    // Pokud terminál neexistuje, vytvoříme nový
    if (!terminal) {
      terminal = new Terminal({
        terminalId,
        lastSeen: new Date()
      });
    } else {
      terminal.lastSeen = new Date();
    }
    
    await terminal.save();
    
    // Příprava dat pro synchronizaci
    const syncData = {
      timestamp: new Date().toISOString(),
      data: {}
    };
    
    // Získání aktualizovaných dat od poslední synchronizace
    if (lastSync) {
      const lastSyncDate = new Date(lastSync);
      
      const [updatedUsers, updatedCoffeeOptions, transactions] = await Promise.all([
        User.find({ updatedAt: { $gt: lastSyncDate } }).select('-passwordHash'),
        CoffeeOption.find({ updatedAt: { $gt: lastSyncDate } }),
        Transaction.find({ 
          offlineId: { $exists: true, $ne: null },
          createdAt: { $gt: lastSyncDate }
        })
      ]);
      
      if (updatedUsers.length > 0) syncData.data.users = updatedUsers;
      if (updatedCoffeeOptions.length > 0) syncData.data.coffeeOptions = updatedCoffeeOptions;
      if (transactions.length > 0) syncData.data.transactions = transactions;
    } else {
      // První synchronizace - pošleme všechna data
      const [allUsers, allCoffeeOptions] = await Promise.all([
        User.find().select('-passwordHash'),
        CoffeeOption.find()
      ]);
      
      syncData.data.users = allUsers;
      syncData.data.coffeeOptions = allCoffeeOptions;
    }
    
    res.json(syncData);
  } catch (err) {
    console.error('Chyba při synchronizaci terminálu:', err);
    res.status(500).json({ error: 'Chyba synchronizace' });
  }
});

// Hromadné nahrání offline transakcí
app.post('/api/v1/transactions/batch', async (req, res) => {
  try {
    const { transactions } = req.body;
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Žádné transakce k uložení' });
    }
    
    const results = [];
    const errors = [];
    
    // Zpracování všech transakcí
    for (const tx of transactions) {
      try {
        const { userId, coffeeOptionId, terminalId, offlineId, timestamp } = tx;
        
        // Kontrola, zda transakce s tímto offline ID již neexistuje
        const existingTx = await Transaction.findOne({ offlineId });
        if (existingTx) {
          results.push({ offlineId, status: 'skipped', message: 'Transakce již existuje' });
          continue;
        }
        
        // Kontrola existence uživatele a možnosti kávy
        const [user, coffeeOption] = await Promise.all([
          User.findById(userId),
          CoffeeOption.findById(coffeeOptionId)
        ]);
        
        if (!user || !coffeeOption) {
          results.push({ 
            offlineId, 
            status: 'error', 
            message: !user ? 'Uživatel nenalezen' : 'Možnost kávy nenalezena' 
          });
          continue;
        }
        
        // Vytvoření nové transakce
        const transaction = new Transaction({
          user: userId,
          coffeeOption: coffeeOptionId,
          terminal: terminalId,
          price: coffeeOption.price,
          offlineId,
          timestamp: timestamp || new Date()
        });
        
        await transaction.save();
        
        // Aktualizace statistik uživatele
        user.coffeeCount = (user.coffeeCount || 0) + 1;
        if (!timestamp || new Date(timestamp) > new Date(user.lastCoffee || 0)) {
          user.lastCoffee = timestamp || new Date();
        }
        await user.save();
        
        results.push({ offlineId, status: 'success' });
      } catch (err) {
        console.error(`Chyba při zpracování transakce (offlineId: ${tx.offlineId}):`, err);
        errors.push({ offlineId: tx.offlineId, error: err.message });
        results.push({ offlineId: tx.offlineId, status: 'error', message: err.message });
      }
    }
    
    res.json({ results, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Chyba při hromadném nahrání transakcí:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Systémové operace - pouze pro admin uživatele
app.get('/api/v1/system/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Neautorizovaný přístup' });
    
    const user = await User.findById(userId);
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Přístup odepřen' });
    
    // Získání statistik systému
    const [
      userCount,
      transactionCount,
      terminalCount,
      recentTransactions,
      diskUsage,
      lastBackup
    ] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments(),
      Terminal.countDocuments(),
      Transaction.find().sort({ timestamp: -1 }).limit(5).populate('user coffeeOption'),
      getDiskUsage(),
      getLastBackupInfo()
    ]);
    
    res.json({
      systemTime: new Date(),
      userCount,
      transactionCount,
      terminalCount,
      recentTransactions,
      diskUsage,
      lastBackup,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (err) {
    console.error('Chyba při získávání stavu systému:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Záloha systému
app.post('/api/v1/system/backup', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Neautorizovaný přístup' });
    
    const user = await User.findById(userId);
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Přístup odepřen' });
    
    const backupTimestamp = new Date().toISOString().replace(/:/g, '-');
    const backupDir = path.join(__dirname, 'backups');
    
    // Vytvoření adresáře pro zálohy, pokud neexistuje
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupFile = path.join(backupDir, `backup-${backupTimestamp}.json`);
    
    // Získání dat pro zálohu
    const [users, coffeeOptions, transactions, terminals] = await Promise.all([
      User.find(),
      CoffeeOption.find(),
      Transaction.find(),
      Terminal.find()
    ]);
    
    const backupData = {
      timestamp: new Date().toISOString(),
      users,
      coffeeOptions,
      transactions,
      terminals,
      metadata: {
        version: '1.0',
        createdBy: user._id
      }
    };
    
    // Uložení zálohy do souboru
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    // Aktualizace informací o poslední záloze
    updateBackupInfo(backupTimestamp, user._id);
    
    res.json({
      status: 'success',
      timestamp: backupTimestamp,
      file: backupFile,
      backupSize: fs.statSync(backupFile).size
    });
  } catch (err) {
    console.error('Chyba při vytváření zálohy:', err);
    res.status(500).json({ error: 'Chyba serveru' });
  }
});

// Obnovení systému ze zálohy
app.post('/api/v1/system/restore', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Neautorizovaný přístup' });
    
    const user = await User.findById(userId);
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Přístup odepřen' });
    
    // Získání informací o poslední záloze
    const backupInfo = getLastBackupInfo();
    if (!backupInfo || !backupInfo.timestamp) {
      return res.status(404).json({ error: 'Žádná záloha k obnovení' });
    }
    
    const backupFile = path.join(__dirname, 'backups', `backup-${backupInfo.timestamp}.json`);
    
    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ error: 'Záložní soubor nenalezen' });
    }
    
    // Načtení dat ze zálohy
    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    
    // Vymazání stávajících dat
    await Promise.all([
      Transaction.deleteMany({}),
      User.deleteMany({ _id: { $ne: userId } }), // Zachování admin uživatele
      CoffeeOption.deleteMany({}),
      Terminal.deleteMany({})
    ]);
    
    // Obnovení dat ze zálohy
    if (backupData.users && backupData.users.length > 0) {
      const nonAdminUsers = backupData.users.filter(u => u._id !== userId);
      if (nonAdminUsers.length > 0) {
        await User.insertMany(nonAdminUsers);
      }
    }
    
    if (backupData.coffeeOptions && backupData.coffeeOptions.length > 0) {
      await CoffeeOption.insertMany(backupData.coffeeOptions);
    }
    
    if (backupData.transactions && backupData.transactions.length > 0) {
      await Transaction.insertMany(backupData.transactions);
    }
    
    if (backupData.terminals && backupData.terminals.length > 0) {
      await Terminal.insertMany(backupData.terminals);
    }
    
    // Záznam o obnovení systému
    console.log(`Systém obnoven ze zálohy ${backupInfo.timestamp} uživatelem ${userId}`);
    
    res.json({
      status: 'success',
      message: 'Systém byl úspěšně obnoven ze zálohy',
      restoredFrom: backupInfo.timestamp
    });
  } catch (err) {
    console.error('Chyba při obnovování systému:', err);
    res.status(500).json({ error: 'Chyba při obnovování systému' });
  }
});

// Pomocné funkce
async function getDiskUsage() {
  // Jednoduchá implementace - v produkci by použila správné nástroje podle OS
  const backupDir = path.join(__dirname, 'backups');
  let backupSize = 0;
  
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const file of files) {
      const filePath = path.join(backupDir, file);
      if (fs.statSync(filePath).isFile()) {
        backupSize += fs.statSync(filePath).size;
      }
    }
  }
  
  return {
    backupSizeMB: (backupSize / (1024 * 1024)).toFixed(2),
    dbSizeMB: 'N/A' // V produkčním nasazení by se získala velikost DB
  };
}

function getLastBackupInfo() {
  const backupInfoFile = path.join(__dirname, 'backups', 'info.json');
  
  if (fs.existsSync(backupInfoFile)) {
    try {
      return JSON.parse(fs.readFileSync(backupInfoFile, 'utf8'));
    } catch (err) {
      console.error('Chyba při načítání informací o záloze:', err);
      return null;
    }
  }
  
  return null;
}

function updateBackupInfo(timestamp, userId) {
  const backupInfoFile = path.join(__dirname, 'backups', 'info.json');
  const backupInfo = {
    timestamp,
    createdAt: new Date().toISOString(),
    createdBy: userId
  };
  
  // Vytvoření adresáře pro zálohy, pokud neexistuje
  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  fs.writeFileSync(backupInfoFile, JSON.stringify(backupInfo, null, 2));
}

// Plánované úlohy - záloha systému každý den ve 2:00
cron.schedule('0 2 * * *', async () => {
  try {
    console.log('Spouštění automatické zálohy...');
    
    const backupTimestamp = new Date().toISOString().replace(/:/g, '-');
    const backupDir = path.join(__dirname, 'backups');
    
    // Vytvoření adresáře pro zálohy, pokud neexistuje
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupFile = path.join(backupDir, `auto-backup-${backupTimestamp}.json`);
    
    // Získání dat pro zálohu
    const [users, coffeeOptions, transactions, terminals] = await Promise.all([
      User.find(),
      CoffeeOption.find(),
      Transaction.find(),
      Terminal.find()
    ]);
    
    const backupData = {
      timestamp: new Date().toISOString(),
      users,
      coffeeOptions,
      transactions,
      terminals,
      metadata: {
        version: '1.0',
        createdBy: 'system',
        type: 'auto'
      }
    };
    
    // Uložení zálohy do souboru
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    // Aktualizace informací o poslední záloze
    updateBackupInfo(backupTimestamp, 'system');
    
    // Čištění starých záloh (ponechání pouze posledních 7 automatických záloh)
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('auto-backup-'))
      .sort((a, b) => b.localeCompare(a));
    
    if (files.length > 7) {
      for (let i = 7; i < files.length; i++) {
        fs.unlinkSync(path.join(backupDir, files[i]));
      }
    }
    
    console.log('Automatická záloha dokončena:', backupFile);
  } catch (err) {
    console.error('Chyba při automatické záloze:', err);
  }
});

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
  console.log(`API je dostupné na http://localhost:${PORT}/api/v1`);
});

module.exports = app;
