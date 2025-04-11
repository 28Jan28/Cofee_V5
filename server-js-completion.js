// ... pokračování kódu z prvního souboru
    await session.abortTransaction();
    logger.error('Error syncing transactions', err);
    res.status(500).json({ error: 'Failed to sync transactions' });
  } finally {
    session.endSession();
  }
});

// Přidání nového uživatele
app.post('/api/v1/users', isAdmin, async (req, res) => {
  const { name, rfid, credit, createdBy } = req.body;
  
  if (!name || !rfid) {
    return res.status(400).json({ error: 'Name and RFID are required' });
  }
  
  try {
    // Kontrola, zda RFID již neexistuje
    const existingUser = await User.findOne({ rfid });
    if (existingUser) {
      return res.status(409).json({ error: 'RFID already exists' });
    }
    
    const user = new User({
      name,
      rfid,
      credit: credit || 500,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActivity: new Date()
    });
    
    await user.save();
    
    // Zneplatnit cache
    await redisClient.del('users');
    
    // Zalogovat vytvoření uživatele
    logger.info(`User created with ID ${user._id} by admin ${createdBy}`);
    
    res.status(201).json(user);
  } catch (err) {
    logger.error('Error creating user', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Kontrola dostupnosti RFID
app.post('/api/v1/check-rfid-availability', async (req, res) => {
  const { rfid } = req.body;
  
  if (!rfid) {
    return res.status(400).json({ error: 'RFID is required' });
  }
  
  try {
    const existingUser = await User.findOne({ rfid });
    res.json({ available: !existingUser });
  } catch (err) {
    logger.error('Error checking RFID availability', err);
    res.status(500).json({ error: 'Failed to check RFID availability' });
  }
});

// Příkaz k výdeji kávy
app.post('/api/v1/dispense-coffee', async (req, res) => {
  const { terminalId, coffeeId, userId } = req.body;
  
  if (!coffeeId || !userId) {
    return res.status(400).json({ error: 'Coffee and user IDs are required' });
  }
  
  try {
    // Aktualizace informací o terminálu
    if (terminalId) {
      await Terminal.findOneAndUpdate(
        { terminalId },
        { lastSeen: new Date() },
        { upsert: true }
      );
    }
    
    // Zde by byla implementace komunikace s hardware kávovaru
    // Pro účely této ukázky pouze simulujeme výdej
    
    logger.info(`Coffee ${coffeeId} dispensed for user ${userId} at terminal ${terminalId}`);
    
    res.json({ success: true, message: 'Coffee dispensed successfully' });
  } catch (err) {
    logger.error('Error dispensing coffee', err);
    res.status(500).json({ error: 'Failed to dispense coffee' });
  }
});

// Získání historie transakcí uživatele
app.get('/api/v1/users/:userId/transactions', async (req, res) => {
  const { userId } = req.params;
  const { limit = 20, offset = 0 } = req.query;
  
  try {
    const transactions = await Transaction.find({ userId })
      .sort({ timestamp: -1 })
      .skip(Number(offset))
      .limit(Number(limit));
      
    const total = await Transaction.countDocuments({ userId });
    
    res.json({ 
      transactions,
      total,
      hasMore: total > Number(offset) + transactions.length
    });
  } catch (err) {
    logger.error('Error fetching user transactions', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// API pro získání stavu zařízení
app.get('/api/v1/system/status', isAdmin, async (req, res) => {
  try {
    const activeUsers = await User.countDocuments({ active: true });
    const dailyTransactions = await Transaction.countDocuments({ 
      timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } 
    });
    
    const terminals = await Terminal.find().sort({ lastSeen: -1 }).limit(10);
    
    // Statistika transakcí za posledních 7 dní
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const count = await Transaction.countDocuments({
        timestamp: { $gte: date, $lt: nextDate }
      });
      
      last7Days.push({
        date: date.toISOString().split('T')[0],
        count
      });
    }
    
    res.json({
      activeUsers,
      dailyTransactions,
      terminals,
      transactionStats: {
        last7Days
      },
      systemStatus: 'healthy'
    });
  } catch (err) {
    logger.error('Error getting system status', err);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

// Implementace pravidelného zálohování databáze
cron.schedule('0 2 * * *', async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, 'backups');
    
    // Vytvoření adresáře pro zálohy, pokud neexistuje
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupPath = path.join(backupDir, `backup-${timestamp}.archive`);
    
    // Použití nativního MongoDB klienta pro dump
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db();
    const collections = await db.listCollections().toArray();
    
    const backup = {};
    for (const collection of collections) {
      const data = await db.collection(collection.name).find({}).toArray();
      backup[collection.name] = data;
    }
    
    // Uložení zálohy do souboru
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    
    logger.info(`Database backup created at ${backupPath}`);
    
    // Odstranění starých záloh (starší než 30 dní)
    const files = fs.readdirSync(backupDir);
    const now = new Date();
    
    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24); // v dnech
      
      if (fileAge > 30) {
        fs.unlinkSync(filePath);
        logger.info(`Removed old backup: ${filePath}`);
      }
    }
    
    await client.close();
  } catch (err) {
    logger.error('Database backup failed', err);
  }
});

// Implementace automatického ověření consistency v databázi
cron.schedule('0 3 * * *', async () => {
  try {
    logger.info('Starting database consistency check');
    
    // Kontrola, zda součet transakcí pro každého uživatele odpovídá jeho kreditu
    const users = await User.find({ active: true });
    
    for (const user of users) {
      const transactions = await Transaction.find({ userId: user._id });
      
      // Výpočet očekávaného kreditu
      const expectedCredit = transactions.reduce((sum, t) => sum + t.amount, 0);
      
      // Pokud se liší od aktuálního kreditu, opravíme to
      if (Math.abs(user.credit - expectedCredit) > 0.01) {
        logger.warn(`User ${user._id} credit inconsistency detected: ${user.credit} vs ${expectedCredit}`);
        
        user.credit = expectedCredit;
        await user.save();
        
        logger.info(`User ${user._id} credit corrected to ${expectedCredit}`);
      }
    }
    
    logger.info('Database consistency check completed');
  } catch (err) {
    logger.error('Database consistency check failed', err);
  }
});

// Endpoint pro synchronizaci dat mezi terminály
app.get('/api/v1/terminal/sync', async (req, res) => {
  const { terminalId, lastSync } = req.query;
  
  if (!terminalId) {
    return res.status(400).json({ error: 'Terminal ID is required' });
  }
  
  try {
    // Aktualizace informací o terminálu
    await Terminal.findOneAndUpdate(
      { terminalId },
      { lastSeen: new Date() },
      { upsert: true }
    );
    
    // Příprava dat k synchronizaci
    const query = lastSync ? { updatedAt: { $gt: new Date(lastSync) } } : {};
    
    // Získání aktualizovaných dat
    const [users, coffeeOptions] = await Promise.all([
      User.find({ ...query, active: true }).select('-__v'),
      CoffeeOption.find({ ...query, active: true }).select('-__v')
    ]);
    
    // Pokud máme lastSync, získáme i transakce od té doby
    let transactions = [];
    if (lastSync) {
      transactions = await Transaction.find({
        timestamp: { $gt: new Date(lastSync) }
      }).select('-__v');
    }
    
    res.json({
      timestamp: new Date(),
      data: {
        users,
        coffeeOptions,
        transactions
      }
    });
  } catch (err) {
    logger.error('Error syncing terminal data', err);
    res.status(500).json({ error: 'Failed to sync terminal data' });
  }
});

// Endpoint pro obnovení systému z nejnovější zálohy v případě selhání
app.post('/api/v1/system/restore', isAdmin, async (req, res) => {
  try {
    const backupDir = path.join(__dirname, 'backups');
    
    // Kontrola, zda existují zálohy
    if (!fs.existsSync(backupDir)) {
      return res.status(404).json({ error: 'No backup directory found' });
    }
    
    // Získání nejnovější zálohy
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('backup-'))
      .sort();
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No backup files found' });
    }
    
    const latestBackup = files[files.length - 1];
    const backupPath = path.join(backupDir, latestBackup);
    
    // Načtení zálohy
    const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    
    // Připojení k MongoDB
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db();
    
    // Obnovení každé kolekce
    for (const [collectionName, data] of Object.entries(backupData)) {
      if (data.length > 0) {
        // Odstranění existujících dat
        await db.collection(collectionName).deleteMany({});
        
        // Vložení dat ze zálohy
        await db.collection(collectionName).insertMany(data);
        
        logger.info(`Restored collection ${collectionName} with ${data.length} documents`);
      }
    }
    
    await client.close();
    
    // Zneplatnění cache
    await redisClient.flushAll();
    
    logger.info(`System restored from backup: ${backupPath}`);
    
    res.json({ 
      success: true, 
      message: `System restored from backup: ${latestBackup}` 
    });
  } catch (err) {
    logger.error('System restore failed', err);
    res.status(500).json({ error: 'Failed to restore system' });
  }
});

// Nastartování serveru
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Správné ukončení aplikace při shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await mongoose.disconnect();
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await mongoose.disconnect();
  await redisClient.quit();
  process.exit(0);
});

// Export app pro testování
module.exports = app;
