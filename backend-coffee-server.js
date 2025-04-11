// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { createClient } = require('redis');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Inicializace Express aplikace
const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coffee-system';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Security middleware - CSP headers
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    );
    next();
});

// Serve static files
app.use(express.static('public'));

// Logger konfigurace
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: { service: 'coffee-api' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ],
});

// Redis klient pro cache - upravená verze
let redisClient;
(async () => {
    try {
        redisClient = createClient({ url: REDIS_URL });
        
        redisClient.on('error', (err) => {
            logger.error('Redis Client Error:', err);
        });

        redisClient.on('connect', () => {
            logger.info('Redis Client Connected');
        });

        await redisClient.connect();
    } catch (err) {
        logger.error('Redis initialization error:', err);
        // Continue without Redis
        redisClient = {
            isOpen: false,
            get: async () => null,
            set: async () => {},
            del: async () => {},
            ping: async () => { throw new Error('Redis not initialized'); }
        };
    }
})();

// Middleware
app.use(helmet()); // Bezpečnostní hlavičky
app.use(cors());
app.use(express.json());

// Rate limiting - prevence DDoS útoku
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minut
    max: 100, // limit 100 požadavků na IP
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Připojení k MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => logger.info('Connected to MongoDB'))
.catch(err => {
    logger.error('Failed to connect to MongoDB', err);
    process.exit(1);
});

// Schémata a modely MongoDB
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    rfid: { type: String, required: true, unique: true },
    credit: { type: Number, default: 500 },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActivity: { type: Date },
    active: { type: Boolean, default: true }
});

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['recharge', 'purchase'], required: true },
    amount: { type: Number, required: true },
    item: { type: String },
    balance: { type: Number, required: true },
    terminalId: { type: String, required: true },
    offlineId: { type: String },
    timestamp: { type: Date, default: Date.now },
    synced: { type: Boolean, default: true }
});

const coffeeOptionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const terminalSchema = new mongoose.Schema({
    terminalId: { type: String, required: true, unique: true },
    description: { type: String },
    lastSeen: { type: Date, default: Date.now },
    status: { type: String, default: 'active' }
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const CoffeeOption = mongoose.model('CoffeeOption', coffeeOptionSchema);
const Terminal = mongoose.model('Terminal', terminalSchema);

// Pomocná middleware funkce pro logování požadavků
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.originalUrl} from ${req.ip}`);
    next();
});

// Middleware pro ověření admin práv
const isAdmin = async (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized - User ID missing' });
    }
    
    try {
        const user = await User.findById(userId);
        if (!user || !user.isAdmin) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }
        next();
    } catch (err) {
        logger.error('Error in admin auth middleware', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Health check endpoint
app.get('/api/v1/health', async (req, res) => {
    try {
        // Check MongoDB connection
        const mongoStatus = mongoose.connection.readyState;

        // Check Redis connection
        let redisStatus = false;
        try {
            if (redisClient && redisClient.isOpen) {
                await redisClient.ping();
                redisStatus = true;
            }
        } catch (redisErr) {
            logger.error('Redis health check failed:', redisErr);
        }

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                mongodb: {
                    status: mongoStatus === 1 ? 'connected' : 'disconnected',
                    readyState: mongoStatus
                },
                redis: {
                    status: redisStatus ? 'connected' : 'disconnected',
                    isOpen: redisStatus
                }
            },
            environment: process.env.NODE_ENV,
            version: process.version
        });
    } catch (err) {
        logger.error('Health check error:', err);
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: err.message
        });
    }
});

// API Endpoints
// Získání všech uživatelů (s použitím cache)
app.get('/api/v1/users', async (req, res) => {
    try {
        // Zkusíme získat data z Redis cache
        const cachedUsers = await redisClient.get('users');
        if (cachedUsers) {
            return res.json(JSON.parse(cachedUsers));
        }
        
        // Když nemáme cache data, získáme je z MongoDB
        const users = await User.find({ active: true }).select('-__v');
        
        // Uložíme data do cache na 5 minut
        await redisClient.set('users', JSON.stringify(users), { EX: 300 });
        
        res.json(users);
    } catch (err) {
        logger.error('Error fetching users', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Získání možností kávy (s cache)
app.get('/api/v1/coffee-options', async (req, res) => {
    try {
        // Zkusíme získat data z Redis cache
        const cachedOptions = await redisClient.get('coffee-options');
        if (cachedOptions) {
            return res.json(JSON.parse(cachedOptions));
        }
        
        const options = await CoffeeOption.find({ active: true }).select('-__v');
        
        // Uložíme data do cache na 1 hodinu
        await redisClient.set('coffee-options', JSON.stringify(options), { EX: 3600 });
        
        res.json(options);
    } catch (err) {
        logger.error('Error fetching coffee options', err);
        res.status(500).json({ error: 'Failed to fetch coffee options' });
    }
});

// Ověření RFID karty
app.post('/api/v1/verify-rfid', async (req, res) => {
    const { rfid, terminalId } = req.body;
    
    if (!rfid) {
        return res.status(400).json({ error: 'RFID is required' });
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
        
        const user = await User.findOne({ rfid, active: true }).select('-__v');
        if (!user) {
            return res.status(404).json({ error: 'User not found', user: null });
        }
        
        // Aktualizace poslední aktivity uživatele
        user.lastActivity = new Date();
        await user.save();
        
        res.json({ user });
    } catch (err) {
        logger.error('Error verifying RFID', err);
        res.status(500).json({ error: 'Error verifying RFID' });
    }
});

// Vytvoření transakce
app.post('/api/v1/transactions', async (req, res) => {
    const { userId, type, amount, item, terminalId, offlineId } = req.body;
    
    if (!userId || !type || amount === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Najít uživatele
        const user = await User.findById(userId).session(session);
        if (!user) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Aktualizace kreditu
        const newBalance = user.credit + amount;
        
        // Vytvořit transakci
        const transaction = new Transaction({
            userId,
            type,
            amount,
            item,
            balance: newBalance,
            terminalId,
            offlineId,
            timestamp: new Date(),
        });
        
        await transaction.save({ session });
        
        // Aktualizovat kredit uživatele
        user.credit = newBalance;
        user.lastActivity = new Date();
        await user.save({ session });
        
        // Zneplatnit cache
        await redisClient.del('users');
        
        await session.commitTransaction();
        
        res.status(201).json(transaction);
    } catch (err) {
        await session.abortTransaction();
        logger.error('Error creating transaction', err);
        res.status(500).json({ error: 'Failed to create transaction' });
    } finally {
        session.endSession();
    }
});

// Synchronizace offline transakcí
app.post('/api/v1/sync-transactions', async (req, res) => {
    const { terminalId, transactions } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: 'Invalid transactions data' });
    }
    
    // Aktualizace informací o terminálu
    if (terminalId) {
        await Terminal.findOneAndUpdate(
            { terminalId },
            { lastSeen: new Date() },
            { upsert: true }
        );
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Zpracování transakcí po jedné s udržením pořadí
        const results = [];
        
        for (const transaction of transactions) {
            const { userId, type, amount, item, offlineId } = transaction;
            
            // Kontrola, zda tato transakce již nebyla zpracována
            const existingTransaction = await Transaction.findOne({ offlineId });
            if (existingTransaction) {
                results.push({ status: 'skipped', offlineId, message: 'Transaction already processed' });
                continue;
            }
            
            // Najít uživatele
            const user = await User.findById(userId).session(session);
            if (!user) {
                results.push({ status: 'error', offlineId, message: 'User not found' });
                continue;
            }
            
            // Aktualizace kreditu
            const newBalance = user.credit + amount;
            
            // Vytvořit transakci
            const newTransaction = new Transaction({
                userId,
                type,
                amount,
                item,
                balance: newBalance,
                terminalId,
                offlineId,
                timestamp: new Date(transaction.date),
                synced: true
            });
            
            await newTransaction.save({ session });
            
            // Aktualizovat kredit uživatele
            user.credit = newBalance;
            user.lastActivity = new Date();
            await user.save({ session });
            
            results.push({ status: 'success', offlineId, transaction: newTransaction });
        }
        
        // Zneplatnit cache
        await redisClient.del('users');
        
        await session.commitTransaction();
        
        res.status(200).json({ 
            message: 'Transactions synchronized successfully',
            results 
        });
    } catch (err) {
        await session.abortTransaction();
        logger.error('Error syncing transactions', err);
        res.status(500).json({ error: 'Failed to sync transactions' });
    } finally {
        session.endSession();
    }
});

// Catch-all route for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
});