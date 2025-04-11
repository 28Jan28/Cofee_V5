// Frontend: CoffeeApp.js - dokončení
import { useState, useEffect } from 'react';
import axios from 'axios';

export default function CoffeeApp() {
  // Základní stavy aplikace zůstávají stejné, jak byly v původním kódu...
  
  // Přidáme další stavové proměnné pro produkční verzi
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [systemStatus, setSystemStatus] = useState({});
  const [showSystemStatus, setShowSystemStatus] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [backupStatus, setBackupStatus] = useState({ lastBackup: null, status: 'unknown' });
  const [systemRestoreInProgress, setSystemRestoreInProgress] = useState(false);
  const [showBackupControls, setShowBackupControls] = useState(false);
  
  // API Base URL z původního kódu
  const API_URL = process.env.REACT_APP_API_URL || 'https://api.coffee-system.example.com/v1';
  
  // Původní useEffect pro inicializaci a kontrolu online statusu...
  
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
        console.error('Failed to fetch system status:', err);
      }
    };
    
    const intervalId = setInterval(fetchSystemStatus, 5 * 60 * 1000); // Každých 5 minut
    
    // Také získáme status při načtení
    fetchSystemStatus();
    
    return () => clearInterval(intervalId);
  }, [adminUser, isOffline, API_URL]);
  
  // Získání historie transakcí pro vybraného uživatele
  useEffect(() => {
    if (!selectedUser || isOffline) return;
    
    const fetchTransactionHistory = async () => {
      try {
        const response = await axios.get(`${API_URL}/users/${selectedUser.id}/transactions`);
        setTransactionHistory(response.data.transactions || []);
      } catch (err) {
        console.error('Failed to fetch transaction history:', err);
      }
    };
    
    fetchTransactionHistory();
  }, [selectedUser, isOffline, API_URL]);
  
  // Funkce pro manuální vytvoření zálohy
  const createManualBackup = async () => {
    if (!adminUser || isOffline) return;
    
    try {
      setBackupStatus({ ...backupStatus, status: 'backing-up' });
      
      const response = await axios.post(`${API_URL}/system/backup`, {}, {
        headers: { 'x-user-id': adminUser.id }
      });
      
      setBackupStatus({
        lastBackup: response.data.timestamp,
        status: 'success'
      });
      
      alert('Záloha byla úspěšně vytvořena.');
    } catch (err) {
      console.error('Manual backup failed:', err);
      setBackupStatus({ ...backupStatus, status: 'error' });
      alert('Při vytváření zálohy došlo k chybě.');
    }
  };
  
  // Funkce pro obnovu systému ze zálohy
  const restoreSystem = async () => {
    if (!adminUser || isOffline) return;
    
    if (!window.confirm('Opravdu chcete obnovit systém z poslední zálohy? Tato akce je nevratná!')) {
      return;
    }
    
    try {
      setSystemRestoreInProgress(true);
      
      await axios.post(`${API_URL}/system/restore`, {}, {
        headers: { 'x-user-id': adminUser.id }
      });
      
      alert('Systém byl úspěšně obnoven z poslední zálohy. Aplikace bude nyní obnovena.');
      window.location.reload();
    } catch (err) {
      console.error('System restore failed:', err);
      setSystemRestoreInProgress(false);
      alert('Při obnově systému došlo k chybě.');
    }
  };
  
  // Funkce pro manuální synchronizaci dat
  const manualSync = async () => {
    if (isOffline) {
      alert('Nelze synchronizovat v offline režimu. Zkontrolujte připojení k internetu.');
      return;
    }
    
    try {
      await syncOfflineTransactions();
      
      // Vynucení synchronizace s ostatními terminály
      localStorage.removeItem('lastSyncTime');
      setLastSyncTime(null);
      
      // Znovu načtení všech dat
      const [usersResponse, coffeeResponse] = await Promise.all([
        axios.get(`${API_URL}/users`),
        axios.get(`${API_URL}/coffee-options`)
      ]);
      
      setUsers(usersResponse.data);
      setCoffeeOptions(coffeeResponse.data);
      
      alert('Synchronizace úspěšně dokončena.');
    } catch (err) {
      console.error('Manual sync failed:', err);
      alert('Synchronizace se nezdařila. Zkontrolujte připojení k internetu.');
    }
  };
  
  // Funkce pro vynucení přechodu do online režimu
  const forceOnlineMode = () => {
    if (navigator.onLine) {
      setIsOffline(false);
      manualSync();
    } else {
      alert('Nemáte připojení k internetu. Zkontrolujte síťové připojení.');
    }
  };
  
  // Funkce pro vynucení přechodu do offline režimu (pro testování)
  const forceOfflineMode = () => {
    setIsOffline(true);
    alert('Aplikace byla přepnuta do offline režimu. Data budou synchronizována při dalším připojení k internetu.');
  };
  
  // Funkce pro export dat (např. pro přenositelnost nebo audit)
  const exportData = () => {
    const exportObj = {
      users,
      coffeeOptions,
      offlineTransactions,
      timestamp: new Date().toISOString(),
      terminalId
    };
    
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `coffee-system-export-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };
  
  // Funkce pro import dat
  const importData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Základní validace
        if (!data.users || !data.coffeeOptions) {
          alert('Neplatný formát importovaných dat.');
          return;
        }
        
        // Kontrola, zda nejsme v online režimu
        if (!isOffline && !window.confirm('Importovat data v online režimu může způsobit konflikty. Pokračovat?')) {
          return;
        }
        
        // Import dat
        setUsers(data.users);
        setCoffeeOptions(data.coffeeOptions);
        
        // Offline transakce importujeme pouze pokud jsme v offline režimu
        if (isOffline && data.offlineTransactions) {
          setOfflineTransactions([...offlineTransactions, ...data.offlineTransactions]);
        }
        
        alert('Data byla úspěšně importována.');
      } catch (err) {
        console.error('Import failed:', err);
        alert('Při importu dat došlo k chybě.');
      }
    };
    reader.readAsText(file);
  };

  // Funkce pro obnovení dat v případě pádu aplikace
  const recoverLocalData = () => {
    try {
      // Pokusíme se obnovit všechna uložená data
      const cachedUsers = localStorage.getItem('cachedUsers');
      const cachedCoffeeOptions = localStorage.getItem('cachedCoffeeOptions');
      const storedOfflineTransactions = localStorage.getItem('offlineTransactions');
      
      if (cachedUsers) setUsers(JSON.parse(cachedUsers));
      if (cachedCoffeeOptions) setCoffeeOptions(JSON.parse(cachedCoffeeOptions));
      if (storedOfflineTransactions) setOfflineTransactions(JSON.parse(storedOfflineTransactions));
      
      // Pokud máme data, můžeme pokračovat v offline režimu
      if ((cachedUsers || cachedCoffeeOptions) && !navigator.onLine) {
        setIsOffline(true);
      }
      
      alert('Lokální data byla obnovena.');
    } catch (err) {
      console.error('Recovery failed:', err);
      alert('Obnovení lokálních dat se nezdařilo.');
    }
  };
  
  // Původní funkce z poskytnutého kódu (handleRfidSubmit, processRfidResult, atd.)...
  
  // Render UI komponent
  return (
    <div className="p-4 max-w-4xl mx-auto bg-gray-100 rounded-lg shadow-lg" style={{ width: '1024px', height: '768px', overflow: 'auto' }}>
      <h1 className="text-3xl font-bold text-center mb-6">Kávovar RFID</h1>
      
      {/* Status indikátor */}
      {isOffline && (
        <div className="mb-4 p-2 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded-lg text-center">
          Offline režim - data budou synchronizována při připojení k síti
          {offlineTransactions.length > 0 && (
            <div className="mt-1 text-sm">Čeká na synchronizaci: {offlineTransactions.length} transakcí</div>
          )}
          <button 
            onClick={forceOnlineMode}
            className="mt-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Zkusit přejít do online režimu
          </button>
        </div>
      )}
      
      {/* Informace o poslední synchronizaci pro online režim */}
      {!isOffline && lastSyncTime && (
        <div className="mb-4 p-2 bg-green-100 border border-green-400 text-green-800 rounded-lg text-center text-sm">
          Poslední synchronizace: {new Date(lastSyncTime).toLocaleString()}
          <button 
            onClick={manualSync}
            className="ml-3 px-2 py-0.5 bg-green-500 text-white rounded hover:bg-green-600 text-xs"
          >
            Synchronizovat nyní
          </button>
        </div>
      )}
      
      {/* Chybová hláška */}
      {error && (
        <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-800 rounded-lg text-center">
          {error}
          <button 
            onClick={() => setError(null)}
            className="ml-3 px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
          >
            Zavřít
          </button>
        </div>
      )}
      
      {/* Načítání */}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-50">
          <div className="text-xl font-semibold">Načítání...</div>
        </div>
      )}
      
      {/* Systémové obnovení v průběhu */}
      {systemRestoreInProgress && (
        <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-50">
          <div className="text-xl font-semibold text-center">
            <svg className="animate-spin h-10 w-10 mx-auto mb-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Obnovování systému z poslední zálohy...
            <div className="mt-2 text-sm text-gray-500">Tato operace může trvat několik minut. Prosím,