// Frontend: CoffeeApp.js - dokončení
import { useState, useEffect } from 'react';
import axios from 'axios';

export default function CoffeeApp() {
  // Základní stavy aplikace
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [coffeeOptions, setCoffeeOptions] = useState([]);
  const [selectedCoffeeOption, setSelectedCoffeeOption] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rfidInput, setRfidInput] = useState('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineTransactions, setOfflineTransactions] = useState([]);
  const [adminUser, setAdminUser] = useState(null);
  const [terminalId, setTerminalId] = useState(null);
  
  // Přidané stavové proměnné pro produkční verzi
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [systemStatus, setSystemStatus] = useState({});
  const [showSystemStatus, setShowSystemStatus] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [backupStatus, setBackupStatus] = useState({ lastBackup: null, status: 'unknown' });
  const [systemRestoreInProgress, setSystemRestoreInProgress] = useState(false);
  const [showBackupControls, setShowBackupControls] = useState(false);
  
  // API Base URL z původního kódu
  const API_URL = process.env.REACT_APP_API_URL || 'https://api.coffee-system.example.com/v1';
  
  // Inicializace aplikace a načtení dat
  useEffect(() => {
    // Generování nebo načtení ID terminálu
    const storedTerminalId = localStorage.getItem('terminalId');
    if (storedTerminalId) {
      setTerminalId(storedTerminalId);
    } else {
      const newTerminalId = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('terminalId', newTerminalId);
      setTerminalId(newTerminalId);
    }
    
    // Kontrola online/offline stavu
    const handleOnlineStatus = () => {
      setIsOffline(!navigator.onLine);
      if (navigator.onLine) {
        // Při přechodu do online režimu synchronizujeme offline transakce
        syncOfflineTransactions();
      }
    };
    
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    
    // Načtení uložených offline transakcí
    const storedTransactions = localStorage.getItem('offlineTransactions');
    if (storedTransactions) {
      try {
        setOfflineTransactions(JSON.parse(storedTransactions));
      } catch (err) {
        console.error('Chyba při načítání offline transakcí:', err);
      }
    }
    
    // Inicializační načtení dat
    fetchInitialData();
    
    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);
  
  // Ukládání offline transakcí při změně
  useEffect(() => {
    localStorage.setItem('offlineTransactions', JSON.stringify(offlineTransactions));
  }, [offlineTransactions]);
  
  // Ukládání načtených dat do localStorage pro offline použití
  useEffect(() => {
    if (users.length > 0) {
      localStorage.setItem('cachedUsers', JSON.stringify(users));
    }
  }, [users]);
  
  useEffect(() => {
    if (coffeeOptions.length > 0) {
      localStorage.setItem('cachedCoffeeOptions', JSON.stringify(coffeeOptions));
    }
  }, [coffeeOptions]);
  
  // Pravidelná synchronizace dat s ostatními terminály
  useEffect(() => {
    if (!terminalId || isOffline) return;
    
    const syncWithServer = async () => {
      try {
        // Získání posledního času synchronizace z localStorage
        const storedSyncTime = localStorage.getItem('lastSyncTime');
        
        const response = await axios.get(`${API_URL}/terminal/sync`, {
          params: {
            terminalId,
            lastSync: storedSyncTime || undefined
          }
        });
        
        // Zpracování aktualizovaných dat
        if (response.data && response.data.data) {
          const { users: updatedUsers, coffeeOptions: updatedOptions, transactions } = response.data.data;
          
          // Aktualizace uživatelů, pokud přišla nová data
          if (updatedUsers && updatedUsers.length > 0) {
            setUsers(prevUsers => {
              // Sloučení stávajících a nových uživatelů podle ID
              const userMap = new Map();
              prevUsers.forEach(user => userMap.set(user.id, user));
              updatedUsers.forEach(user => userMap.set(user.id, user));
              return Array.from(userMap.values());
            });
          }
          
          // Aktualizace možností kávy
          if (updatedOptions && updatedOptions.length > 0) {
            setCoffeeOptions(updatedOptions);
          }
          
          // Aktualizace offline transakcí - synchronizace s novými
          if (transactions && transactions.length > 0) {
            // Odstranění transakcí, které jsou již na serveru
            const offlineIds = new Set(transactions.map(t => t.offlineId).filter(Boolean));
            
            if (offlineIds.size > 0) {
              setOfflineTransactions(prev => 
                prev.filter(t => !t.offlineId || !offlineIds.has(t.offlineId))
              );
            }
          }
          
          // Uložení času poslední synchronizace
          const syncTime = response.data.timestamp || new Date().toISOString();
          localStorage.setItem('lastSyncTime', syncTime);
          setLastSyncTime(syncTime);
        }
      } catch (err) {
        console.error('Terminal sync failed:', err);
        // V případě chyby přejdeme do offline režimu
        setIsOffline(true);
      }
    };
    
    // Provádět synchronizaci každou minutu
    const intervalId = setInterval(syncWithServer, 60000);
    
    // Také synchronizujeme při načtení komponenty
    syncWithServer();
    
    return () => clearInterval(intervalId);
  }, [terminalId, isOffline, API_URL]);
  
  // Pravidelné získávání stavu systému pro administrátory
  useEffect(() => {
    if (!adminUser || isOffline) return;
    
    const fetchSystemStatus = async () => {
      try {
        const response = await axios.get(`${API_URL}/system/status`, {
          headers: { 'x-user-id': adminUser.id }
        });
        
        setSystemStatus(response.data);
      } catch (err) {
        console.error('Failed to